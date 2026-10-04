/**
 * Phoneme-posterior evidence for isolated syllables (EXPERIMENTAL).
 *
 * Works on a CTC posteriorgram (frames x vocab probabilities). For a short, isolated
 * syllable like "ba" we do not need forced alignment: we ask "did the model ever give
 * the target phone clearly more probability than any competing phone?". The result is a
 * GOP-style log-posterior ratio, NOT a validated pronunciation score.
 */

const SPECIAL = /^(<.*>|\||\s*)$/; // <pad> <s> </s> <unk> | and blanks
const CONSONANT = /^[pbtdkgɡmnŋfvszʃʒθðhlɹrjwʔçxɣɾʧʤ]/;

export const isSpecial = (l) => SPECIAL.test(String(l));
export const isConsonantLabel = (l) => !isSpecial(l) && CONSONANT.test(String(l));

/** Candidate IPA labels per orthographic letter. Verified against the real vocab at runtime. */
export const PHONE_CANDIDATES = Object.freeze({
  b: ['b'], d: ['d'], g: ['ɡ', 'g'], p: ['p'], t: ['t'], k: ['k'], m: ['m'], n: ['n'],
  a: ['ɑ', 'a', 'ɑː', 'aː', 'ɐ'],
  e: ['e', 'ɛ', 'eː', 'eɪ'],
  i: ['i', 'iː', 'ɪ'],
  o: ['o', 'oʊ', 'ɔ', 'oː'],
  u: ['u', 'uː', 'ʊ'],
});

export const THRESHOLDS = Object.freeze({
  LLR_MARGIN: 0.7, // ln(2): target peak at least ~2x the best competitor
  WEAK_PEAK: 0.1, // below this neither side has real evidence
});

/** Accepts an array, a Map(label->id), or a plain {label: id} object. Returns label[] indexed by id. */
export function normalizeVocab(v) {
  if (Array.isArray(v)) return v.slice();
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v || {});
  const out = [];
  for (const [label, id] of entries) out[Number(id)] = label;
  return out;
}

/** Row-wise softmax over a flat logits array of shape [T, V]. */
export function softmaxRows(logits, T, V) {
  const rows = [];
  for (let t = 0; t < T; t++) {
    const row = new Float32Array(V);
    let max = -Infinity;
    for (let v = 0; v < V; v++) max = Math.max(max, logits[t * V + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) { row[v] = Math.exp(logits[t * V + v] - max); sum += row[v]; }
    for (let v = 0; v < V; v++) row[v] /= sum;
    rows.push(row);
  }
  return rows;
}

/** Greedy CTC decode: argmax per frame, collapse repeats, drop special tokens. */
export function ctcGreedy(post, vocab) {
  const out = [];
  let prev = -1;
  for (const row of post) {
    let best = 0;
    for (let v = 1; v < row.length; v++) if (row[v] > row[best]) best = v;
    if (best !== prev && !isSpecial(vocab[best])) out.push(vocab[best]);
    prev = best;
  }
  return out;
}

/**
 * Reduce a vocab label to its base phone: drop tone digits (ɑ5), length (aː), aspiration/
 * palatalisation/labialisation (tʰ, kʲ), stress and combining marks. The espeak vocab holds many
 * such variants of one sound; they must all count as the SAME phone, not as competitors.
 */
export function basePhone(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u02e5-\u02e9]/g, '') // combining marks, tone letters
    .replace(/[0-9ːˑʰʲʷʼˈˌ.]/g, '');
}

/** Base phones that count as the same sound as an orthographic letter. */
const FAMILY = Object.freeze({
  b: ['b'], d: ['d'], g: ['ɡ', 'g'], p: ['p'], t: ['t'], k: ['k'], m: ['m'], n: ['n'],
  a: ['a', 'ɑ', 'ɐ'], e: ['e', 'ɛ', 'eɪ'], i: ['i', 'ɪ'], o: ['o', 'ɔ', 'oʊ'], u: ['u', 'ʊ'],
});

/** Map a syllable like "ba" to the vocab labels that could represent its consonant and vowel. */
export function resolveTargets(syllable, vocab) {
  const s = String(syllable || '').toLowerCase();
  const letters = [...s];
  const consonantLetter = letters.find((c) => 'bdgptkmn'.includes(c)) || null;
  const vowelLetter = [...letters].reverse().find((c) => 'aeiou'.includes(c)) || null;
  const find = (letter) => {
    if (!letter) return null;
    const fam = new Set(FAMILY[letter] || []);
    const ids = [];
    vocab.forEach((l, i) => { if (l != null && !isSpecial(l) && fam.has(basePhone(l))) ids.push(i); });
    return { letter, labels: ids.map((i) => vocab[i]), ids };
  };
  const consonant = find(consonantLetter);
  const vowel = find(vowelLetter);
  const missing = [consonant, vowel].filter((x) => x && x.labels.length === 0).map((x) => x.letter);
  return { consonant, vowel, missing };
}

function peakOf(post, ids) {
  let peak = 0;
  let id = -1;
  for (const row of post) for (const i of ids) if (row[i] > peak) { peak = row[i]; id = i; }
  return { peak, id };
}

function evidence(post, vocab, target, isCompetitor) {
  const tIds = new Set(target.ids);
  const compIds = [];
  vocab.forEach((l, i) => { if (!tIds.has(i) && !isSpecial(l) && isCompetitor(l)) compIds.push(i); });
  const t = peakOf(post, target.ids);
  const c = peakOf(post, compIds);
  const eps = 1e-6;
  const llr = Math.log(Math.max(t.peak, eps) / Math.max(c.peak, eps));
  let verdict = 'ambiguous';
  if (t.peak < THRESHOLDS.WEAK_PEAK && c.peak < THRESHOLDS.WEAK_PEAK) verdict = 'weak_evidence';
  else if (llr >= THRESHOLDS.LLR_MARGIN) verdict = 'target_dominant';
  else if (llr <= -THRESHOLDS.LLR_MARGIN) verdict = 'competitor_dominant';
  return {
    target: target.letter,
    targetLabels: target.labels,
    targetPeak: Math.round(t.peak * 1000) / 1000,
    bestCompetitor: c.id >= 0 ? vocab[c.id] : null,
    competitorPeak: Math.round(c.peak * 1000) / 1000,
    llr: Math.round(llr * 100) / 100,
    verdict,
  };
}

/**
 * @param {Float32Array[]} post   frames x V probabilities
 * @param {string[]|Map|object} vocabIn
 * @param {string} syllable       e.g. "ba"
 */
export function scorePosteriors(post, vocabIn, syllable) {
  const vocab = normalizeVocab(vocabIn);
  const heard = ctcGreedy(post, vocab);
  const targets = resolveTargets(syllable, vocab);
  if (targets.missing.length) {
    return { ok: false, reason: 'target_labels_not_in_vocab', missing: targets.missing, heard };
  }
  const out = { ok: true, heard, consonant: null, vowel: null, thresholds: THRESHOLDS };
  if (targets.consonant) out.consonant = evidence(post, vocab, targets.consonant, isConsonantLabel);
  if (targets.vowel) out.vowel = evidence(post, vocab, targets.vowel, (l) => !isConsonantLabel(l));
  return out;
}
