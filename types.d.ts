export type LevelType =
  | 'sustained_voicing'
  | 'cv_syllable'
  | 'syllable_train'
  | 'pitch_glide'
  | 'loudness_ramp';

export type Manner = 'voiced_stop' | 'voiceless_stop' | 'nasal' | 'vowel' | 'other';
export type Profile = 'child' | 'adult';

interface LevelBase {
  id: string;
  label?: string;
  /** Voiced level must exceed calibrated room noise by this many dB (default 10). */
  minSnrDb?: number;
  maxDurationSec?: number;
  /** Keep a 20 Hz intensity/F0 contour in the result (default true). */
  recordContour?: boolean;
}

export interface SustainedVoicingLevel extends LevelBase {
  type: 'sustained_voicing';
  sound?: string;
  targetDurationSec: number;
  /** If set, F0 standard deviation (semitones) must not exceed this to pass. */
  maxF0SdSemitones?: number | null;
}

export interface CvSyllableLevel extends LevelBase {
  type: 'cv_syllable';
  syllable: string;
  reps?: number;
  minSyllableMs?: number;
  /** Experimental short-lag / long-lag boundary, default 30 ms. */
  votBoundaryMs?: number;
  /** Experimental; off by default. */
  requireMannerMatch?: boolean;
}

export interface SyllableTrainLevel extends LevelBase {
  type: 'syllable_train';
  syllable?: string;
  durationSec?: number;
  minSyllables?: number;
  targetRateMin?: number | null;
  targetRateMax?: number | null;
}

export interface PitchGlideLevel extends LevelBase {
  type: 'pitch_glide';
  direction: 'up' | 'down';
  minRangeSemitones?: number;
  sound?: string;
}

export interface LoudnessRampLevel extends LevelBase {
  type: 'loudness_ramp';
  direction: 'up' | 'down';
  minRangeDb?: number;
  sound?: string;
}

export type Level =
  | SustainedVoicingLevel
  | CvSyllableLevel
  | SyllableTrainLevel
  | PitchGlideLevel
  | LoudnessRampLevel;

/** Real-time biofeedback state (read it from requestAnimationFrame). */
export interface LiveState {
  t: number;
  /** Voicing is on (short dropouts under 60 ms are bridged). */
  voiced: boolean;
  f0Hz: number | null;
  /** Smoothed level, dBFS (relative, not dB SPL). */
  db: number | null;
  snrDb: number | null;
  /** 0..1, for driving visuals. */
  intensityNorm: number;
  /** Continuous voiced time right now, seconds. */
  voicedRunSec: number;
  trialElapsedSec: number | null;
  clipping: boolean;
}

export type QualityFlag =
  | 'not_calibrated'
  | 'high_noise'
  | 'clipping'
  | 'capture_processing'
  | 'low_snr'
  | 'no_voicing';

export interface Quality {
  noiseFloorDb: number | null;
  snrDb: number | null;
  clippedSamples: number;
  captureProcessing: Record<string, unknown>;
  flags: QualityFlag[];
  /** false if any flag undermines intensity/onset measures; show to the clinician. */
  reliable: boolean;
}

export interface ContourPoint {
  t: number;
  db: number | null;
  f0: number | null;
}

export type EvidenceVerdict = 'target_dominant' | 'competitor_dominant' | 'ambiguous' | 'weak_evidence';

export interface PhoneEvidence {
  target: string;
  targetLabels: string[];
  targetPeak: number;
  bestCompetitor: string | null;
  competitorPeak: number;
  /** ln(targetPeak / competitorPeak): GOP-style, unvalidated. */
  llr: number;
  verdict: EvidenceVerdict;
}

/** Always experimental; never affects passed/stars. */
export interface RecognitionResult {
  experimental: true;
  kind?: 'phoneme';
  recognizer: string;
  modelId?: string;
  ok: boolean;
  reason?: string;
  error?: string;
  heard?: string[];
  consonant?: PhoneEvidence | null;
  vowel?: PhoneEvidence | null;
  audioSec?: number;
  caveats?: string[];
}

export interface Recognizer {
  name: string;
  ready(): Promise<void>;
  recognize(audio: Float32Array, sampleRate: number, ctx: { level: Level }): Promise<RecognitionResult | null>;
}

export interface TrialResult {
  schemaVersion: number;
  levelId: string;
  type: LevelType;
  startedAt: string;
  durationSec: number;
  passed: boolean;
  /** 0..1 progress toward the level target. */
  progress: number;
  /** Gamification only: 3 passed, 2 >= 60% progress, 1 voicing detected, 0 nothing. */
  stars: 0 | 1 | 2 | 3;
  /** Type-specific measures; see README for each. */
  metrics: Record<string, number | boolean | string | null>;
  events: Array<Record<string, number | string | boolean | null>>;
  contour?: ContourPoint[];
  quality: Quality;
  recognition?: RecognitionResult;
}

export interface CalibrationResult {
  ok: boolean;
  noise: { db: number; hfDb: number; lfDb: number };
  warnings: Array<'too_short' | 'unstable_background' | 'high_noise'>;
  frames: number;
}

export class PhonationEngine {
  constructor(opts?: {
    profile?: Profile;
    onLive?: (s: LiveState) => void;
    onError?: (e: Error) => void;
    /** Real served copy of phonation-worklet.js; default is an in-memory Blob URL. */
    workletUrl?: string;
  });
  readonly live: LiveState | null;
  readonly calibrated: boolean;
  start(): Promise<Record<string, unknown>>;
  calibrate(ms?: number): Promise<CalibrationResult>;
  beginTrial(level: Level, opts?: { captureAudio?: boolean }): Level;
  endTrial(): TrialResult;
  /** Needs beginTrial(level, { captureAudio: true }). Attaches `recognition`; never changes acoustic fields. */
  endTrialAndRecognize(recognizer: Recognizer | null): Promise<TrialResult>;
  cancelTrial(): void;
  stop(): void;
}

export class PhonationAnalyzer {
  constructor(opts: { sampleRate: number; profile?: Profile });
  readonly live: LiveState;
  readonly trialActive: boolean;
  calibrated: boolean;
  setCaptureInfo(info: Record<string, unknown>): void;
  push(block: Float32Array): LiveState;
  startCalibration(): void;
  finishCalibration(): CalibrationResult;
  beginTrial(level: Level, opts?: { captureAudio?: boolean }): Level;
  endTrial(): TrialResult;
  endTrialWithAudio(): { result: TrialResult; level: Level; audio: Float32Array | null; sampleRate: number };
  cancelTrial(): void;
}

export function validateLevel(level: unknown): { ok: boolean; errors: string[]; level: Level | null };
export function normalizeLevel(level: unknown): Level;
export function mannerOf(syllable: string): Manner;
export const LEVEL_TYPES: Readonly<Record<string, LevelType>>;
export const STARTER_LEVELS: Level[];

export class NullRecognizer implements Recognizer {
  name: string;
  ready(): Promise<void>;
  recognize(): Promise<null>;
}

export class MockRecognizer implements Recognizer {
  constructor(fn: (audio: Float32Array, sampleRate: number, ctx: { level: Level }) => Promise<RecognitionResult | null>, name?: string);
  name: string;
  ready(): Promise<void>;
  recognize(audio: Float32Array, sampleRate: number, ctx: { level: Level }): Promise<RecognitionResult | null>;
}

export class TransformersPhonemeRecognizer implements Recognizer {
  constructor(opts: {
    /** `import * as transformers from '@huggingface/transformers'` */
    transformers: unknown;
    modelId: string;
    vocab?: string[] | Map<string, number> | Record<string, number> | null;
    dtype?: string;
    device?: string | null;
    preprocess?: ((audio16k: Float32Array, sampleRate: number) => Float32Array | Promise<Float32Array>) | null;
    minSec?: number;
  });
  name: string;
  ready(): Promise<void>;
  recognize(audio: Float32Array, sampleRate: number, ctx: { level: Level }): Promise<RecognitionResult>;
}

export function scorePosteriors(post: Float32Array[], vocab: string[] | Map<string, number> | Record<string, number>, syllable: string): Partial<RecognitionResult> & { ok: boolean };
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array;

export interface ReportSummary {
  ageBand: string | null;
  totalTrials: number;
  qualityFlagCounts: Record<string, number>;
  types: Array<{
    type: LevelType;
    levels: string[];
    trials: number;
    passed: number;
    unreliableTrials: number;
    firstProgress: number;
    lastProgress: number;
    metrics: Record<string, { median: number; n: number }>;
  }>;
  excluded: string;
}
export function summarizeForReport(results: TrialResult[], opts?: { ageBand?: string | null }): ReportSummary;
export function buildDraftPrompt(summary: ReportSummary): string;
