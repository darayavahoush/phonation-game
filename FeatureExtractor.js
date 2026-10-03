import { Decimator, FFT, hannWindow, rmsOf, ampToDb, powToDb, yin } from './dsp.js';

/**
 * Speaker-range profiles. Pitch search range and YIN window are the only
 * things that differ; pick by the person speaking, not by the device.
 */
export const PROFILES = Object.freeze({
  child: { fMin: 130, fMax: 700, yinWindowMs: 12.5 },
  adult: { fMin: 70, fMax: 450, yinWindowMs: 25 },
});

export const GATE_MARGIN_DB = 8; // voiced frames must exceed noise floor by this much
export const MIN_GATE_DB = -70; // absolute floor for the gate (dBFS)
const YIN_THRESHOLD = 0.2;
const CLIP_LEVEL = 0.98;
// Real clipping is a FLAT TOP: several consecutive samples stuck at the rail. A loud but undistorted voice
// only touches the rail for 1-2 samples per cycle, so single samples are not counted. 0.08 ms (4 samples at
// 48 kHz) is a placeholder: not yet validated against real devices.
export const CLIP_RUN_SEC = 0.00008;

/**
 * Turns a stream of mono PCM blocks into 5 ms-hop acoustic frames:
 *
 *   t        centre time of the frame (s, from stream start)
 *   db       RMS level of a 10 ms window (dBFS, relative — NOT dB SPL)
 *   f0       fundamental frequency in Hz (0 when unvoiced)
 *   aper     YIN aperiodicity (0 = periodic, 1 = noise)
 *   voiced   periodic AND above the noise gate
 *   lfDb     80–1000 Hz band level (~dBFS for tonal energy)
 *   hfDb     2–6 kHz band level (~dBFS) — used for burst detection
 *   zcr      zero-crossing rate (crossings / sample)
 *
 * Audio is never stored: only these derived features leave this class.
 */
export class FeatureExtractor {
  constructor({ sampleRate, profile = 'child', hopMs = 5 } = {}) {
    if (!sampleRate) throw new Error('sampleRate is required');
    const p = typeof profile === 'string' ? PROFILES[profile] : profile;
    if (!p) throw new Error(`Unknown profile "${profile}"`);

    this.sampleRate = sampleRate;
    this.profile = p;
    this.dec = new Decimator(sampleRate, 16000);
    this.fs = this.dec.rate;
    this.hop = Math.max(1, Math.round((hopMs / 1000) * this.fs));
    this.hopSec = this.hop / this.fs;

    this.tauMax = Math.ceil(this.fs / p.fMin);
    this.W = Math.round((p.yinWindowMs / 1000) * this.fs);
    this.yinSpan = this.W + this.tauMax + 1;
    this.yinHalf = Math.floor(this.yinSpan / 2);
    this.half = this.yinHalf + 2; // look-ahead / look-back needed per frame
    this.energyHalf = Math.round(0.005 * this.fs); // 10 ms RMS window

    this.fftN = 128; // 8 ms: short enough to localise stop bursts
    this.fft = new FFT(this.fftN);
    this.win = hannWindow(this.fftN);
    let sw = 0;
    for (const w of this.win) sw += w;
    this.fftNorm = (sw * sw) / 4; // a full-scale sine ~ 0 dB
    this.re = new Float64Array(this.fftN);
    this.im = new Float64Array(this.fftN);
    const binHz = this.fs / this.fftN;
    const nyq = this.fftN / 2 - 1;
    this.lowBins = [Math.max(1, Math.ceil(80 / binHz)), Math.min(nyq, Math.floor(1000 / binHz))];
    this.highBins = [Math.ceil(2000 / binHz), Math.min(nyq, Math.floor(6000 / binHz))];

    this.noise = { db: -60, hfDb: -90, lfDb: -70 };
    this.gateDb = Math.max(this.noise.db + GATE_MARGIN_DB, MIN_GATE_DB);

    // sample buffer (decimated, DC-blocked)
    this.buf = new Float32Array(this.fs * 2);
    this.len = 0;
    this.base = 0; // global (decimated) index of buf[0]
    this.nextC = this.half; // global index of next frame centre
    this.dcX = 0;
    this.dcY = 0;

    this.rawCount = 0;
    this.clipRunSamples = Math.max(3, Math.ceil(sampleRate * CLIP_RUN_SEC));
    this._clipRunLen = 0;
    this.clippedSamples = 0; // samples that belong to a flat-top run (see CLIP_RUN_SEC)
    this.clipRuns = 0; // number of such runs
    this.lastClipSec = null; // stream time of the most recent clipped sample
    this.lastPeak = 0; // largest |sample| in the latest block (0..1)
    this.lastBlock = null; // latest decimated, DC-blocked block (used only for opt-in on-device recognition)
  }

  /** Seconds of audio received so far. */
  get streamTimeSec() {
    return this.rawCount / this.sampleRate;
  }

  setNoise(noise) {
    this.noise = { ...this.noise, ...noise };
    this.gateDb = Math.max(this.noise.db + GATE_MARGIN_DB, MIN_GATE_DB);
  }

  /** @param {Float32Array} block mono samples in [-1, 1] @returns {object[]} new frames */
  push(block) {
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const a = Math.abs(block[i]);
      if (a > peak) peak = a;
      if (a >= CLIP_LEVEL) {
        this._clipRunLen++;
        if (this._clipRunLen === this.clipRunSamples) {
          this.clippedSamples += this.clipRunSamples;
          this.clipRuns++;
        } else if (this._clipRunLen > this.clipRunSamples) {
          this.clippedSamples++;
        }
        if (this._clipRunLen >= this.clipRunSamples) this.lastClipSec = (this.rawCount + i) / this.sampleRate;
      } else {
        this._clipRunLen = 0;
      }
    }
    this.lastPeak = peak;
    this.rawCount += block.length;

    const x = this.dec.process(block);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const out = x[i] - this.dcX + 0.995 * this.dcY; // DC blocker, ~13 Hz corner
      this.dcX = x[i];
      this.dcY = out;
      y[i] = out;
    }
    this._append(y);
    this.lastBlock = y;

    const frames = [];
    while (this.nextC + this.half < this.base + this.len) {
      frames.push(this._frame(this.nextC));
      this.nextC += this.hop;
    }
    this._trim();
    return frames;
  }

  _append(y) {
    if (this.len + y.length > this.buf.length) {
      const bigger = new Float32Array(Math.max(this.buf.length * 2, this.len + y.length));
      bigger.set(this.buf.subarray(0, this.len));
      this.buf = bigger;
    }
    this.buf.set(y, this.len);
    this.len += y.length;
  }

  _trim() {
    const keepFrom = this.nextC - this.half - 1;
    const drop = keepFrom - this.base;
    if (drop > this.fs) {
      this.buf.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.base += drop;
    }
  }

  _frame(c) {
    const o = c - this.base;
    const buf = this.buf;

    const e0 = o - this.energyHalf;
    const e1 = o + this.energyHalf;
    const rms = rmsOf(buf, e0, e1);
    let crossings = 0;
    for (let i = e0 + 1; i < e1; i++) if ((buf[i] >= 0) !== (buf[i - 1] >= 0)) crossings++;

    const pitch = yin(buf, o - this.yinHalf, this.fs, {
      fMin: this.profile.fMin,
      fMax: this.profile.fMax,
      threshold: YIN_THRESHOLD,
      windowSize: this.W,
    });

    const h = this.fftN >> 1;
    for (let i = 0; i < this.fftN; i++) {
      this.re[i] = buf[o - h + i] * this.win[i];
      this.im[i] = 0;
    }
    this.fft.forward(this.re, this.im);
    const lfDb = powToDb(this._band(this.lowBins) / this.fftNorm);
    const hfDb = powToDb(this._band(this.highBins) / this.fftNorm);

    const db = ampToDb(rms);
    return {
      t: c / this.fs,
      db,
      f0: pitch.f0,
      aper: pitch.aperiodicity,
      voiced: pitch.f0 > 0 && db >= this.gateDb,
      lfDb,
      hfDb,
      zcr: crossings / (e1 - e0),
    };
  }

  _band([lo, hi]) {
    let p = 0;
    for (let k = lo; k <= hi; k++) p += this.re[k] * this.re[k] + this.im[k] * this.im[k];
    return p;
  }
}
