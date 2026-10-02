import test from 'node:test';
import assert from 'node:assert/strict';

import { Decimator, yin, hzToSemitones, FFT } from '../dsp.js';
import { FeatureExtractor } from '../FeatureExtractor.js';
import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { validateLevel, normalizeLevel, mannerOf } from '../levelSchema.js';
import { FS, noise, tone, burst, silence, concat, withNoise, feed, calibrate } from './synth.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);

function runTrial(level, signal, { profile = 'child', lead = 0.4, tail = 0.4, noiseDb = -70 } = {}) {
  const a = new PhonationAnalyzer({ sampleRate: FS, profile });
  a.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false });
  const cal = calibrate(a, noiseDb);
  assert.ok(cal.ok, `calibration should pass: ${cal.warnings}`);
  a.beginTrial(level);
  feed(a, withNoise(concat(silence(lead), signal, silence(tail)), noiseDb));
  return a.endTrial();
}

// ------------------------------------------------------------------- DSP

test('FFT locates a sine at the right bin', () => {
  const n = 128;
  const fft = new FFT(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 10 * i) / n);
  fft.forward(re, im);
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (re[k] ** 2 + im[k] ** 2 > re[best] ** 2 + im[best] ** 2) best = k;
  assert.equal(best, 10);
});

test('Decimator: chunked output equals one-shot output', () => {
  const sig = tone(220, 0.5, { amp: 0.3 });
  const d1 = new Decimator(FS);
  const all = d1.process(sig);
  const d2 = new Decimator(FS);
  const parts = [];
  for (let i = 0; i < sig.length; i += 301) parts.push(...d2.process(sig.subarray(i, i + 301)));
  assert.equal(parts.length, all.length);
  for (let i = 0; i < all.length; i += 97) near(parts[i], all[i], 1e-6, `sample ${i}`);
});

test('Decimator attenuates content above the new Nyquist (anti-aliasing)', () => {
  const n = FS * 0.2;
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 11000 * i) / FS); // 11 kHz -> would alias to 5 kHz
  const out = new Decimator(FS).process(sig);
  let e = 0;
  for (let i = 200; i < out.length; i++) e += out[i] ** 2;
  const rms = Math.sqrt(e / (out.length - 200));
  assert.ok(rms < 0.5 * 0.7 * 0.01, `alias rms ${rms}`); // > 40 dB down from input rms
});

for (const sr of [48000, 44100]) {
  for (const f0 of [150, 220, 300, 450, 600]) {
    test(`YIN tracks ${f0} Hz at ${sr} Hz capture rate (child profile) within 1%`, () => {
      const fe = new FeatureExtractor({ sampleRate: sr, profile: 'child' });
      const sig = tone(f0, 0.6, { amp: 0.3, fs: sr });
      const frames = fe.push(sig);
      const mid = frames.filter((f) => f.t > 0.15 && f.t < 0.45 && f.f0 > 0);
      assert.ok(mid.length > 40, 'most mid-signal frames should be voiced');
      const errs = mid.map((f) => Math.abs(f.f0 - f0) / f0);
      assert.ok(Math.max(...errs) < 0.01, `max error ${(Math.max(...errs) * 100).toFixed(2)}%`);
    });
  }
}

test('YIN tracks a 100 Hz male voice with the adult profile', () => {
  const fe = new FeatureExtractor({ sampleRate: FS, profile: 'adult' });
  const frames = fe.push(tone(100, 0.8, { amp: 0.3 }));
  const mid = frames.filter((f) => f.t > 0.2 && f.t < 0.6 && f.f0 > 0);
  assert.ok(mid.length > 50);
  for (const f of mid) near(f.f0, 100, 1.5);
});

test('Noise is not voiced', () => {
  const fe = new FeatureExtractor({ sampleRate: FS });
  const frames = fe.push(noise(1, -40));
  const voiced = frames.filter((f) => f.f0 > 0).length / frames.length;
  assert.ok(voiced < 0.02, `voiced fraction ${voiced}`);
});

// ----------------------------------------------------------------- schema

test('level validation: defaults, errors, manner', () => {
  const ok = validateLevel({ id: 's1', type: 'sustained_voicing', targetDurationSec: 3 });
  assert.ok(ok.ok);
  assert.equal(ok.level.sound, 'a');
  assert.equal(ok.level.minSnrDb, 10);
  assert.ok(!validateLevel({ id: 'x', type: 'nope' }).ok);
  assert.ok(!validateLevel({ id: 'c', type: 'cv_syllable', syllable: 'BA!', reps: 3 }).ok);
  assert.ok(!validateLevel({ id: 'c', type: 'cv_syllable', syllable: 'ba', reps: 0 }).ok);
  assert.ok(!validateLevel({ type: 'pitch_glide', direction: 'up' }).ok, 'missing id');
  assert.ok(!validateLevel({ id: 't', type: 'syllable_train', targetRateMin: 6, targetRateMax: 4 }).ok);
  assert.throws(() => normalizeLevel({ id: 'g', type: 'pitch_glide', direction: 'sideways' }));
  assert.equal(mannerOf('ba'), 'voiced_stop');
  assert.equal(mannerOf('pa'), 'voiceless_stop');
  assert.equal(mannerOf('ma'), 'nasal');
  assert.equal(mannerOf('a'), 'vowel');
  assert.equal(mannerOf('sa'), 'other');
});

// ------------------------------------------------------------- calibration

test('calibration flags speech-like disturbances and loud rooms', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  a.startCalibration();
  feed(a, concat(noise(0.6, -70, 1), tone(250, 0.4, { amp: 0.2 }), noise(0.6, -70, 2)));
  const r = a.finishCalibration();
  assert.ok(r.warnings.includes('unstable_background'), JSON.stringify(r));

  const b = new PhonationAnalyzer({ sampleRate: FS });
  b.startCalibration();
  feed(b, noise(1.5, -35, 3));
  assert.ok(b.finishCalibration().warnings.includes('high_noise'));
});

// ------------------------------------------------------------- sustained

test('sustained voicing: measures MPT and passes/fails against target', () => {
  const sig = tone(260, 3.0, { amp: 0.25 });
  const pass = runTrial({ id: 'm', type: 'sustained_voicing', targetDurationSec: 2.5 }, sig);
  near(pass.metrics.mptSec, 3.0, 0.15, 'MPT');
  assert.equal(pass.passed, true);
  assert.equal(pass.stars, 3);
  assert.equal(pass.quality.reliable, true);
  near(pass.metrics.f0MeanHz, 260, 4);
  assert.ok(pass.metrics.f0SdSemitones < 0.2, `steady tone sd ${pass.metrics.f0SdSemitones}`);

  const fail = runTrial({ id: 'm', type: 'sustained_voicing', targetDurationSec: 4 }, sig);
  assert.equal(fail.passed, false);
  near(fail.progress, 0.75, 0.05);
  assert.ok(fail.stars >= 1);
});

test('sustained voicing: pitch-steadiness requirement fails a wobbling voice', () => {
  const wobble = tone((t) => 260 * 2 ** ((2 * Math.sin(2 * Math.PI * 1.5 * t)) / 12), 3, { amp: 0.25 });
  const r = runTrial({ id: 'w', type: 'sustained_voicing', targetDurationSec: 2, maxF0SdSemitones: 0.5 }, wobble);
  assert.equal(r.metrics.steady, false);
  assert.equal(r.passed, false);
  assert.ok(r.metrics.f0SdSemitones > 1, `sd ${r.metrics.f0SdSemitones}`);
});

test('sustained voicing: short dropouts are bridged, long gaps are not', () => {
  const t1 = tone(260, 1.2, { amp: 0.25, attack: 0.003 });
  const short = runTrial({ id: 'g', type: 'sustained_voicing', targetDurationSec: 2 }, concat(t1, silence(0.03), t1));
  assert.ok(short.metrics.mptSec > 2.3, `bridged mpt ${short.metrics.mptSec}`);
  const long = runTrial({ id: 'g', type: 'sustained_voicing', targetDurationSec: 2 }, concat(t1, silence(0.3), t1));
  assert.ok(long.metrics.mptSec < 1.5, `unbridged mpt ${long.metrics.mptSec}`);
  assert.equal(long.metrics.voicedSegments, 2);
});

test('silence produces no_voicing, 0 stars and no crash', () => {
  const r = runTrial({ id: 's', type: 'sustained_voicing', targetDurationSec: 2 }, silence(2));
  assert.equal(r.passed, false);
  assert.equal(r.stars, 0);
  assert.ok(r.quality.flags.includes('no_voicing'));
});

// ------------------------------------------------------------------ glide

test('pitch glide: up one octave measured as ~12 semitones', () => {
  const up = tone((t) => 200 * 2 ** (t / 1.5), 1.5, { amp: 0.25 });
  const r = runTrial({ id: 'g', type: 'pitch_glide', direction: 'up', minRangeSemitones: 6 }, up);
  near(r.metrics.rangeSemitones, 11, 1.8, 'range');
  assert.equal(r.metrics.directionOk, true);
  assert.ok(r.metrics.monotonicity >= 0.9);
  assert.equal(r.passed, true);
  near(r.metrics.startHz, 205, 15);
  near(r.metrics.endHz, 390, 25);

  const wrong = runTrial({ id: 'g', type: 'pitch_glide', direction: 'down', minRangeSemitones: 6 }, up);
  assert.equal(wrong.metrics.directionOk, false);
  assert.equal(wrong.passed, false);
});

test('pitch glide: a flat tone does not pass', () => {
  const r = runTrial({ id: 'g', type: 'pitch_glide', direction: 'up', minRangeSemitones: 4 }, tone(250, 1.5, { amp: 0.25 }));
  assert.equal(r.passed, false);
  assert.ok(r.metrics.rangeSemitones < 1);
});

// ------------------------------------------------------------------- ramp

test('loudness ramp: ~24 dB crescendo detected, decrescendo rejected for "up"', () => {
  const up = tone(250, 2, { amp: (t) => 0.015 * 16 ** (t / 2), attack: 0.002 }); // 0.015 -> 0.24 (24 dB)
  const r = runTrial({ id: 'l', type: 'loudness_ramp', direction: 'up', minRangeDb: 10 }, up);
  near(r.metrics.deltaDb, 18, 6, 'delta');
  assert.equal(r.passed, true);
  const down = tone(250, 2, { amp: (t) => 0.24 / 16 ** (t / 2), attack: 0.002 });
  const r2 = runTrial({ id: 'l', type: 'loudness_ramp', direction: 'up', minRangeDb: 10 }, down);
  assert.equal(r2.passed, false);
  assert.ok(r2.metrics.deltaDb < 0);
});

// ------------------------------------------------------------ syllables

function syllableTrain(n, periodSec, { f0 = 260, voicedSec = 0.14 } = {}) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(tone(f0, voicedSec, { amp: 0.25, attack: 0.025 }));
    parts.push(silence(periodSec - voicedSec));
  }
  return concat(...parts);
}

test('syllable train: counts syllables and measures rate / regularity', () => {
  const r = runTrial({ id: 't', type: 'syllable_train', syllable: 'ba', durationSec: 3, minSyllables: 6, targetRateMin: 3, targetRateMax: 5 }, syllableTrain(8, 0.25));
  assert.equal(r.metrics.syllableCount, 8);
  near(r.metrics.ratePerSec, 4, 0.2, 'rate');
  assert.ok(r.metrics.ioiCv < 0.05, `regular train cv ${r.metrics.ioiCv}`);
  assert.equal(r.passed, true);
});

test('syllable train: too-fast target rate fails; irregular rhythm has higher CV', () => {
  const fast = runTrial({ id: 't', type: 'syllable_train', minSyllables: 4, targetRateMin: 6 }, syllableTrain(8, 0.25));
  assert.equal(fast.passed, false);

  const parts = [];
  [0.22, 0.4, 0.2, 0.45, 0.25, 0.38, 0.21].forEach((p) => {
    parts.push(tone(260, 0.14, { amp: 0.25, attack: 0.025 }), silence(p - 0.14));
  });
  const irr = runTrial({ id: 't', type: 'syllable_train', minSyllables: 4 }, concat(...parts));
  assert.ok(irr.metrics.ioiCv > 0.2, `irregular cv ${irr.metrics.ioiCv}`);
});

test('cv syllable: counts repetitions (steady-state tone bursts) and respects reps', () => {
  const sig = concat(syllableTrain(3, 0.7, { voicedSec: 0.25 }));
  const r = runTrial({ id: 'ba3', type: 'cv_syllable', syllable: 'ba', reps: 3 }, sig);
  assert.equal(r.metrics.syllableCount, 3);
  assert.equal(r.passed, true);
  const need4 = runTrial({ id: 'ba4', type: 'cv_syllable', syllable: 'ba', reps: 4 }, sig);
  assert.equal(need4.passed, false);
  near(need4.progress, 0.75, 0.01);
});

test('cv syllable: ignores noise-only bursts (no voicing => no syllable)', () => {
  const sig = concat(burst(0.15, 0.2), silence(0.4), burst(0.15, 0.2));
  const r = runTrial({ id: 'ba', type: 'cv_syllable', syllable: 'ba', reps: 1 }, sig);
  assert.equal(r.metrics.syllableCount, 0);
  assert.equal(r.passed, false);
});

// ------------------------------------------------------------------- VOT

function cv({ aspirationSec = 0, burstSec = 0.006, vowelSec = 0.25, seed = 5 }) {
  return concat(
    burst(burstSec, 0.25, seed),
    aspirationSec ? burst(aspirationSec, 0.02, seed + 1) : new Float32Array(0),
    tone(260, vowelSec, { amp: 0.25, attack: 0.004 }),
  );
}

test('VOT (experimental): short-lag vs long-lag separate on synthetic /ba/ vs /pa/', () => {
  const results = {};
  for (const [name, asp] of [['ba', 0], ['pa', 0.05]]) {
    const sig = concat(cv({ aspirationSec: asp }), silence(0.5), cv({ aspirationSec: asp, seed: 9 }), silence(0.5), cv({ aspirationSec: asp, seed: 13 }));
    results[name] = runTrial({ id: name, type: 'cv_syllable', syllable: name, reps: 3 }, sig);
  }
  const ba = results.ba.metrics;
  const pa = results.pa.metrics;
  assert.equal(ba.syllableCount, 3);
  assert.equal(pa.syllableCount, 3);
  assert.ok(ba.votMeanMs != null && pa.votMeanMs != null, `bursts found: ba=${ba.votMeanMs} pa=${pa.votMeanMs}`);
  assert.ok(ba.votMeanMs < 30, `ba VOT ${ba.votMeanMs}`);
  assert.ok(pa.votMeanMs > 30, `pa VOT ${pa.votMeanMs}`);
  assert.ok(pa.votMeanMs - ba.votMeanMs > 25, `separation ${pa.votMeanMs - ba.votMeanMs}`);
});

// ------------------------------------------------------------- quality

test('quality flags: clipping, capture processing, not calibrated', () => {
  const clipped = tone(250, 2, { amp: 3 }).map((x) => Math.max(-1, Math.min(1, x)));
  const r = runTrial({ id: 'c', type: 'sustained_voicing', targetDurationSec: 1 }, clipped);
  assert.ok(r.quality.flags.includes('clipping'), JSON.stringify(r.quality));
  assert.equal(r.quality.reliable, false);

  const a = new PhonationAnalyzer({ sampleRate: FS });
  a.setCaptureInfo({ autoGainControl: true });
  a.beginTrial({ id: 'u', type: 'sustained_voicing', targetDurationSec: 1 });
  feed(a, withNoise(concat(silence(0.3), tone(250, 1.5, { amp: 0.25 })), -70));
  const u = a.endTrial();
  assert.ok(u.quality.flags.includes('not_calibrated'));
  assert.ok(u.quality.flags.includes('capture_processing'));
  assert.equal(u.quality.reliable, false);
});

test('result is JSON-serialisable and contains no audio samples', () => {
  const r = runTrial({ id: 'j', type: 'sustained_voicing', targetDurationSec: 1 }, tone(250, 1.5, { amp: 0.25 }));
  const json = JSON.stringify(r);
  assert.ok(json.length < 20000, `payload ${json.length} bytes`);
  const back = JSON.parse(json);
  assert.equal(back.levelId, 'j');
  assert.ok(Array.isArray(back.contour) && back.contour.length > 10);
});

// ------------------------------------------------------------ live state

test('live biofeedback: voicing on/off, run length and pitch while sounding', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  feed(a, noise(0.3, -70, 21));
  assert.equal(a.live.voiced, false);
  assert.equal(a.live.intensityNorm < 0.1, true);
  feed(a, withNoise(tone(300, 0.8, { amp: 0.25 }), -70));
  assert.equal(a.live.voiced, true);
  assert.ok(a.live.voicedRunSec > 0.4, `run ${a.live.voicedRunSec}`);
  near(a.live.f0Hz, 300, 6);
  assert.ok(a.live.intensityNorm > 0.5, `norm ${a.live.intensityNorm}`);
  feed(a, noise(0.4, -70, 22));
  assert.equal(a.live.voiced, false);
  assert.equal(a.live.voicedRunSec, 0);
});
