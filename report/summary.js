/**
 * De-identified session summary for LLM-drafted notes. WHITELIST-based: only the fields named
 * here can ever appear, so names, player codes, emails, timestamps and audio cannot leak.
 * This module makes NO network calls; sending the summary anywhere is the app's decision,
 * and a clinician must review any generated text.
 */
import { median } from '../dsp.js';

const EXPERIMENTAL_METRICS = new Set(['votMeanMs', 'votSdMs', 'mannerMatches', 'expectedManner']);
const SKIP_METRICS = new Set(['steady']); // booleans handled separately

function numericMetrics(results) {
  const keys = new Set();
  results.forEach((r) => Object.entries(r.metrics || {}).forEach(([k, v]) => {
    if (typeof v === 'number' && !EXPERIMENTAL_METRICS.has(k) && !SKIP_METRICS.has(k)) keys.add(k);
  }));
  const out = {};
  for (const k of keys) {
    const vals = results.map((r) => r.metrics[k]).filter((v) => typeof v === 'number');
    if (vals.length) out[k] = { median: Math.round(median(vals) * 100) / 100, n: vals.length };
  }
  return out;
}

/**
 * @param {object[]} results TrialResult[] in chronological order
 * @param {{ageBand?: string|null}} [opts] coarse band chosen by the caller, e.g. "5-6"
 */
export function summarizeForReport(results, { ageBand = null } = {}) {
  const byType = {};
  results.forEach((r) => { (byType[r.type] ||= []).push(r); });
  const types = Object.entries(byType).map(([type, rs]) => ({
    type,
    levels: [...new Set(rs.map((r) => r.levelId))],
    trials: rs.length,
    passed: rs.filter((r) => r.passed).length,
    unreliableTrials: rs.filter((r) => !r.quality.reliable).length,
    firstProgress: rs[0].progress,
    lastProgress: rs[rs.length - 1].progress,
    metrics: numericMetrics(rs),
  }));
  const flagCounts = {};
  results.forEach((r) => r.quality.flags.forEach((f) => { flagCounts[f] = (flagCounts[f] || 0) + 1; }));
  return {
    ageBand,
    totalTrials: results.length,
    qualityFlagCounts: flagCounts,
    types,
    excluded: 'Experimental metrics (VOT, manner) and any recognizer output are not included.',
  };
}

export function buildDraftPrompt(summary) {
  return [
    'You are helping a licensed speech-language pathologist draft a brief practice-session summary.',
    'Use ONLY the JSON below. Do not diagnose, do not infer causes, do not compare with norms,',
    'and do not mention anything that is not in the data. Intensity values are relative dBFS, not dB SPL.',
    'Where unreliableTrials or qualityFlagCounts are non-zero, say the data should be interpreted with caution.',
    'Start the text with "DRAFT - clinician review required."',
    '',
    JSON.stringify(summary, null, 2),
  ].join('\n');
}
