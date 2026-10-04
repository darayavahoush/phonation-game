import test from 'node:test';
import assert from 'node:assert/strict';
// Mic/browser robustness: "pa" x3 through things a real microphone/browser does to a voice. Prints pass / reliable / flags.
import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { FS, tone, silence, concat, noise, feed, calibrate, rng } from './synth.js';

const voice = (f0, { amp = 0.25, period = 0.35, voiced = 0.14, n = 3, lead = 0.4 } = {}) =>
  concat(silence(lead), ...Array.from({ length: n }, () => concat(tone(f0, voiced, { amp, attack: 0.02 }), silence(period - voiced))), silence(0.3));

const add = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] || 0); return o; };
const gain = (x, g) => x.map((v) => v * g);
const clip = (x, lim) => x.map((v) => Math.max(-lim, Math.min(lim, v)));
// one-pole filters
const lp = (x, fc) => { const a = Math.exp(-2 * Math.PI * fc / FS); let y = 0; return x.map((v) => (y = (1 - a) * v + a * y)); };
const hp = (x, fc) => { const l = lp(x, fc); return x.map((v, i) => v - l[i]); };
const phone = (x) => lp(lp(hp(hp(x, 300), 300), 3400), 3400);
const echo = (x, ms, g) => { const d = Math.round(ms / 1000 * FS), o = Float32Array.from(x); for (let i = d; i < x.length; i++) o[i] += g * o[i - d]; return o; };
// AGC: fast attack, slow release gain riding to a target level (pumps up the noise between syllables)
const agc = (x, target = 0.1, rel = 0.6) => { let env = 1e-4; const ar = Math.exp(-1 / (rel * FS)), aa = Math.exp(-1 / (0.01 * FS)); return x.map((v) => { const m = Math.abs(v); env = m > env ? aa * env + (1 - aa) * m : ar * env + (1 - ar) * m; return Math.max(-1, Math.min(1, v * Math.min(60, target / Math.max(env, 1e-4)))); }); };
// Noise suppression: gate that mutes everything under a threshold, with a slow open/close
const ns = (x, thr = 0.01) => { let g = 0; const up = 1 / (0.005 * FS), dn = 1 / (0.15 * FS); let env = 0; return x.map((v) => { env = Math.max(Math.abs(v), env * 0.999); const t = env > thr ? 1 : 0; g += (t - g) * (t > g ? up : dn); return v * g; }); };
const resample = (x, from, to) => { const n = Math.floor(x.length * to / from), o = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i * from / to, j = Math.floor(p), f = p - j; o[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f; } return o; };

function run(sig, { fs = FS, calibNoiseDb = -70, info = {}, calibSig } = {}) {
  const a = new PhonationAnalyzer({ sampleRate: fs, profile: 'child' });
  a.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false, ...info });
  a.startCalibration(); feed(a, calibSig ?? noise(1.5, calibNoiseDb, 99, fs)); a.finishCalibration();
  a.beginTrial({ id: 'pa3', type: 'cv_syllable', syllable: 'pa', reps: 3 });
  feed(a, sig); feed(a, new Float32Array(Math.round(0.2 * fs)));
  return a.endTrial();
}


const pa3 = (f0) => voice(f0);
for (const [vn, f0] of [['child', 320], ['adult', 150]]) {
  const v = pa3(f0);
  const n = v.length / FS;
  const cases = {
    'AGC': () => run(agc(add(v, noise(n, -62, 6))), { info: { autoGainControl: true }, calibSig: agc(noise(1.5, -62, 99)) }),
    'noise suppression': () => run(ns(add(v, noise(n, -50, 6))), { info: { noiseSuppression: true }, calibSig: ns(noise(1.5, -50, 99)) }),
    'AGC + NS + echo cancel': () => run(ns(agc(add(echo(v, 90, 0.4), noise(n, -58, 6)))), { info: { autoGainControl: true, noiseSuppression: true, echoCancellation: true }, calibSig: ns(agc(noise(1.5, -58, 99))) }),
    'phone band-pass, 16 kHz': () => run(resample(phone(v), FS, 16000), { fs: 16000, calibSig: noise(1.5, -70, 99, 16000) }),
    'echoey room': () => run(echo(v, 90, 0.5)),
    'clipped': () => run(clip(gain(v, 6), 1)),
  };
  for (const [name, fn] of Object.entries(cases)) {
    test(`"pa" x3 is counted on ${vn} voice with ${name}`, () => {
      const r = fn();
      assert.equal(r.metrics.syllableCount, 3);
      assert.equal(r.passed, true);
    });
  }
}

test('device processing does not turn room noise into syllables', () => {
  const quiet = add(silence(2.5), noise(2.5, -62, 8));
  const r = run(agc(quiet), { info: { autoGainControl: true, noiseSuppression: true }, calibSig: agc(noise(1.5, -62, 99)) });
  assert.equal(r.metrics.syllableCount, 0);
  assert.equal(r.passed, false);
});

test('processed capture still flags the result as unreliable for clinicians (but can pass the game)', () => {
  const v = pa3(300);
  const r = run(agc(add(v, noise(v.length / FS, -62, 6))), { info: { autoGainControl: true }, calibSig: agc(noise(1.5, -62, 99)) });
  assert.equal(r.passed, true);
  assert.equal(r.quality.reliable, false);
  assert.ok(r.quality.flags.includes('capture_processing'));
});
