import { percentile } from './dsp.js';

/**
 * Noise-floor estimation that survives a cough, a click or a few words.
 *
 * The old rule took the 90th percentile of ALL frames in a 1.5 s calibration,
 * so any sound covering ~10% of that window (150 ms) raised the "room noise"
 * for the rest of the session. Here frames well above the quiet baseline are
 * treated as transients and left out, and the floor is also tracked over the
 * last few seconds so a bad calibration corrects itself.
 *
 * The margins below are placeholders chosen on synthetic audio. They are not
 * validated on real devices or rooms; see README "Validation status".
 */
export const NOISE_FLOOR = Object.freeze({
  BASELINE_PERCENTILE: 20, // the quiet baseline: where the quietest fifth of frames sit
  TRANSIENT_MARGIN_DB: 6, // frames more than this above the baseline are transients
  FLOOR_PERCENTILE: 90, // conservative floor over the remaining (quiet) frames
  UNSTABLE_FRACTION: 0.1, // more than this share of transients: calibration was disturbed
  WINDOW_SEC: 10, // how far back the tracker looks
  MIN_TRACK_SEC: 3, // tracker is not used with less history than this
  MAX_VOICED_FRACTION: 0.5, // with more voicing than this the quiet frames are too few to trust
  MIN_QUIET_FRAMES: 50, // need at least 0.25 s of quiet frames for any estimate
});

/**
 * Robust floor of a list of frames ({db, hfDb, lfDb}).
 * @returns {{db:number, hfDb:number, lfDb:number, quietFrames:number, totalFrames:number, transientFraction:number}|null}
 *          null when there are too few quiet frames to say anything.
 */
export function estimateFloor(frames) {
  if (!frames || !frames.length) return null;
  const base = percentile(frames.map((f) => f.db), NOISE_FLOOR.BASELINE_PERCENTILE);
  const quiet = frames.filter((f) => f.db <= base + NOISE_FLOOR.TRANSIENT_MARGIN_DB);
  if (quiet.length < NOISE_FLOOR.MIN_QUIET_FRAMES) return null;
  const p = (key) => percentile(quiet.map((f) => f[key]), NOISE_FLOOR.FLOOR_PERCENTILE);
  return {
    db: p('db'),
    hfDb: p('hfDb'),
    lfDb: p('lfDb'),
    quietFrames: quiet.length,
    totalFrames: frames.length,
    transientFraction: 1 - quiet.length / frames.length,
  };
}

/** Rolling window of recent frames, used to refresh the floor between trials. */
export class NoiseTracker {
  constructor({ hopSec }) {
    this.cap = Math.max(1, Math.round(NOISE_FLOOR.WINDOW_SEC / hopSec));
    this.minFrames = Math.round(NOISE_FLOOR.MIN_TRACK_SEC / hopSec);
    this.db = new Float32Array(this.cap);
    this.hf = new Float32Array(this.cap);
    this.lf = new Float32Array(this.cap);
    this.voiced = new Uint8Array(this.cap);
    this.n = 0; // frames held (<= cap)
    this.head = 0; // next write position
  }

  push(f) {
    this.db[this.head] = f.db;
    this.hf[this.head] = f.hfDb;
    this.lf[this.head] = f.lfDb;
    this.voiced[this.head] = f.voiced ? 1 : 0;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }

  reset() {
    this.n = 0;
    this.head = 0;
  }

  /** Floor over the window, or null when there is not enough usable history. */
  estimate() {
    if (this.n < this.minFrames) return null;
    const frames = new Array(this.n);
    let voiced = 0;
    for (let i = 0; i < this.n; i++) {
      frames[i] = { db: this.db[i], hfDb: this.hf[i], lfDb: this.lf[i] };
      voiced += this.voiced[i];
    }
    if (voiced / this.n > NOISE_FLOOR.MAX_VOICED_FRACTION) return null;
    return estimateFloor(frames);
  }
}

/**
 * The single reason a recording was flagged, so a UI can say the right thing.
 * "voice_soft" and "room_noisy" are different problems with different fixes
 * (speak up / move closer, versus find a quieter place) and must not share
 * one message.
 * @param {string[]} flags quality flags from scoring
 * @returns {'not_calibrated'|'too_loud'|'device_processing'|'room_noisy'|'voice_soft'|'no_voice'|null}
 */
export function primaryIssueOf(flags) {
  const has = (f) => flags.includes(f);
  if (has('not_calibrated')) return 'not_calibrated';
  if (has('clipping')) return 'too_loud';
  if (has('capture_processing')) return 'device_processing';
  if (has('high_noise')) return 'room_noisy';
  if (has('low_snr')) return 'voice_soft';
  if (has('no_voicing')) return 'no_voice';
  return null;
}
