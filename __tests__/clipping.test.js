import test from 'node:test';
import assert from 'node:assert/strict';

import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { FeatureExtractor } from '../FeatureExtractor.js';
import { FS, tone, silence, concat, withNoise, feed, calibrate } from './synth.js';

const LEVEL = { id: 'sv-clip', type: 'sustained_voicing', targetDurationSec: 2 };

const scaleToPeak = (x, peak) => {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return x.map((v) => (v * peak) / m);
};
const hardClip = (x, gain, rail) => x.map((v) => Math.max(-rail, Math.min(rail, v * gain)));

function runTrial(voice, { noiseDb = -62, stepAfter = null } = {}) {
  const a = new PhonationAnalyzer({ sampleRate: FS, profile: 'child' });
  a.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false });
  assert.ok(calibrate(a, noiseDb).ok);
  a.beginTrial(LEVEL);
  feed(a, withNoise(concat(silence(0.4), voice, silence(0.4)), noiseDb));
  return { a, result: a.endTrial() };
}

test('a loud voice whose peaks only touch full scale is NOT flagged as clipping', () => {
  const { result } = runTrial(scaleToPeak(tone(300, 3, { amp: 1 }), 0.995));
  assert.ok(!result.quality.flags.includes('clipping'), result.quality.flags.join(','));
  assert.equal(result.quality.reliable, true);
  assert.equal(result.quality.clippedSamples, 0);
  assert.ok(result.quality.peakAbs >= 0.99, `peakAbs reported: ${result.quality.peakAbs}`);
});

test('a genuinely flat-topped (hard-clipped) voice IS flagged and unreliable', () => {
  const { result } = runTrial(hardClip(scaleToPeak(tone(300, 3, { amp: 1 }), 1), 3, 0.99));
  assert.ok(result.quality.flags.includes('clipping'));
  assert.equal(result.quality.reliable, false);
  assert.ok(result.quality.clipFraction > 0.1, `clipFraction ${result.quality.clipFraction}`);
});

test('a handful of brief clipped peaks in a long trial stays under the proportional limit', () => {
  const voice = scaleToPeak(tone(300, 3, { amp: 1 }), 0.6);
  for (const at of [20000, 60000, 100000]) for (let i = 0; i < 6; i++) voice[at + i] = 0.995; // 3 runs of 6 samples
  const { result } = runTrial(voice);
  assert.equal(result.quality.clippedSamples, 18);
  assert.ok(!result.quality.flags.includes('clipping'), 'only 18 of ~170k samples');
});

test('a flat-top run that straddles two audio blocks is counted once, in full', () => {
  const fe = new FeatureExtractor({ sampleRate: FS, profile: 'child' });
  const a = new Float32Array(512);
  const b = new Float32Array(512);
  for (let i = 508; i < 512; i++) a[i] = 0.99; // 4 samples at the end of block 1
  for (let i = 0; i < 4; i++) b[i] = 0.99; // 4 more at the start of block 2
  fe.push(a);
  fe.push(b);
  assert.equal(fe.clipRuns, 1);
  assert.equal(fe.clippedSamples, 8);
});

test('single stray samples at the rail are ignored; negative rail counts too', () => {
  const fe = new FeatureExtractor({ sampleRate: FS, profile: 'child' });
  const x = new Float32Array(2048);
  x[100] = 1; x[300] = -1; x[301] = 0; x[302] = -1; // all isolated
  fe.push(x);
  assert.equal(fe.clippedSamples, 0);
  const y = new Float32Array(512);
  for (let i = 10; i < 16; i++) y[i] = -1; // 6-sample negative flat top
  fe.push(y);
  assert.equal(fe.clipRuns, 1);
  assert.equal(fe.clippedSamples, 6);
});

test('live.clipping is true only while clipping is happening, then clears', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS, profile: 'child' });
  a.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false });
  calibrate(a, -62);
  const clipped = hardClip(scaleToPeak(tone(300, 0.3, { amp: 1 }), 1), 3, 0.99);
  feed(a, clipped);
  assert.equal(a.live.clipping, true);
  feed(a, withNoise(silence(1.0), -62));
  assert.equal(a.live.clipping, false);
});

test('quality keeps its previous shape and gains peakAbs / clipFraction', () => {
  const { result } = runTrial(scaleToPeak(tone(300, 3, { amp: 1 }), 0.3));
  for (const k of ['noiseFloorDb', 'snrDb', 'clippedSamples', 'captureProcessing', 'flags', 'reliable']) assert.ok(k in result.quality, k);
  assert.ok('peakAbs' in result.quality && 'clipFraction' in result.quality);
  assert.equal(result.quality.reliable, true);
});
