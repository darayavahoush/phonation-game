/**
 * Acoustic voicing cue for stop consonants (p/b, t/d, k/g), measured from the raw audio.
 *
 * The phoneme model is weak at telling a voiced stop from its voiceless twin in one short syllable
 * (p/b, t/d). Voicing has direct acoustic evidence the model does not use reliably:
 *   - VOT (voice onset time): ms from the release burst to the start of vocal-fold vibration.
 *     Long (about 30+ ms) = voiceless/aspirated; near zero = voiced.
 *   - Pre-voicing: vibration already running during the closure, before the burst ("voice bar").
 *     Typical of voiced stops in many languages, including Tamil and Hindi.
 *
 * EXPERIMENTAL and UNCALIBRATED: the thresholds below come from the phonetics literature for
 * adult speech, not from your recordings. The lab exports the raw numbers so they can be tuned.
 */

export const VOICING_CUE = Object.freeze({
  HOP: 80, // 5 ms at 16 kHz
  VOICELESS_VOT_MS: 30, // VOT at or above this, with no pre-voicing = voiceless-like
  VOICED_VOT_MS: 8, // VOT at or below this = voiced-like
  PREVOICED_MS: 25, // pre-voicing at or above this = voiced-like
  MIN_BURST_JUMP_DB: 8, // a burst must lift high-frequency energy at least this much in one hop
  NCCF_VOICED: 0.5, // normalised autocorrelation peak that counts as periodic
});

const VOICED_STOPS = new Set(['b', 'd', 'g']);
const VOICELESS_STOPS = new Set(['p', 't', 'k']);
export const cueApplies = (unit) => VOICED_STOPS.has(unit) || VOICELESS_STOPS.has(unit);

const db = (x) => 10 * Math.log10(Math.max(x, 1e-12));

/** @param {Float32Array} x mono audio  @param {number} sr sample rate (expects about 16000) */
export function stopVoicingCue(x, sr = 16000) {
  const hop = Math.round(sr * 0.005);
  const n = Math.floor(x.length / hop);
  if (n < 20) return { ok: false, reason: 'too_short' };

  // Per-hop total and high-frequency (first-difference) energy.
  const eTot = new Float32Array(n);
  const eHf = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0, h = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      s += x[i] * x[i];
      const d = x[i] - (i > 0 ? x[i - 1] : 0);
      h += d * d;
    }
    eTot[f] = db(s / hop);
    eHf[f] = db(h / hop);
  }
  const sorted = Array.from(eTot).sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.15)];
  const peak = sorted[n - 1];
  if (peak - floor < 25) return { ok: false, reason: 'low_dynamic_range' };

  // Vowel nucleus: first hop within 12 dB of the peak.
  let vowel = 0;
  while (vowel < n && eTot[vowel] < peak - 12) vowel++;
  if (vowel >= n || vowel < 2) return { ok: false, reason: 'no_vowel_onset' };

  // Release burst: the LAST strong one-hop jump in high-frequency energy before the vowel nucleus.
  // (An earlier jump can be the start of pre-voicing; the burst is the one closest to the vowel.)
  const jumps = new Float32Array(n);
  let best = 0;
  for (let f = 1; f <= vowel; f++) {
    jumps[f] = eTot[f] > floor + 10 ? eHf[f] - eHf[f - 1] : 0;
    if (jumps[f] > best) best = jumps[f];
  }
  if (best < VOICING_CUE.MIN_BURST_JUMP_DB) return { ok: false, reason: 'no_burst' };
  let burst = -1;
  for (let f = vowel; f >= 1; f--) if (jumps[f] >= Math.max(VOICING_CUE.MIN_BURST_JUMP_DB, 0.6 * best)) { burst = f; break; }

  // Periodicity per hop (30 ms window centred on the hop) for the region around the burst.
  const win = Math.round(sr * 0.03);
  const lagMin = Math.floor(sr / 400), lagMax = Math.floor(sr / 60);
  const lo = Math.max(0, burst - 24), hi = Math.min(n - 1, burst + 40);
  const voiced = new Array(n).fill(false);
  for (let f = lo; f <= hi; f++) {
    if (eTot[f] < floor + 6) continue;
    const c = f * hop + (hop >> 1);
    const a = Math.max(0, c - (win >> 1));
    const b = Math.min(x.length - lagMax - 1, a + win);
    if (b - a < win / 2) continue;
    let e0 = 0;
    for (let i = a; i < b; i++) e0 += x[i] * x[i];
    let bestR = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let xy = 0, e1 = 0;
      for (let i = a; i < b; i++) { xy += x[i] * x[i + lag]; e1 += x[i + lag] * x[i + lag]; }
      const r = xy / Math.sqrt(Math.max(e0 * e1, 1e-18));
      if (r > bestR) bestR = r;
    }
    voiced[f] = bestR >= VOICING_CUE.NCCF_VOICED;
  }

  // Pre-voicing: consecutive voiced hops ending just before the burst. The 30 ms analysis window
  // around the last few hops overlaps the burst itself, so start 4 hops (20 ms) earlier and allow
  // short gaps; the skipped hops are counted in because voicing runs on up to the burst.
  let pre = 0, gap = 0;
  for (let f = burst - 4; f >= lo; f--) {
    if (voiced[f]) { pre++; gap = 0; } else if (++gap > 2) break;
  }
  if (pre > 0) pre += 4;
  const prevoicedMs = Math.round(pre * 5);

  // VOT: from the burst to the first voiced hop at or after it.
  let onset = -1;
  for (let f = burst; f <= hi; f++) if (voiced[f]) { onset = f; break; }
  if (onset < 0) return { ok: false, reason: 'no_voicing_after_burst', prevoicedMs };
  const votMs = Math.round((onset - burst) * 5);

  let call = 'unclear';
  if (prevoicedMs >= VOICING_CUE.PREVOICED_MS) call = 'voiced';
  else if (votMs <= VOICING_CUE.VOICED_VOT_MS) call = 'voiced';
  else if (votMs >= VOICING_CUE.VOICELESS_VOT_MS && prevoicedMs < 10) call = 'voiceless';
  return { ok: true, burstMs: Math.round(burst * 5), votMs, prevoicedMs, call };
}

/**
 * Final call on the starting consonant. The model decides when it is clear. When it is torn between
 * a stop and its voicing twin, a clear acoustic cue breaks the tie. Never both a model win and a
 * cue loss with confidence: that is reported as 'unsure'.
 * @returns {{final: 'correct'|'wrong'|'unsure', decidedBy: 'model'|'acoustic'|'none'}}
 */
export function decideConsonant(consonant, cue, targetUnit) {
  if (!consonant) return null;
  const v = consonant.verdict;
  const targetVoiced = VOICED_STOPS.has(targetUnit);
  const twinBestRival = consonant.twin && consonant.bestCompetitor
    && consonant.voicing !== undefined; // twin info present
  const cueUsable = cue && cue.ok && cueApplies(targetUnit);
  const cueSaysTarget = cueUsable && cue.call === (targetVoiced ? 'voiced' : 'voiceless');
  const cueSaysTwin = cueUsable && cue.call === (targetVoiced ? 'voiceless' : 'voiced');

  if (v === 'competitor_dominant') {
    // The model prefers another sound. If that sound is the voicing twin and the cue clearly says
    // the target, the model and the audio disagree: do not call it correct, do not call it wrong.
    if (twinBestRival && consonant.voicing === 'twin' && cueSaysTarget) return { final: 'unsure', decidedBy: 'none' };
    return { final: 'wrong', decidedBy: 'model' };
  }
  if (v === 'target_dominant') {
    if (cueSaysTwin && consonant.llr < 1.5 && twinBestRival) return { final: 'unsure', decidedBy: 'none' };
    return { final: 'correct', decidedBy: 'model' };
  }
  // ambiguous or weak: only the voicing twin can be rescued by acoustics, and only if the place is right.
  if (v === 'ambiguous' && twinBestRival && consonant.place === 'ok') {
    if (cueSaysTarget) return { final: 'correct', decidedBy: 'acoustic' };
    if (cueSaysTwin) return { final: 'wrong', decidedBy: 'acoustic' };
  }
  return { final: 'unsure', decidedBy: 'none' };
}
