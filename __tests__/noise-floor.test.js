import test from 'node:test';
import assert from 'node:assert/strict';

import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { NOISE_FLOOR, NoiseTracker, estimateFloor, primaryIssueOf } from '../noiseFloor.js';
import { FS, rng, noise, tone, burst, silence, concat, withNoise, feed } from './synth.js';

const LEVEL = { id: 's', type: 'sustained_voicing', targetDurationSec: 1 };
const ROOM_DB = -62; // a quiet room in these synthetic tests

function analyzer() {
  const a = new PhonationAnalyzer({ sampleRate: FS, profile: 'child' });
  a.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false });
  return a;
}

function calibrateOn(a, signal) {
  a.startCalibration();
  feed(a, signal);
  return a.finishCalibration();
}

/** A trial of one voiced second, with the room noise underneath. */
function trialWith(a, { amp = 0.05, roomDb = ROOM_DB } = {}) {
  a.beginTrial(LEVEL);
  feed(a, withNoise(concat(silence(0.4), tone(220, 1.5, { amp }), silence(0.4)), roomDb));
  return a.endTrial();
}

// ---------------------------------------------------------------- calibration

test('a cough during calibration does not make a quiet room "noisy"', () => {
  const a = analyzer();
  const cal = calibrateOn(a, concat(noise(0.5, ROOM_DB, 1), burst(0.3, 0.08), noise(0.7, ROOM_DB, 2)));
  assert.ok(cal.noise.db < -55, `floor should stay near the room (~-67), got ${cal.noise.db}`);
  assert.ok(!cal.warnings.includes('high_noise'), cal.warnings.join());
  assert.ok(cal.warnings.includes('unstable_background'), 'the disturbance is still reported');

  const r = trialWith(a);
  assert.equal(r.quality.reliable, true, JSON.stringify(r.quality));
  assert.equal(r.quality.primaryIssue, null);
});

test('calibrating while the child is talking is corrected by the quiet seconds that follow', () => {
  const a = analyzer();
  // voice for 97% of the calibration window: no quiet baseline to measure
  const cal = calibrateOn(a, withNoise(concat(tone(220, 1.45, { amp: 0.15 }), silence(0.05)), ROOM_DB));
  assert.ok(cal.noise.db > -45, 'the calibration alone is wrong, as expected');

  feed(a, noise(4, ROOM_DB, 5)); // the room is quiet again
  const r = trialWith(a);
  assert.equal(r.quality.noiseSource, 'tracked');
  assert.ok(r.quality.noiseFloorDb < -55, `floor ${r.quality.noiseFloorDb}`);
  assert.equal(r.quality.reliable, true, JSON.stringify(r.quality));
});

test('a room that gets louder after calibration is still caught', () => {
  const a = analyzer();
  const cal = calibrateOn(a, noise(1.5, ROOM_DB, 3));
  assert.ok(cal.ok, cal.warnings.join());

  feed(a, noise(12, -35, 8)); // a fan / TV / classmates start
  const r = trialWith(a, { amp: 0.03, roomDb: -35 });
  assert.ok(r.quality.flags.includes('high_noise'), JSON.stringify(r.quality));
  assert.equal(r.quality.primaryIssue, 'room_noisy');
  assert.equal(r.quality.reliable, false);
});

test('calibration reports how disturbed it was', () => {
  const quiet = calibrateOn(analyzer(), noise(1.5, ROOM_DB, 3));
  assert.ok(quiet.transientFraction < 0.02, `quiet ${quiet.transientFraction}`);
  const coughing = calibrateOn(analyzer(), concat(noise(0.5, ROOM_DB, 1), burst(0.3, 0.08), noise(0.7, ROOM_DB, 2)));
  assert.ok(coughing.transientFraction > 0.1, `coughing ${coughing.transientFraction}`);
});

// ------------------------------------------------------------ voice vs room

test('a soft voice in a quiet room is "voice_soft", not "room_noisy"', () => {
  const a = analyzer();
  calibrateOn(a, noise(1.5, ROOM_DB, 3));
  const r = trialWith(a, { amp: 0.004 });
  assert.ok(r.quality.flags.includes('low_snr'), JSON.stringify(r.quality));
  assert.ok(!r.quality.flags.includes('high_noise'));
  assert.equal(r.quality.primaryIssue, 'voice_soft');
  assert.equal(r.quality.reliable, false);
});

test('a normal voice in a quiet room is reliable and says where the floor came from', () => {
  const a = analyzer();
  calibrateOn(a, noise(1.5, ROOM_DB, 3));
  const r = trialWith(a);
  assert.equal(r.quality.reliable, true);
  assert.equal(r.quality.primaryIssue, null);
  assert.ok(['calibration', 'tracked'].includes(r.quality.noiseSource));
  JSON.parse(JSON.stringify(r)); // still serialisable
});

test('primaryIssueOf: one reason, noise outranks soft voice', () => {
  assert.equal(primaryIssueOf([]), null);
  assert.equal(primaryIssueOf(['low_snr']), 'voice_soft');
  assert.equal(primaryIssueOf(['high_noise', 'low_snr']), 'room_noisy');
  assert.equal(primaryIssueOf(['clipping', 'high_noise']), 'too_loud');
  assert.equal(primaryIssueOf(['capture_processing']), 'device_processing');
  assert.equal(primaryIssueOf(['not_calibrated', 'high_noise']), 'not_calibrated');
  assert.equal(primaryIssueOf(['no_voicing']), 'no_voice');
});

// -------------------------------------------------------------- estimator

function fakeFrames(n, { quietDb = -60, loudDb = -30, loudShare = 0, seed = 4 } = {}) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const loud = i / n >= 1 - loudShare;
    const db = (loud ? loudDb : quietDb) + (r() - 0.5) * 3;
    return { db, hfDb: db - 10, lfDb: db - 5, voiced: loud };
  });
}

test('estimateFloor ignores transients but reports their share', () => {
  const e = estimateFloor(fakeFrames(300, { loudShare: 0.18 }));
  assert.ok(Math.abs(e.db - -59) < 3, `floor ${e.db}`);
  assert.ok(Math.abs(e.transientFraction - 0.18) < 0.03, `share ${e.transientFraction}`);
});

test('estimateFloor reports a steadily loud room as loud (it cannot be mistaken for a transient)', () => {
  const e = estimateFloor(fakeFrames(300, { quietDb: -40 }));
  assert.ok(Math.abs(e.db - -38.5) < 3, `floor ${e.db}`);
  assert.ok(e.transientFraction < 0.02);
});

test('estimateFloor refuses to guess from too little', () => {
  assert.equal(estimateFloor([]), null);
  assert.equal(estimateFloor(null), null);
  assert.equal(estimateFloor(fakeFrames(30)), null);
});

// ---------------------------------------------------------------- tracker

test('tracker needs history, and does not trust a window that is mostly voice', () => {
  const hop = 0.005;
  const t = new NoiseTracker({ hopSec: hop });
  for (const f of fakeFrames(Math.round(2 / hop))) t.push(f);
  assert.equal(t.estimate(), null, 'under MIN_TRACK_SEC');

  const t2 = new NoiseTracker({ hopSec: hop });
  for (const f of fakeFrames(Math.round(NOISE_FLOOR.WINDOW_SEC / hop), { loudShare: 0.7 })) t2.push(f);
  assert.equal(t2.estimate(), null, '70% voiced');

  const t3 = new NoiseTracker({ hopSec: hop });
  for (const f of fakeFrames(Math.round(NOISE_FLOOR.WINDOW_SEC / hop), { loudShare: 0.3 })) t3.push(f);
  const e = t3.estimate();
  assert.ok(e && Math.abs(e.db - -59) < 3, `floor ${e && e.db}`);
});

test('tracker forgets: only the last WINDOW_SEC counts', () => {
  const hop = 0.005;
  const t = new NoiseTracker({ hopSec: hop });
  for (const f of fakeFrames(Math.round(15 / hop), { quietDb: -30 })) t.push(f); // old loud room
  for (const f of fakeFrames(Math.round(NOISE_FLOOR.WINDOW_SEC / hop), { quietDb: -60 })) t.push(f); // now quiet
  assert.ok(t.estimate().db < -55);
});

// ------------------------------------------------- noise only matters if it drowns the voice

test('a high floor with a clearly stronger voice is still reliable', () => {
  const a = analyzer();
  calibrateOn(a, noise(1.5, -40, 7)); // loud-ish room, over the -45 limit
  const r = trialWith(a, { amp: 0.3, roomDb: -40 });
  assert.ok(r.quality.snrDb >= 15, `snr ${r.quality.snrDb}`);
  assert.equal(r.quality.reliable, true, JSON.stringify(r.quality));
  assert.equal(r.quality.primaryIssue, null);
});

test('a high floor with a weak voice is "room_noisy" and unreliable', () => {
  const a = analyzer();
  calibrateOn(a, noise(1.5, -35, 8));
  const r = trialWith(a, { amp: 0.03, roomDb: -35 });
  assert.equal(r.quality.reliable, false, JSON.stringify(r.quality));
  assert.equal(r.quality.primaryIssue, 'room_noisy');
});
