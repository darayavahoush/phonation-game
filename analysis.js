import { hzToSemitones, medianFilter, movingAverage, mean, median, round } from './dsp.js';

/** Voiced flags with short unvoiced gaps (<= maxGapFrames) bridged. */
export function voicedFlags(frames, maxGapFrames = 3) {
  const v = frames.map((f) => f.voiced);
  let i = 0;
  while (i < v.length) {
    if (!v[i]) {
      let j = i;
      while (j < v.length && !v[j]) j++;
      if (i > 0 && j < v.length && j - i <= maxGapFrames) for (let k = i; k < j; k++) v[k] = true;
      i = j;
    } else i++;
  }
  return v;
}

/** Contiguous runs of `true` lasting at least minDurSec. */
export function segmentsFromFlags(flags, hopSec, minDurSec = 0.03) {
  const segs = [];
  let i = 0;
  while (i < flags.length) {
    if (flags[i]) {
      let j = i;
      while (j + 1 < flags.length && flags[j + 1]) j++;
      const durSec = (j - i + 1) * hopSec;
      if (durSec >= minDurSec) segs.push({ startIdx: i, endIdx: j, durSec });
      i = j + 1;
    } else i++;
  }
  return segs;
}

export function longestSegment(segs) {
  let best = null;
  for (const s of segs) if (!best || s.durSec > best.durSec) best = s;
  return best;
}

/**
 * F0 contour of a frame range as semitones re refHz. Octave errors / tracking
 * glitches are rejected against a 5-frame running median (> 3 st away).
 */
export function f0ContourSt(frames, startIdx, endIdx, { refHz = 100, medianK = 5, maxDevSt = 3 } = {}) {
  const pts = [];
  for (let i = startIdx; i <= endIdx; i++) {
    if (frames[i].f0 > 0) pts.push({ idx: i, t: frames[i].t, st: hzToSemitones(frames[i].f0, refHz) });
  }
  if (!pts.length) return [];
  const sm = medianFilter(pts.map((p) => p.st), medianK);
  const out = [];
  pts.forEach((p, k) => {
    if (Math.abs(p.st - sm[k]) <= maxDevSt) out.push({ idx: p.idx, t: p.t, st: sm[k] });
  });
  return out;
}

/**
 * Fraction of consecutive bins (binSec wide, bin medians) that move in `dir`
 * ("up"/"down"), allowing `tol` of backwards movement.
 */
export function monotonicity(times, values, dir, { binSec = 0.1, tol = 0.5 } = {}) {
  if (times.length < 2) return null;
  const t0 = times[0];
  const bins = new Map();
  times.forEach((t, i) => {
    const b = Math.floor((t - t0) / binSec);
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(values[i]);
  });
  const med = [...bins.keys()].sort((a, b) => a - b).map((b) => median(bins.get(b)));
  if (med.length < 2) return null;
  let ok = 0;
  for (let i = 1; i < med.length; i++) {
    const d = med[i] - med[i - 1];
    if (dir === 'up' ? d >= -tol : d <= tol) ok++;
  }
  return ok / (med.length - 1);
}

/**
 * Syllable nuclei = prominent peaks of the smoothed intensity envelope inside
 * voiced speech (the standard approach for syllable counting / DDK rate;
 * cf. de Jong & Wempe, 2009). Peaks closer than minSepSec, or separated from a
 * neighbour by a dip shallower than minDipDb, are merged (the higher one wins).
 */
export function findNuclei(frames, flags, hopSec, noiseDb, opts = {}) {
  const { smoothSec = 0.035, minSepSec = 0.08, minDipDb = 3, minSnrDb = 10 } = opts;
  const n = frames.length;
  if (n < 3) return [];
  const sm = Math.max(1, Math.round(smoothSec / hopSec)) | 1;
  const env = movingAverage(frames.map((f) => f.db), sm);
  const minDist = Math.max(1, Math.round(minSepSec / hopSec));

  let peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (env[i] >= env[i - 1] && env[i] > env[i + 1] && flags[i] && env[i] - noiseDb >= minSnrDb) peaks.push(i);
  }
  const valleyBetween = (a, b) => {
    let vi = a;
    for (let i = a; i <= b; i++) if (env[i] < env[vi]) vi = i;
    return vi;
  };
  let changed = true;
  while (changed && peaks.length > 1) {
    changed = false;
    for (let k = 0; k < peaks.length - 1; k++) {
      const a = peaks[k];
      const b = peaks[k + 1];
      const dip = Math.min(env[a], env[b]) - env[valleyBetween(a, b)];
      if (dip < minDipDb || b - a < minDist) {
        peaks.splice(env[a] >= env[b] ? k + 1 : k, 1);
        changed = true;
        break;
      }
    }
  }

  return peaks.map((p, k) => {
    const valleyIdx = k > 0 ? valleyBetween(peaks[k - 1], p) : 0;
    let on = p;
    while (on > valleyIdx && flags[on - 1]) on--;
    const nextValley = k < peaks.length - 1 ? valleyBetween(p, peaks[k + 1]) : n - 1;
    let off = p;
    while (off < nextValley && flags[off + 1]) off++;
    return { peakIdx: p, tPeak: frames[p].t, peakDb: env[p], onsetIdx: on, offsetIdx: off, durSec: (off - on + 1) * hopSec };
  });
}

/**
 * Acoustic onset analysis for one syllable (EXPERIMENTAL — see README).
 *
 *  - burst: a sudden rise of 2–6 kHz energy in the 80 ms before voicing starts
 *  - votMs: burst -> voicing onset (voice onset time), null if no burst found
 *  - murmurDb: mean (80–1000 Hz) minus (2–6 kHz) level over the first 40 ms of
 *    voicing; large for nasals, which have strong low-frequency murmur
 *
 * Resolution is one hop (~5 ms). A fixed lag between true voicing onset and
 * YIN's periodicity decision is compensated with `voicingLagMs`.
 */
export function analyzeOnset(frames, flags, onsetIdx, hopSec, noise, opts = {}) {
  const {
    lookBackSec = 0.08,
    burstRiseDb = 12,
    burstAboveNoiseDb = 10,
    votBoundaryMs = 30,
    nasalMurmurDb = 30,
    voicingLagMs = 0,
  } = opts;

  const lookBack = Math.round(lookBackSec / hopSec);
  let burstIdx = -1;
  for (let i = Math.max(3, onsetIdx - lookBack); i < onsetIdx; i++) {
    if (flags[i]) continue;
    const prevMin = Math.min(frames[i - 1].hfDb, frames[i - 2].hfDb, frames[i - 3].hfDb);
    if (frames[i].hfDb - prevMin >= burstRiseDb && frames[i].hfDb >= noise.hfDb + burstAboveNoiseDb) {
      burstIdx = i;
      break;
    }
  }

  let votMs = null;
  if (burstIdx >= 0) {
    votMs = Math.max(0, (frames[onsetIdx].t - frames[burstIdx].t) * 1000 - voicingLagMs);
  }

  const end = Math.min(frames.length - 1, onsetIdx + Math.round(0.04 / hopSec));
  const diffs = [];
  for (let i = onsetIdx; i <= end; i++) diffs.push(frames[i].lfDb - frames[i].hfDb);
  const murmurDb = diffs.length ? mean(diffs) : null;

  let onsetClass = 'undetermined';
  if (burstIdx >= 0) onsetClass = votMs < votBoundaryMs ? 'voiced_stop' : 'voiceless_stop';
  else if (murmurDb != null && murmurDb >= nasalMurmurDb) onsetClass = 'nasal';
  else onsetClass = 'no_consonant_cue';

  return { burst: burstIdx >= 0, votMs: round(votMs, 1), murmurDb: round(murmurDb, 1), onsetClass };
}

/** 20 Hz intensity / F0 contour for therapist review (small, JSON-friendly). */
export function downsampleContour(frames, startT, stepSec = 0.05) {
  const bins = new Map();
  for (const f of frames) {
    const b = Math.floor((f.t - startT) / stepSec);
    if (b < 0) continue;
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(f);
  }
  return [...bins.keys()]
    .sort((a, b) => a - b)
    .map((b) => {
      const fs = bins.get(b);
      const voiced = fs.filter((f) => f.voiced && f.f0 > 0);
      return {
        t: round(b * stepSec, 2),
        db: round(mean(fs.map((f) => f.db)), 1),
        f0: voiced.length ? round(median(voiced.map((f) => f.f0)), 1) : null,
      };
    });
}
