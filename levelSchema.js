/**
 * Typed phonation levels.
 *
 * Every level declares a `type`; the type decides what the analyser measures,
 * what the live biofeedback shows and how the trial is scored. Targets are
 * clinician-adjustable parameters, NOT normative data.
 */

export const LEVEL_TYPES = Object.freeze({
  SUSTAINED_VOICING: 'sustained_voicing', // hold /a/ /m/ /u/ ... (maximum phonation time, steadiness)
  CV_SYLLABLE: 'cv_syllable', // isolated syllables: ba, ma, pa ...
  SYLLABLE_TRAIN: 'syllable_train', // repetition / DDK: ba-ba-ba (rate, regularity)
  PITCH_GLIDE: 'pitch_glide', // slide up / down in pitch
  LOUDNESS_RAMP: 'loudness_ramp', // soft -> loud / loud -> soft
});

/** Manner of articulation of a syllable's initial consonant (acoustic categories). */
export const MANNERS = Object.freeze({
  VOICED_STOP: 'voiced_stop', // b d g
  VOICELESS_STOP: 'voiceless_stop', // p t k
  NASAL: 'nasal', // m n
  VOWEL: 'vowel', // a e i o u (no consonant)
  OTHER: 'other', // anything not classified by the engine
});

export function mannerOf(syllable) {
  const c = String(syllable || '').toLowerCase()[0];
  if (!c) return MANNERS.OTHER;
  if ('bdg'.includes(c)) return MANNERS.VOICED_STOP;
  if ('ptk'.includes(c)) return MANNERS.VOICELESS_STOP;
  if ('mn'.includes(c)) return MANNERS.NASAL;
  if ('aeiou'.includes(c)) return MANNERS.VOWEL;
  return MANNERS.OTHER;
}

const COMMON_DEFAULTS = {
  minSnrDb: 10, // voiced level must exceed measured room noise by this much
  recordContour: true, // keep a 20 Hz intensity/F0 contour for therapist review
};

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPos = (x) => isNum(x) && x > 0;

const SPECS = {
  [LEVEL_TYPES.SUSTAINED_VOICING]: {
    defaults: (l) => ({
      sound: 'a',
      maxDurationSec: (isPos(l.targetDurationSec) ? l.targetDurationSec : 5) + 8,
      maxF0SdSemitones: null, // set to require pitch steadiness
    }),
    check: (l, err) => {
      if (!isPos(l.targetDurationSec)) err.push('targetDurationSec must be a positive number');
      if (l.maxF0SdSemitones != null && !isPos(l.maxF0SdSemitones)) err.push('maxF0SdSemitones must be positive or null');
    },
  },
  [LEVEL_TYPES.CV_SYLLABLE]: {
    defaults: (l) => ({
      reps: 3,
      maxDurationSec: (isPos(l.reps) ? l.reps : 3) * 4 + 8,
      minSyllableMs: 60,
      votBoundaryMs: 30, // short-lag (voiced) vs long-lag (voiceless) boundary — experimental
      requireMannerMatch: false, // manner classification is experimental; off by default
    }),
    check: (l, err) => {
      if (typeof l.syllable !== 'string' || !/^[a-z]{1,6}$/.test(l.syllable)) err.push('syllable must be 1-6 lowercase letters, e.g. "ba"');
      if (!Number.isInteger(l.reps) || l.reps < 1) err.push('reps must be an integer >= 1');
    },
  },
  [LEVEL_TYPES.SYLLABLE_TRAIN]: {
    defaults: () => ({
      syllable: 'ba',
      durationSec: 5,
      minSyllables: 5,
      targetRateMin: null, // syllables / second
      targetRateMax: null,
      maxDurationSec: null, // filled from durationSec below
    }),
    check: (l, err) => {
      if (!isPos(l.durationSec)) err.push('durationSec must be a positive number');
      if (!Number.isInteger(l.minSyllables) || l.minSyllables < 2) err.push('minSyllables must be an integer >= 2');
      if (l.targetRateMin != null && !isPos(l.targetRateMin)) err.push('targetRateMin must be positive or null');
      if (l.targetRateMax != null && !isPos(l.targetRateMax)) err.push('targetRateMax must be positive or null');
      if (l.targetRateMin != null && l.targetRateMax != null && l.targetRateMin > l.targetRateMax) err.push('targetRateMin must be <= targetRateMax');
    },
  },
  [LEVEL_TYPES.PITCH_GLIDE]: {
    defaults: () => ({ direction: 'up', minRangeSemitones: 4, maxDurationSec: 8, sound: 'a' }),
    check: (l, err) => {
      if (!['up', 'down'].includes(l.direction)) err.push('direction must be "up" or "down"');
      if (!isPos(l.minRangeSemitones)) err.push('minRangeSemitones must be positive');
    },
  },
  [LEVEL_TYPES.LOUDNESS_RAMP]: {
    defaults: () => ({ direction: 'up', minRangeDb: 10, maxDurationSec: 8, sound: 'a' }),
    check: (l, err) => {
      if (!['up', 'down'].includes(l.direction)) err.push('direction must be "up" or "down"');
      if (!isPos(l.minRangeDb)) err.push('minRangeDb must be positive');
    },
  },
};

/**
 * Validate a level and fill defaults.
 * @returns {{ok: boolean, errors: string[], level: object|null}}
 */
export function validateLevel(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['level must be an object'], level: null };
  if (typeof input.id !== 'string' || !input.id) errors.push('id must be a non-empty string');
  const spec = SPECS[input.type];
  if (!spec) {
    errors.push(`type must be one of: ${Object.values(LEVEL_TYPES).join(', ')}`);
    return { ok: false, errors, level: null };
  }
  const level = { ...COMMON_DEFAULTS, ...spec.defaults(input), ...input };
  if (level.type === LEVEL_TYPES.SYLLABLE_TRAIN && level.maxDurationSec == null) {
    level.maxDurationSec = isPos(level.durationSec) ? level.durationSec : 5;
  }
  if (!isNum(level.minSnrDb) || level.minSnrDb < 0) errors.push('minSnrDb must be >= 0');
  if (!isPos(level.maxDurationSec)) errors.push('maxDurationSec must be positive');
  spec.check(level, errors);
  return { ok: errors.length === 0, errors, level: errors.length ? null : level };
}

/** Like validateLevel but throws on invalid input. */
export function normalizeLevel(input) {
  const r = validateLevel(input);
  if (!r.ok) throw new Error(`Invalid phonation level${input && input.id ? ` "${input.id}"` : ''}: ${r.errors.join('; ')}`);
  return r.level;
}
