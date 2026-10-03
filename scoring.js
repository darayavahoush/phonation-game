import { LEVEL_TYPES, mannerOf, MANNERS } from './levelSchema.js';
import {
  voicedFlags, segmentsFromFlags, longestSegment, f0ContourSt, monotonicity,
  findNuclei, analyzeOnset, downsampleContour,
} from './analysis.js';
import { mean, median, sd, percentile, slope, round, clamp } from './dsp.js';

export const SCHEMA_VERSION = 1;

/** Compensates the ~10 ms lag between true voicing onset and the periodicity decision. Measured on synthetic signals only — see README "Validation status". */
export const VOICING_LAG_MS = 10;

export const QUALITY = Object.freeze({
  HIGH_NOISE_DB: -45, // calibrated room noise above this (dBFS) is flagged
  CLIP_SAMPLES: 10, // minimum flat-top samples before a trial can be flagged
  CLIP_FRACTION: 0.001, // ...and they must be at least this share of the trial's samples (placeholder, not validated on real devices)
});

const BRIDGE_SEC = 0.06; // unvoiced gaps shorter than this don't end a voiced segment

// ------------------------------------------------------------------ helpers

function statsOf(frames, a, b) {
  const dbs = frames.slice(a, b + 1).map((f) => f.db);
  return { meanDb: mean(dbs), sdDb: sd(dbs) };
}

function f0Stats(frames, a, b, trimFrames) {
  const lo = b - a > 2 * trimFrames + 4 ? a + trimFrames : a; // drop onset/offset transients
  const hi = b - a > 2 * trimFrames + 4 ? b - trimFrames : b;
  const pts = f0ContourSt(frames, lo, hi);
  if (pts.length < 3) return { meanHz: null, sdSemitones: null, rangeSemitones: null };
  const st = pts.map((p) => p.st);
  const meanSt = mean(st);
  return {
    meanHz: round(100 * 2 ** (meanSt / 12), 1), // geometric mean in Hz
    sdSemitones: round(sd(st), 2),
    rangeSemitones: round(percentile(st, 95) - percentile(st, 5), 2),
  };
}

function starsFor(passed, progress, anyVoicing) {
  if (passed) return 3;
  if (progress >= 0.6) return 2;
  return anyVoicing ? 1 : 0;
}

// ------------------------------------------------------------------ scorers

function scoreSustained(level, ctx) {
  const { frames, hopSec, noise } = ctx;
  const flags = voicedFlags(frames, Math.round(BRIDGE_SEC / hopSec));
  const segs = segmentsFromFlags(flags, hopSec, 0.1);
  const best = longestSegment(segs);
  const totalVoiced = segs.reduce((s, x) => s + x.durSec, 0);

  const metrics = {
    mptSec: best ? round(best.durSec, 2) : 0,
    voicedSegments: segs.length,
    totalVoicedSec: round(totalVoiced, 2),
    phonationRatio: null,
    meanDb: null,
    sdDb: null,
    meanSnrDb: null,
    f0MeanHz: null,
    f0SdSemitones: null,
    steady: null,
  };
  let events = [];
  if (segs.length) {
    const first = segs[0];
    const last = segs[segs.length - 1];
    metrics.phonationRatio = round(totalVoiced / ((last.endIdx - first.startIdx + 1) * hopSec), 2);
    events = segs.map((s) => ({ tSec: round(frames[s.startIdx].t - ctx.t0, 2), durSec: round(s.durSec, 2) }));
  }
  if (best) {
    const trim = Math.round(0.1 / hopSec);
    const a = best.endIdx - best.startIdx > 2 * trim + 4 ? best.startIdx + trim : best.startIdx;
    const b = best.endIdx - best.startIdx > 2 * trim + 4 ? best.endIdx - trim : best.endIdx;
    const s = statsOf(frames, a, b);
    metrics.meanDb = round(s.meanDb, 1);
    metrics.sdDb = round(s.sdDb, 2);
    metrics.meanSnrDb = round(s.meanDb - noise.db, 1);
    const f = f0Stats(frames, best.startIdx, best.endIdx, trim);
    metrics.f0MeanHz = f.meanHz;
    metrics.f0SdSemitones = f.sdSemitones;
    if (level.maxF0SdSemitones != null && f.sdSemitones != null) metrics.steady = f.sdSemitones <= level.maxF0SdSemitones;
  }

  const progress = clamp(metrics.mptSec / level.targetDurationSec, 0, 1);
  const snrOk = metrics.meanSnrDb != null && metrics.meanSnrDb >= level.minSnrDb;
  const passed = metrics.mptSec >= level.targetDurationSec && snrOk && metrics.steady !== false;
  return { passed, progress, metrics, events, voicedFrames: flags.filter(Boolean).length };
}

function nucleiFor(level, ctx) {
  const { frames, hopSec, noise } = ctx;
  const flags = voicedFlags(frames, 3);
  const nuclei = findNuclei(frames, flags, hopSec, noise.db, { minSnrDb: level.minSnrDb });
  return { flags, nuclei };
}

function scoreCv(level, ctx) {
  const { frames, hopSec, noise } = ctx;
  const { flags, nuclei } = nucleiFor(level, ctx);
  const events = nuclei
    .map((n) => {
      const o = analyzeOnset(frames, flags, n.onsetIdx, hopSec, noise, {
        votBoundaryMs: level.votBoundaryMs,
        voicingLagMs: VOICING_LAG_MS,
      });
      return {
        tSec: round(frames[n.onsetIdx].t - ctx.t0, 2),
        durMs: Math.round(n.durSec * 1000),
        peakSnrDb: round(n.peakDb - noise.db, 1),
        ...o,
      };
    })
    .filter((e) => e.durMs >= level.minSyllableMs);

  const expected = mannerOf(level.syllable);
  const classifiable = expected !== MANNERS.OTHER;
  const matches = classifiable ? events.filter((e) => e.onsetClass === expected).length : null;
  const vots = events.map((e) => e.votMs).filter((v) => v != null);

  const metrics = {
    syllableCount: events.length,
    expectedManner: expected,
    mannerMatches: matches, // experimental
    meanDurMs: events.length ? Math.round(mean(events.map((e) => e.durMs))) : null,
    meanPeakSnrDb: events.length ? round(mean(events.map((e) => e.peakSnrDb)), 1) : null,
    votMeanMs: vots.length ? round(mean(vots), 1) : null, // experimental
    votSdMs: vots.length > 1 ? round(sd(vots), 1) : null, // experimental
  };
  const progress = clamp(events.length / level.reps, 0, 1);
  const mannerOk = !level.requireMannerMatch || !classifiable || matches >= level.reps;
  const passed = events.length >= level.reps && mannerOk;
  return { passed, progress, metrics, events, voicedFrames: flags.filter(Boolean).length };
}

function scoreTrain(level, ctx) {
  const { flags, nuclei } = nucleiFor(level, ctx);
  const times = nuclei.map((n) => n.tPeak);
  const iois = times.slice(1).map((t, i) => t - times[i]);
  const rate = nuclei.length >= 2 ? (nuclei.length - 1) / (times[times.length - 1] - times[0]) : null;
  const cvIoi = iois.length >= 2 ? sd(iois) / mean(iois) : null;

  const metrics = {
    syllableCount: nuclei.length,
    ratePerSec: round(rate, 2),
    ioiMeanMs: iois.length ? Math.round(mean(iois) * 1000) : null,
    ioiCv: round(cvIoi, 3), // rhythm regularity: lower = more regular
    peakDbSd: nuclei.length > 1 ? round(sd(nuclei.map((n) => n.peakDb)), 2) : null,
  };
  const events = nuclei.map((n) => ({ tSec: round(n.tPeak - ctx.t0, 2), peakDb: round(n.peakDb, 1) }));

  let rateOk = true;
  if (level.targetRateMin != null) rateOk = rateOk && rate != null && rate >= level.targetRateMin;
  if (level.targetRateMax != null) rateOk = rateOk && rate != null && rate <= level.targetRateMax;
  const progress = clamp(nuclei.length / level.minSyllables, 0, 1);
  const passed = nuclei.length >= level.minSyllables && rateOk;
  return { passed, progress, metrics, events, voicedFrames: flags.filter(Boolean).length };
}

function scoreGlide(level, ctx) {
  const { frames, hopSec } = ctx;
  const flags = voicedFlags(frames, Math.round(BRIDGE_SEC / hopSec));
  const best = longestSegment(segmentsFromFlags(flags, hopSec, 0.2));
  const metrics = {
    durationSec: best ? round(best.durSec, 2) : 0,
    startHz: null, endHz: null, rangeSemitones: null,
    slopeStPerSec: null, monotonicity: null, directionOk: null,
  };
  let passed = false;
  let progress = 0;
  if (best) {
    const pts = f0ContourSt(frames, best.startIdx, best.endIdx);
    if (pts.length >= 10) {
      const st = pts.map((p) => p.st);
      const ts = pts.map((p) => p.t);
      const edge = Math.min(5, Math.floor(pts.length / 4));
      const toHz = (v) => round(100 * 2 ** (v / 12), 1);
      metrics.startHz = toHz(median(st.slice(0, edge)));
      metrics.endHz = toHz(median(st.slice(-edge)));
      metrics.rangeSemitones = round(percentile(st, 95) - percentile(st, 5), 2);
      const sl = slope(ts, st);
      metrics.slopeStPerSec = round(sl, 2);
      metrics.directionOk = level.direction === 'up' ? sl > 0 : sl < 0;
      metrics.monotonicity = round(monotonicity(ts, st, level.direction, { tol: 0.5 }), 2);
      progress = clamp(metrics.rangeSemitones / level.minRangeSemitones, 0, 1);
      passed = metrics.rangeSemitones >= level.minRangeSemitones && metrics.directionOk && (metrics.monotonicity ?? 0) >= 0.7;
    }
  }
  return { passed, progress, metrics, events: [], voicedFrames: flags.filter(Boolean).length };
}

function scoreRamp(level, ctx) {
  const { frames, hopSec } = ctx;
  const flags = voicedFlags(frames, Math.round(BRIDGE_SEC / hopSec));
  const best = longestSegment(segmentsFromFlags(flags, hopSec, 0.3));
  const metrics = { durationSec: best ? round(best.durSec, 2) : 0, startDb: null, endDb: null, deltaDb: null, monotonicity: null };
  let passed = false;
  let progress = 0;
  if (best) {
    const seg = frames.slice(best.startIdx, best.endIdx + 1);
    const ts = seg.map((f) => f.t);
    const dbs = seg.map((f) => f.db);
    const edge = Math.max(3, Math.floor(seg.length * 0.2));
    metrics.startDb = round(median(dbs.slice(0, edge)), 1);
    metrics.endDb = round(median(dbs.slice(-edge)), 1);
    const signed = level.direction === 'up' ? metrics.endDb - metrics.startDb : metrics.startDb - metrics.endDb;
    metrics.deltaDb = round(signed, 1); // positive = moved in the requested direction
    metrics.monotonicity = round(monotonicity(ts, dbs, level.direction, { tol: 1.5 }), 2);
    progress = clamp(signed / level.minRangeDb, 0, 1);
    passed = signed >= level.minRangeDb && (metrics.monotonicity ?? 0) >= 0.7;
  }
  return { passed, progress, metrics, events: [], voicedFrames: flags.filter(Boolean).length };
}

const SCORERS = {
  [LEVEL_TYPES.SUSTAINED_VOICING]: scoreSustained,
  [LEVEL_TYPES.CV_SYLLABLE]: scoreCv,
  [LEVEL_TYPES.SYLLABLE_TRAIN]: scoreTrain,
  [LEVEL_TYPES.PITCH_GLIDE]: scoreGlide,
  [LEVEL_TYPES.LOUDNESS_RAMP]: scoreRamp,
};

// ------------------------------------------------------------------ quality

function qualityOf(trial, voicedFrames) {
  const flags = [];
  const { noise, calibrated, captureInfo = {} } = trial;
  if (!calibrated) flags.push('not_calibrated');
  if (noise.db > QUALITY.HIGH_NOISE_DB) flags.push('high_noise');
  const total = trial.totalSamples || 0;
  const clipLimit = Math.max(QUALITY.CLIP_SAMPLES, QUALITY.CLIP_FRACTION * total);
  if (trial.clippedSamples >= clipLimit) flags.push('clipping');
  if (captureInfo.autoGainControl || captureInfo.noiseSuppression || captureInfo.echoCancellation) flags.push('capture_processing');
  if (voicedFrames === 0) flags.push('no_voicing');

  const voicedDb = trial.frames.filter((f) => f.voiced).map((f) => f.db);
  const snrDb = voicedDb.length ? median(voicedDb) - noise.db : null;
  if (snrDb != null && snrDb < 15) flags.push('low_snr');

  const unreliable = ['not_calibrated', 'high_noise', 'clipping', 'capture_processing', 'low_snr'];
  return {
    noiseFloorDb: round(noise.db, 1),
    snrDb: round(snrDb, 1),
    clippedSamples: trial.clippedSamples,
    clipFraction: total ? round(trial.clippedSamples / total, 4) : null,
    peakAbs: trial.peakAbs != null ? round(trial.peakAbs, 3) : null,
    captureProcessing: { ...captureInfo },
    flags,
    reliable: !flags.some((f) => unreliable.includes(f)),
  };
}

/**
 * Score a finished trial.
 * @param {object} level  a validated level (see validateLevel)
 * @param {{frames:object[], hopSec:number, noise:object, calibrated:boolean,
 *          clippedSamples:number, captureInfo?:object, startT:number, startedAtMs:number}} trial
 */
export function scoreTrial(level, trial) {
  const scorer = SCORERS[level.type];
  if (!scorer) throw new Error(`No scorer for type "${level.type}"`);
  const ctx = { frames: trial.frames, hopSec: trial.hopSec, noise: trial.noise, t0: trial.startT };
  const r = scorer(level, ctx);
  const quality = qualityOf(trial, r.voicedFrames);
  const durationSec = trial.frames.length ? trial.frames[trial.frames.length - 1].t - trial.startT : 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    levelId: level.id,
    type: level.type,
    startedAt: new Date(trial.startedAtMs).toISOString(),
    durationSec: round(durationSec, 2),
    passed: r.passed,
    progress: round(r.progress, 2),
    stars: starsFor(r.passed, r.progress, r.voicedFrames > 0),
    metrics: r.metrics,
    events: r.events,
    contour: level.recordContour ? downsampleContour(trial.frames, trial.startT) : undefined,
    quality,
  };
}
