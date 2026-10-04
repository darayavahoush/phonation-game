import { FeatureExtractor, GATE_MARGIN_DB, PROCESSED_GATE_MARGIN_DB } from './FeatureExtractor.js';
import { normalizeLevel } from './levelSchema.js';
import { scoreTrial } from './scoring.js';
import { percentile, median, clamp, round } from './dsp.js';
import { NoiseTracker, estimateFloor, NOISE_FLOOR } from './noiseFloor.js';

const LIVE_BRIDGE_SEC = 0.06;
const LIVE_DB_RANGE = 30; // dB above (noise floor + 6) that maps to intensityNorm = 1

/**
 * Pure (DOM-free) core: feed it PCM blocks, get live biofeedback state and
 * scored trial results. PhonationEngine wraps this with microphone I/O.
 *
 *   const a = new PhonationAnalyzer({ sampleRate, profile: 'child' });
 *   a.startCalibration();  a.push(block)...;  a.finishCalibration();
 *   a.beginTrial(level);   a.push(block)...;  const result = a.endTrial();
 */
export class PhonationAnalyzer {
  constructor({ sampleRate, profile = 'child' } = {}) {
    this.extractor = new FeatureExtractor({ sampleRate, profile });
    this.hopSec = this.extractor.hopSec;
    this.calibrated = false;
    this.captureInfo = {};
    this._calib = null;
    this._noiseTracker = new NoiseTracker({ hopSec: this.hopSec });
    this._noiseSource = 'default';
    this._trial = null;
    this._dbEma = null;
    this._f0Recent = [];
    this._runStartT = null;
    this._lastVoicedT = null;
    this.live = this._blankLive();
  }

  _blankLive() {
    return {
      t: 0, voiced: false, f0Hz: null, db: null, snrDb: null, intensityNorm: 0,
      voicedRunSec: 0, trialElapsedSec: null, clipping: false,
    };
  }

  /** Record what the browser actually applied to the mic track (see engine). */
  setCaptureInfo(info) {
    this.captureInfo = { ...info };
    const processed = !!(info && (info.autoGainControl || info.noiseSuppression || info.echoCancellation));
    this.extractor.setGateMargin(processed ? PROCESSED_GATE_MARGIN_DB : GATE_MARGIN_DB);
  }

  /** Feed a mono PCM block. Returns the updated live state. */
  push(block) {
    const frames = this.extractor.push(block);
    for (const f of frames) {
      this._noiseTracker.push(f);
      if (this._calib) this._calib.push(f);
      if (this._trial && f.t >= this._trial.startT) this._trial.frames.push(f);
      this._updateLive(f);
    }
    if (this._trial) this._trial.peakAbs = Math.max(this._trial.peakAbs, this.extractor.lastPeak);
    this._collectAudio();
    if (this._trial) this.live.trialElapsedSec = this.extractor.streamTimeSec - this._trial.startT;
    return this.live;
  }

  /** Opt-in: keep the trial's 16 kHz audio IN MEMORY ONLY, for on-device recognition. Never persisted. */
  _collectAudio() {
    const tr = this._trial;
    if (!tr || !tr.audio || !this.extractor.lastBlock) return;
    const y = this.extractor.lastBlock;
    if (tr.audioLen + y.length > tr.audioCap) return; // bounded by maxDurationSec
    tr.audio.push(Float32Array.from(y));
    tr.audioLen += y.length;
  }

  _updateLive(f) {
    const { noise } = this.extractor;
    const alpha = 1 - Math.exp(-this.hopSec / 0.04);
    this._dbEma = this._dbEma == null ? f.db : this._dbEma + alpha * (f.db - this._dbEma);

    if (f.voiced && f.f0 > 0) {
      this._f0Recent.push(f.f0);
      if (this._f0Recent.length > 5) this._f0Recent.shift();
      if (this._lastVoicedT == null || f.t - this._lastVoicedT > LIVE_BRIDGE_SEC) this._runStartT = f.t;
      this._lastVoicedT = f.t;
    } else if (this._lastVoicedT != null && f.t - this._lastVoicedT > LIVE_BRIDGE_SEC) {
      this._runStartT = null;
      this._f0Recent.length = 0;
    }

    const running = this._runStartT != null;
    this.live = {
      ...this.live,
      t: f.t,
      voiced: running,
      f0Hz: running && this._f0Recent.length ? round(median(this._f0Recent), 1) : null,
      db: round(this._dbEma, 1),
      snrDb: round(this._dbEma - noise.db, 1),
      intensityNorm: clamp((this._dbEma - (noise.db + 6)) / LIVE_DB_RANGE, 0, 1),
      voicedRunSec: running ? f.t - this._runStartT + this.hopSec : 0,
      // true only while clipping is happening (last 0.5 s), so a UI hint can clear itself
      clipping: this.extractor.lastClipSec != null && this.extractor.streamTimeSec - this.extractor.lastClipSec < 0.5,
    };
  }

  // ------------------------------------------------------------ calibration

  startCalibration() {
    this._calib = [];
    this._clipMark = this.extractor.clippedSamples;
  }

  /**
   * Ends calibration, applies the measured noise profile, and reports whether
   * the room is usable. The caller should ask the child to stay quiet while
   * calibrating; speech during calibration is flagged as unstable background.
   */
  finishCalibration() {
    const frames = this._calib || [];
    this._calib = null;
    if (frames.length < 100) {
      return { ok: false, noise: this.extractor.noise, warnings: ['too_short'], frames: frames.length };
    }
    const dbs = frames.map((f) => f.db);
    // Robust floor: transients (a cough, a click, a few words) are left out instead of raising the floor.
    const est = estimateFloor(frames);
    const noise = est
      ? { db: est.db, hfDb: est.hfDb, lfDb: est.lfDb }
      : { db: percentile(dbs, 90), hfDb: percentile(frames.map((f) => f.hfDb), 90), lfDb: percentile(frames.map((f) => f.lfDb), 90) };
    const transientFraction = est ? est.transientFraction : 1;
    const warnings = [];
    if (transientFraction > NOISE_FLOOR.UNSTABLE_FRACTION) warnings.push('unstable_background'); // speech / bangs while calibrating
    if (noise.db > -45) warnings.push('high_noise');
    this._noiseSource = 'calibration';
    this.extractor.setNoise(noise);
    this.calibrated = true;
    this._clipMark = this.extractor.clippedSamples;
    return { ok: warnings.length === 0, noise, warnings, frames: frames.length, transientFraction };
  }

  // ----------------------------------------------------------------- trials

  /**
   * @param {object} levelInput
   * @param {{captureAudio?: boolean}} [opts] captureAudio keeps the trial's audio in memory until
   *        endTrialWithAudio() so an on-device recognizer can run. Default false: audio is never kept.
   */
  /**
   * Re-estimate the floor from the last few seconds, so a disturbed calibration (or a room
   * that changed) does not stay wrong all session. Runs only between trials: the gate
   * never moves while a trial is being recorded.
   */
  _refreshNoiseFloor() {
    const est = this._noiseTracker.estimate();
    if (!est) return;
    this.extractor.setNoise({ db: est.db, hfDb: est.hfDb, lfDb: est.lfDb });
    this._noiseSource = 'tracked';
  }

  beginTrial(levelInput, { captureAudio = false } = {}) {
    this._refreshNoiseFloor();
    const level = normalizeLevel(levelInput);
    this._trial = {
      audio: captureAudio ? [] : null,
      audioLen: 0,
      audioCap: Math.round((level.maxDurationSec + 2) * this.extractor.fs),
      level,
      startT: this.extractor.streamTimeSec,
      startedAtMs: Date.now(),
      clipStart: this.extractor.clippedSamples,
      clipRunStart: this.extractor.clipRuns,
      rawStart: this.extractor.rawCount,
      peakAbs: 0,
      frames: [],
    };
    this.live.trialElapsedSec = 0;
    return level;
  }

  get trialActive() {
    return this._trial != null;
  }

  /** Ends the trial and returns the scored, JSON-serialisable result. */
  endTrial() {
    if (!this._trial) throw new Error('No trial in progress');
    const tr = this._trial;
    this._trial = null;
    this.live.trialElapsedSec = null;
    return scoreTrial(tr.level, {
      frames: tr.frames,
      hopSec: this.hopSec,
      noise: { ...this.extractor.noise },
      calibrated: this.calibrated,
      noiseSource: this._noiseSource,
      clippedSamples: this.extractor.clippedSamples - tr.clipStart,
      clipRuns: this.extractor.clipRuns - tr.clipRunStart,
      totalSamples: this.extractor.rawCount - tr.rawStart,
      peakAbs: tr.peakAbs,
      captureInfo: this.captureInfo,
      startT: tr.startT,
      startedAtMs: tr.startedAtMs,
    });
  }

  /**
   * Like endTrial(), but also hands back the in-memory audio (null unless the trial was started
   * with captureAudio). The caller owns the buffer and must not store or transmit it.
   * @returns {{result: object, level: object, audio: Float32Array|null, sampleRate: number}}
   */
  endTrialWithAudio() {
    if (!this._trial) throw new Error('No trial in progress');
    const tr = this._trial;
    const result = this.endTrial();
    let audio = null;
    if (tr.audio) {
      audio = new Float32Array(tr.audioLen);
      let o = 0;
      for (const b of tr.audio) { audio.set(b, o); o += b.length; }
      tr.audio = null;
    }
    return { result, level: tr.level, audio, sampleRate: this.extractor.fs };
  }

  /** Abandon a trial without scoring. */
  cancelTrial() {
    this._trial = null;
    this.live.trialElapsedSec = null;
  }
}
