import { scorePosteriors, softmaxRows, normalizeVocab, ctcGreedy } from './posteriors.js';
import { stopVoicingCue, decideConsonant } from './voicingCue.js';

export const MODEL_SAMPLE_RATE = 16000;

export const CAVEATS = Object.freeze([
  'Experimental: not validated on children or on disordered speech.',
  'Models are trained on typical adult speech and may score young or atypical voices unfairly.',
  'Evidence for one trial only; never a diagnosis. Does not affect passed/stars.',
]);

/** Linear-interpolation resampler. Input is already band-limited by the decimator. */
export function resampleLinear(x, from, to) {
  if (Math.abs(from - to) < 1e-6) return x;
  const n = Math.max(1, Math.round((x.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const i1 = Math.min(x.length - 1, i0 + 1);
    const f = p - i0;
    out[i] = x[Math.min(i0, x.length - 1)] * (1 - f) + x[i1] * f;
  }
  return out;
}

/** Recognizer interface: { name, ready(): Promise, recognize(audio, sampleRate, {level}): Promise<object|null> } */
export class NullRecognizer {
  name = 'none';
  async ready() {}
  async recognize() { return null; }
}

/** For tests and offline demos. */
export class MockRecognizer {
  constructor(fn, name = 'mock') {
    this.name = name;
    this._fn = fn;
  }
  async ready() {}
  async recognize(audio, sampleRate, ctx) { return this._fn(audio, sampleRate, ctx); }
}

/**
 * On-device phoneme recognizer on top of Transformers.js (ONNX, WASM/WebGPU).
 *
 * `transformers` is INJECTED (`import * as transformers from '@huggingface/transformers'`)
 * so this package has no hard dependency and bundles stay small unless the app opts in.
 * `modelId` has no default on purpose: pick and evaluate a model first.
 *
 * If the model's tokenizer can't be loaded by Transformers.js (several phoneme models ship
 * only a slow CTC tokenizer), pass `vocab` — the contents of the model's vocab.json.
 *
 * `preprocess(audio16k, 16000) => Float32Array | Promise<Float32Array>` is an optional hook
 * (e.g. a neural denoiser). It only touches the audio sent to the recognizer, never the
 * acoustic metrics.
 */
export class TransformersPhonemeRecognizer {
  constructor({ transformers, modelId, vocab = null, dtype = 'q8', device = null, preprocess = null, minSec = 0.15, onProgress = null, useAcousticCue = false } = {}) {
    if (!transformers || !transformers.AutoModelForCTC || !transformers.AutoProcessor) {
      throw new Error('Pass the @huggingface/transformers module as `transformers`');
    }
    if (!modelId) throw new Error('modelId is required (no default: evaluate a model before choosing one)');
    this.T = transformers;
    this.modelId = modelId;
    this.vocab = vocab;
    this.dtype = dtype;
    this.device = device;
    this.preprocess = preprocess;
    this.minSec = minSec;
    this.useAcousticCue = useAcousticCue; // experimental stop-voicing tie-break; off until calibrated
    this.onProgress = onProgress; // optional: (p) => void, Transformers.js download progress events
    this.name = 'transformers.js-ctc';
    this._ready = null;
  }

  ready() {
    if (!this._ready) this._ready = this._load();
    return this._ready;
  }

  async _load() {
    const { AutoModelForCTC, AutoProcessor, AutoTokenizer } = this.T;
    const opts = { dtype: this.dtype };
    if (this.device) opts.device = this.device;
    if (this.onProgress) opts.progress_callback = this.onProgress;
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(this.modelId),
      AutoModelForCTC.from_pretrained(this.modelId, opts),
    ]);
    this.processor = processor;
    this.model = model;
    if (this.vocab) {
      this.vocabArr = normalizeVocab(this.vocab);
    } else {
      try {
        const tok = await AutoTokenizer.from_pretrained(this.modelId);
        this.vocabArr = normalizeVocab(tok.get_vocab());
      } catch (e) {
        this._ready = null;
        throw new Error(`Could not load a vocabulary for "${this.modelId}" (${e.message}). Pass \`vocab\` (the model's vocab.json).`);
      }
    }
  }

  async recognize(audio, sampleRate, { level } = {}) {
    const base = { experimental: true, kind: 'phoneme', recognizer: this.name, modelId: this.modelId, caveats: CAVEATS };
    const audioSec = audio.length / sampleRate;
    if (audioSec < this.minSec) return { ...base, ok: false, reason: 'too_short', audioSec: Math.round(audioSec * 100) / 100 };

    await this.ready();
    let a = resampleLinear(audio, sampleRate, MODEL_SAMPLE_RATE);
    const raw16k = a; // acoustic cues use the un-denoised audio
    if (this.preprocess) a = await this.preprocess(a, MODEL_SAMPLE_RATE);
    const inputs = await this.processor(a); // Wav2Vec2 feature extractor normalises internally
    const out = await this.model(inputs);
    const [, T, V] = out.logits.dims;
    if (V !== this.vocabArr.length) {
      return { ...base, ok: false, reason: 'vocab_size_mismatch', modelVocab: V, givenVocab: this.vocabArr.length };
    }
    const post = softmaxRows(out.logits.data, T, V);
    const syllableLevel = level && (level.type === 'cv_syllable' || level.type === 'syllable_train') && level.syllable;
    const score = syllableLevel
      ? scorePosteriors(post, this.vocabArr, level.syllable)
      : { ok: true, heard: ctcGreedy(post, this.vocabArr) };
    if (syllableLevel && score.ok && score.consonant) {
      const cue = stopVoicingCue(raw16k, MODEL_SAMPLE_RATE);
      score.voicingCue = cue;
      Object.assign(score.consonant, decideConsonant(score.consonant, cue, score.consonant.target, { useCue: this.useAcousticCue }));
    }
    return { ...base, ...score, audioSec: Math.round(audioSec * 100) / 100 };
  }
}
