import { LEVEL_TYPES as T } from './levelSchema.js';

/**
 * Starter curriculum. These are illustrative STARTING POINTS for a clinician to
 * adjust per child — they are not normative data and not clinical targets.
 * Run every entry through validateLevel() before use.
 */
export const STARTER_LEVELS = [
  // 1. Voice on / off, easiest cause-and-effect
  { id: 'sv-a-1', type: T.SUSTAINED_VOICING, sound: 'a', targetDurationSec: 1, label: 'Say "aaa"' },
  { id: 'sv-m-2', type: T.SUSTAINED_VOICING, sound: 'm', targetDurationSec: 2, label: 'Hum "mmm"' },
  { id: 'sv-a-3', type: T.SUSTAINED_VOICING, sound: 'a', targetDurationSec: 3, label: 'Long "aaa"' },

  // 2. Single syllables, bilabial first
  { id: 'cv-ba-3', type: T.CV_SYLLABLE, syllable: 'ba', reps: 3, label: '"ba" three times' },
  { id: 'cv-ma-3', type: T.CV_SYLLABLE, syllable: 'ma', reps: 3, label: '"ma" three times' },
  { id: 'cv-pa-3', type: T.CV_SYLLABLE, syllable: 'pa', reps: 3, label: '"pa" three times' },

  // 3. Repetition
  { id: 'tr-ba-5', type: T.SYLLABLE_TRAIN, syllable: 'ba', minSyllables: 5, durationSec: 5, label: '"ba ba ba ba ba"' },
  { id: 'tr-ma-5', type: T.SYLLABLE_TRAIN, syllable: 'ma', minSyllables: 5, durationSec: 5, label: '"ma ma ma ma ma"' },

  // 4. Pitch and loudness control
  { id: 'pg-up-4', type: T.PITCH_GLIDE, direction: 'up', minRangeSemitones: 4, label: 'Slide up' },
  { id: 'pg-down-4', type: T.PITCH_GLIDE, direction: 'down', minRangeSemitones: 4, label: 'Slide down' },
  { id: 'lr-up-10', type: T.LOUDNESS_RAMP, direction: 'up', minRangeDb: 10, label: 'Quiet to loud' },
  { id: 'lr-down-10', type: T.LOUDNESS_RAMP, direction: 'down', minRangeDb: 10, label: 'Loud to quiet' },
];
