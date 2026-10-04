// Stress: "pa" x3 through things a real microphone/browser does to a voice. Prints pass / reliable / flags.
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

const cases = [];
for (const [vn, f0] of [['child 300Hz', 300], ['child 380Hz', 380], ['adult 130Hz', 130], ['adult 210Hz', 210]]) {
  const v = voice(f0);
  const room = noise(v.length / FS, -55, 5);
  cases.push([`${vn} | clean`, () => run(v)]);
  cases.push([`${vn} | quiet (-38 dB)`, () => run(add(gain(v, 0.04), noise(v.length / FS, -75, 4)), { calibNoiseDb: -75 })]);
  cases.push([`${vn} | loud+clipped`, () => run(clip(gain(v, 6), 1))]);
  cases.push([`${vn} | phone band-pass`, () => run(phone(v))]);
  cases.push([`${vn} | 16 kHz`, () => run(resample(v, FS, 16000), { fs: 16000, calibSig: noise(1.5, -70, 99, 16000) })]);
  cases.push([`${vn} | 44.1 kHz`, () => run(resample(v, FS, 44100), { fs: 44100, calibSig: noise(1.5, -70, 99, 44100) })]);
  cases.push([`${vn} | echoey room`, () => run(echo(v, 90, 0.5))]);
  cases.push([`${vn} | room noise -45 dB`, () => run(add(v, noise(v.length / FS, -45, 6)), { calibNoiseDb: -45 })]);
  cases.push([`${vn} | AGC on`, () => { const s = agc(add(v, noise(v.length / FS, -62, 6))); return run(s, { info: { autoGainControl: true }, calibSig: agc(noise(1.5, -62, 99)) }); }]);
  cases.push([`${vn} | noise-suppression on`, () => run(ns(add(v, noise(v.length / FS, -50, 6))), { info: { noiseSuppression: true }, calibSig: ns(noise(1.5, -50, 99)) })]);
  cases.push([`${vn} | AGC+NS+echo-cancel`, () => { const s = ns(agc(add(echo(v, 90, 0.4), noise(v.length / FS, -58, 6)))); return run(s, { info: { autoGainControl: true, noiseSuppression: true, echoCancellation: true }, calibSig: ns(agc(noise(1.5, -58, 99))) }); }]);
  cases.push([`${vn} | fast papapa (gap 0.2)`, () => run(voice(f0, { period: 0.2, voiced: 0.12 }))]);
  cases.push([`${vn} | slow pa..pa..pa (gap 1.0)`, () => run(voice(f0, { period: 1.0, voiced: 0.2 }))]);
}
let bad = 0, unrel = 0;
for (const [name, fn] of cases) {
  let r; try { r = fn(); } catch (e) { console.log(`ERR  ${name}: ${e.message}`); bad++; continue; }
  const ok = r.passed && r.metrics.syllableCount === 3;
  if (!ok) bad++; if (!r.quality.reliable) unrel++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(42)} count=${r.metrics.syllableCount} passed=${r.passed} reliable=${r.quality.reliable} ${r.quality.flags.join(',')}`);
}
console.log(`\n${cases.length - bad}/${cases.length} counted "pa"x3 correctly; ${unrel} marked unreliable`);
