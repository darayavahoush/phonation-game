/**
 * Phoneme-posterior evidence for isolated syllables (EXPERIMENTAL).
 *
 * Works on a CTC posteriorgram (frames x vocab probabilities). For a short, isolated
 * syllable like "ba" we do not need forced alignment: we ask "did the model ever give
 * the target phone clearly more probability than any competing phone?". The result is a
 * GOP-style log-posterior ratio, NOT a validated pronunciation score.
 */

const SPECIAL = /^(<.*>|\||\s*)$/; // <pad> <s> </s> <unk> | and blanks
const CONSONANT = /^[pbtdkgɡmnŋfvszʃʒθðhlɹrjwʔçxɣɾɻɫɬʧʤ]/;

export const isSpecial = (l) => SPECIAL.test(String(l));
export const isConsonantLabel = (l) => !isSpecial(l) && CONSONANT.test(String(l));

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
  return baseKeepDot(label).replace(/\./g, '');
}

/** Like basePhone but keeps the espeak retroflex dot (s. = ʂ), which some units list explicitly. */
export function baseKeepDot(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u02e5-\u02e9]/g, '') // combining marks, tone letters
    .replace(/[0-9ːˑʰʲʷʼˈˌ]/g, '');
}

/**
 * Base phones that count as the same sound as an orthographic unit. Units are single letters or
 * the digraphs sh zh th dh ng ch. (c and q read as k; y as the glide /j/; j as /dʒ/.)
 */
const PHONES = Object.freeze({
  // stops, affricates
  b: ['b'], p: ['p'], d: ['d'], t: ['t'], k: ['k'], c: ['k'], q: ['k'], g: ['ɡ', 'g'],
  ch: ['tʃ', 'ʧ', 'tɕ', 'ʨ'], j: ['dʒ', 'ʤ', 'dʑ', 'ʥ'],
  // nasals
  m: ['m'], n: ['n'], ng: ['ŋ'],
  // fricatives
  f: ['f'], v: ['v'], s: ['s'], z: ['z'], sh: ['ʃ', 'ɕ', 'ʂ', 's.'], zh: ['ʒ', 'ʑ', 'ʐ', 'z.'], th: ['θ'], dh: ['ð'], h: ['h'],
  // liquids and glides
  l: ['l', 'ɫ'], r: ['ɹ', 'r', 'ɾ', 'ɻ'], y: ['j'], w: ['w'],
  // vowels
  a: ['a', 'ɑ', 'ɐ'], e: ['e', 'ɛ', 'eɪ'], i: ['i', 'ɪ'], o: ['o', 'ɔ', 'oʊ'], u: ['u', 'ʊ'],
});

/** Pairs that differ (mainly) in voicing: same place and manner, voiced vs voiceless. */
export const VOICING_TWIN = Object.freeze({
  p: 'b', b: 'p', t: 'd', d: 't', k: 'g', g: 'k', c: 'g', q: 'g',
  f: 'v', v: 'f', s: 'z', z: 's', sh: 'zh', zh: 'sh', th: 'dh', dh: 'th', ch: 'j', j: 'ch',
});

const DIGRAPHS = ['sh', 'zh', 'th', 'dh', 'ng', 'ch'];
const VOWEL_UNITS = 'aeiou';

/** Split a syllable like "sha" or "thub" into orthographic units. Unknown letters are dropped. */
export function syllableUnits(syllable) {
  const s = String(syllable || '').toLowerCase().replace(/[^a-z]/g, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    const two = s.slice(i, i + 2);
    if (DIGRAPHS.includes(two)) { out.push(two); i += 2; continue; }
    if (PHONES[s[i]]) out.push(s[i]);
    i += 1;
  }
  return out;
}

// Labels listed WITH a dot (s. z.) belong only to the unit that lists them; any other dotted
// label (t. = retroflex t, common in Indian English) falls back to its plain base phone.
const DOTTED = new Set(Object.values(PHONES).flat().filter((l) => l.includes('.')));

function matchesUnit(label, unit) {
  const fam = PHONES[unit] || [];
  const kd = baseKeepDot(label);
  if (DOTTED.has(kd)) return fam.includes(kd);
  return fam.includes(kd.replace(/\./g, ''));
}

function idsFor(unit, vocab) {
  const ids = [];
  vocab.forEach((l, i) => { if (l != null && !isSpecial(l) && matchesUnit(l, unit)) ids.push(i); });
  return ids;
}

/**
 * Map a syllable to the vocab labels for its onset consonant, vowel and (optional) final consonant,
 * e.g. "ba", "shi", "ap", "thum". Only the first consonant of a cluster is scored ("bra" -> b + a).
 */
export function resolveTargets(syllable, vocab) {
  const units = syllableUnits(syllable);
  const vIdx = units.findIndex((u) => VOWEL_UNITS.includes(u));
  const onsetUnit = units.slice(0, vIdx < 0 ? units.length : vIdx).find(() => true) || null;
  const vowelUnit = vIdx >= 0 ? units[vIdx] : null;
  const codaUnit = vIdx >= 0 ? units.slice(vIdx + 1).find((u) => !VOWEL_UNITS.includes(u)) || null : null;
  const find = (unit) => {
    if (!unit) return null;
    const ids = idsFor(unit, vocab);
    return { letter: unit, labels: ids.map((i) => vocab[i]), ids };
  };
  const consonant = find(onsetUnit);
  const vowel = find(vowelUnit);
  const coda = find(codaUnit);
  const missing = [consonant, vowel, coda].filter((x) => x && x.labels.length === 0).map((x) => x.letter);
  return { consonant, vowel, coda, missing };
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
 * Splits a stop consonant's evidence into PLACE (p/b/t/d/k/g vs everything else) and VOICING
 * (target vs its voiced/voiceless twin). Isolated-syllable voicing (p/b, t/d) is the model's weak
 * spot, so a child who got the right place but an unclear voicing is reported separately.
 */
function placeAndVoicing(post, vocab, target) {
  const twinLetter = VOICING_TWIN[target.letter];
  if (!twinLetter) return null;
  const twinIds = idsFor(twinLetter, vocab);
  if (!twinIds.length) return null;
  const eps = 1e-6;
  const tgt = peakOf(post, target.ids);
  const twin = peakOf(post, twinIds);
  const inFamily = new Set([...target.ids, ...twinIds]);
  const otherIds = [];
  vocab.forEach((l, i) => { if (!inFamily.has(i) && !isSpecial(l) && isConsonantLabel(l)) otherIds.push(i); });
  const other = peakOf(post, otherIds);
  const stopPeak = Math.max(tgt.peak, twin.peak);
  const placeLlr = Math.log(Math.max(stopPeak, eps) / Math.max(other.peak, eps));
  let place = 'ambiguous';
  if (stopPeak < THRESHOLDS.WEAK_PEAK && other.peak < THRESHOLDS.WEAK_PEAK) place = 'weak_evidence';
  else if (placeLlr >= THRESHOLDS.LLR_MARGIN) place = 'ok';
  else if (placeLlr <= -THRESHOLDS.LLR_MARGIN) place = 'wrong';
  const voicingLlr = Math.log(Math.max(tgt.peak, eps) / Math.max(twin.peak, eps));
  let voicing = 'unsure';
  if (voicingLlr >= THRESHOLDS.LLR_MARGIN) voicing = 'target';
  else if (voicingLlr <= -THRESHOLDS.LLR_MARGIN) voicing = 'twin';
  return {
    twin: twinLetter,
    place,
    placeLlr: Math.round(placeLlr * 100) / 100,
    voicing,
    voicingLlr: Math.round(voicingLlr * 100) / 100,
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
  const out = { ok: true, heard, consonant: null, vowel: null, coda: null, thresholds: THRESHOLDS };
  if (targets.consonant) {
    out.consonant = evidence(post, vocab, targets.consonant, isConsonantLabel);
    const pv = placeAndVoicing(post, vocab, targets.consonant);
    if (pv) Object.assign(out.consonant, pv);
  }
  if (targets.coda) {
    out.coda = evidence(post, vocab, targets.coda, isConsonantLabel);
    const pv = placeAndVoicing(post, vocab, targets.coda);
    if (pv) Object.assign(out.coda, pv);
  }
  if (targets.vowel) out.vowel = evidence(post, vocab, targets.vowel, (l) => !isConsonantLabel(l));
  return out;
}
