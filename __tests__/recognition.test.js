import test from 'node:test';
import assert from 'node:assert/strict';

import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { PhonationEngine } from '../PhonationEngine.js';
import {
  scorePosteriors, resolveTargets, ctcGreedy, softmaxRows, normalizeVocab,
} from '../recognition/posteriors.js';
import {
  TransformersPhonemeRecognizer, MockRecognizer, resampleLinear,
} from '../recognition/recognizers.js';
import { summarizeForReport, buildDraftPrompt } from '../report/summary.js';
import { FS, tone, silence, concat, withNoise, feed, calibrate } from './synth.js';

// A tiny TIMIT-like vocabulary. Index = id. '<pad>' is the CTC blank.
const VOCAB = ['<pad>', '|', 'b', 'p', 'm', 'd', 't', 'k', 'ɡ', 'ɑ', 'ɛ', 'i', 's'];
const id = (l) => VOCAB.indexOf(l);

/** Build a posteriorgram: frames = [{label: prob, ...}, ...]; the rest of the mass goes to <pad>. */
function posteriorgram(frames) {
  return frames.map((f) => {
    const row = new Float32Array(VOCAB.length);
    let used = 0;
    for (const [l, p] of Object.entries(f)) { row[id(l)] = p; used += p; }
    row[id('<pad>')] += Math.max(0, 1 - used);
    return row;
  });
}

test('softmaxRows produces valid distributions', () => {
  const rows = softmaxRows(new Float32Array([1, 2, 3, 0, 0, 0]), 2, 3);
  for (const r of rows) assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-5);
  assert.ok(rows[0][2] > rows[0][1] && rows[0][1] > rows[0][0]);
});

test('normalizeVocab accepts arrays, Maps and plain objects', () => {
  const m = new Map(VOCAB.map((l, i) => [l, i]));
  assert.deepEqual(normalizeVocab(m), VOCAB);
  assert.deepEqual(normalizeVocab(Object.fromEntries(m)), VOCAB);
  assert.deepEqual(normalizeVocab(VOCAB), VOCAB);
});

test('resolveTargets maps syllables to vocab labels and reports what is missing', () => {
  const r = resolveTargets('ba', VOCAB);
  assert.deepEqual(r.consonant.labels, ['b']);
  assert.deepEqual(r.vowel.labels, ['ɑ']);
  assert.deepEqual(r.missing, []);
  const none = resolveTargets('xa', ['<pad>', 'b', 'ɑ']); // 'x' is not a unit we map
  assert.equal(none.consonant, null);
  const f = resolveTargets('fa', ['<pad>', 'b', 'ɑ']); // 'f' is known but missing from this vocab
  assert.deepEqual(f.missing, ['f']);
  const gap = resolveTargets('ba', ['<pad>', 'p', 'ɑ']);
  assert.deepEqual(gap.missing, ['b']);
});

test('ctcGreedy collapses repeats and drops blanks', () => {
  const post = posteriorgram([{ b: 0.9 }, { b: 0.9 }, { '<pad>': 1 }, { ɑ: 0.8 }, { ɑ: 0.8 }]);
  assert.deepEqual(ctcGreedy(post, VOCAB), ['b', 'ɑ']);
});

test('scorePosteriors: target consonant dominates -> target_dominant', () => {
  const post = posteriorgram([{ '<pad>': 1 }, { b: 0.85, p: 0.05 }, { ɑ: 0.8 }, { '<pad>': 1 }]);
  const r = scorePosteriors(post, VOCAB, 'ba');
  assert.equal(r.ok, true);
  assert.equal(r.consonant.verdict, 'target_dominant');
  assert.equal(r.vowel.verdict, 'target_dominant');
  assert.ok(r.consonant.llr > 1);
  assert.deepEqual(r.heard, ['b', 'ɑ']);
});

test('scorePosteriors: a substitution (heard /p/ for /b/) -> competitor_dominant with the competitor named', () => {
  const post = posteriorgram([{ p: 0.8, b: 0.1 }, { ɑ: 0.8 }]);
  const r = scorePosteriors(post, VOCAB, 'ba');
  assert.equal(r.consonant.verdict, 'competitor_dominant');
  assert.equal(r.consonant.bestCompetitor, 'p');
});

test('scorePosteriors: low-confidence everywhere -> weak_evidence; close call -> ambiguous', () => {
  const weak = scorePosteriors(posteriorgram([{ b: 0.05, p: 0.04 }, { ɑ: 0.05 }]), VOCAB, 'ba');
  assert.equal(weak.consonant.verdict, 'weak_evidence');
  const close = scorePosteriors(posteriorgram([{ b: 0.5, p: 0.4 }, { ɑ: 0.8 }]), VOCAB, 'ba');
  assert.equal(close.consonant.verdict, 'ambiguous');
});

test('scorePosteriors: vocab that lacks the target phone fails loudly, not silently', () => {
  const r = scorePosteriors(posteriorgram([{ b: 0.9 }]), ['<pad>', 'b', 'p'], 'ba');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'target_labels_not_in_vocab');
  assert.deepEqual(r.missing, ['a']);
});

test('resampleLinear changes length by the rate ratio and keeps a sine intact', () => {
  const n = 14700;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 200 * i) / 14700);
  const y = resampleLinear(x, 14700, 16000);
  assert.ok(Math.abs(y.length - 16000) <= 1);
  for (let i = 100; i < 15900; i += 777) assert.ok(Math.abs(y[i] - Math.sin((2 * Math.PI * 200 * i) / 16000)) < 0.01);
});

// ----------------------------------------------- recognizer with a fake model

function fakeTransformers({ logitsFor, vocabMap = new Map(VOCAB.map((l, i) => [l, i])) }) {
  const calls = { processor: 0, model: 0, audioLen: 0, tokenizer: 0 };
  return {
    calls,
    AutoProcessor: { from_pretrained: async () => async (a) => { calls.processor++; calls.audioLen = a.length; return { input_values: a }; } },
    AutoModelForCTC: {
      from_pretrained: async () => async () => {
        calls.model++;
        const { T, data } = logitsFor();
        return { logits: { dims: [1, T, VOCAB.length], data } };
      },
    },
    AutoTokenizer: { from_pretrained: async () => { calls.tokenizer++; return { get_vocab: () => vocabMap }; } },
  };
}

function logitsFromPost(post) {
  const T = post.length;
  const data = new Float32Array(T * VOCAB.length);
  post.forEach((row, t) => row.forEach((p, v) => { data[t * VOCAB.length + v] = Math.log(Math.max(p, 1e-6)); }));
  return { T, data };
}

test('TransformersPhonemeRecognizer: end-to-end with a fake model (resample, decode, score, cache)', async () => {
  const post = posteriorgram([{ b: 0.9 }, { ɑ: 0.85 }]);
  const T = fakeTransformers({ logitsFor: () => logitsFromPost(post) });
  const rec = new TransformersPhonemeRecognizer({ transformers: T, modelId: 'fake/model' });
  const audio = new Float32Array(14700 * 0.5).fill(0.1);
  const out = await rec.recognize(audio, 14700, { level: { type: 'cv_syllable', syllable: 'ba' } });
  assert.equal(out.experimental, true);
  assert.equal(out.ok, true);
  assert.equal(out.consonant.verdict, 'target_dominant');
  assert.ok(Math.abs(T.calls.audioLen - 8000) <= 1, `resampled to 16 kHz: ${T.calls.audioLen}`);
  assert.ok(out.caveats.length >= 3);
  await rec.recognize(audio, 14700, { level: { type: 'cv_syllable', syllable: 'ba' } });
  assert.equal(T.calls.tokenizer, 1, 'vocab is loaded once');
});

test('TransformersPhonemeRecognizer: too-short audio, vocab mismatch, missing modelId, hook, explicit vocab', async () => {
  const post = posteriorgram([{ b: 0.9 }]);
  const T = fakeTransformers({ logitsFor: () => logitsFromPost(post) });
  assert.throws(() => new TransformersPhonemeRecognizer({ transformers: T }), /modelId/);
  assert.throws(() => new TransformersPhonemeRecognizer({ modelId: 'x' }), /transformers/);

  const rec = new TransformersPhonemeRecognizer({ transformers: T, modelId: 'fake/model' });
  const tiny = await rec.recognize(new Float32Array(100), 16000, {});
  assert.equal(tiny.reason, 'too_short');

  const bad = new TransformersPhonemeRecognizer({ transformers: T, modelId: 'fake/model', vocab: ['<pad>', 'b'] });
  const mism = await bad.recognize(new Float32Array(16000), 16000, {});
  assert.equal(mism.reason, 'vocab_size_mismatch');

  let hookSaw = 0;
  const hooked = new TransformersPhonemeRecognizer({
    transformers: T, modelId: 'fake/model', vocab: VOCAB,
    preprocess: (a) => { hookSaw = a.length; return a; },
  });
  await hooked.recognize(new Float32Array(16000), 16000, {});
  assert.equal(hookSaw, 16000);

  const failTok = fakeTransformers({ logitsFor: () => logitsFromPost(post) });
  failTok.AutoTokenizer.from_pretrained = async () => { throw new Error('Unknown tokenizer class'); };
  const nt = new TransformersPhonemeRecognizer({ transformers: failTok, modelId: 'fake/model' });
  await assert.rejects(() => nt.recognize(new Float32Array(16000), 16000, {}), /Pass `vocab`/);
});

// --------------------------------------- audio capture stays opt-in and in-memory

function trialSignal() {
  return withNoise(concat(silence(0.4), tone(260, 1.2, { amp: 0.25 }), silence(0.4)), -70);
}
const SV = { id: 'sv', type: 'sustained_voicing', targetDurationSec: 1 };

test('audio is NOT kept unless captureAudio is requested', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  a.beginTrial(SV);
  feed(a, trialSignal());
  const { result, audio } = a.endTrialWithAudio();
  assert.equal(audio, null);
  assert.ok(result.metrics.mptSec > 1);
});

test('captureAudio keeps ~16 kHz audio in memory and the result never contains samples', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  a.beginTrial(SV, { captureAudio: true });
  feed(a, trialSignal());
  const { result, audio, sampleRate } = a.endTrialWithAudio();
  assert.ok(audio instanceof Float32Array);
  assert.ok(Math.abs(sampleRate - 16000) < 1);
  assert.ok(Math.abs(audio.length / sampleRate - 2.0) < 0.2, `~2.0 s captured, got ${audio.length / sampleRate}`);
  assert.ok(JSON.stringify(result).length < 20000);
  assert.equal(result.recognition, undefined);
});

test('audio capture is bounded by maxDurationSec', () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  a.beginTrial({ ...SV, maxDurationSec: 1 }, { captureAudio: true });
  feed(a, withNoise(tone(260, 6, { amp: 0.25 }), -70));
  const { audio, sampleRate } = a.endTrialWithAudio();
  assert.ok(audio.length / sampleRate <= 3.1, `capped near maxDurationSec + 2, got ${audio.length / sampleRate}`);
});

// --------------------------------- engine integration (no browser: bypass start())

function engineWith(analyzer) {
  const e = new PhonationEngine({ profile: 'child' });
  e.analyzer = analyzer;
  e.running = true;
  return e;
}

test('endTrialAndRecognize attaches experimental output and leaves the acoustic result untouched', async () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  const e = engineWith(a);
  e.beginTrial({ id: 'cv', type: 'cv_syllable', syllable: 'ba', reps: 1 }, { captureAudio: true });
  feed(a, trialSignal());
  let got = null;
  const rec = new MockRecognizer(async (audio, sr, ctx) => { got = { n: audio.length, sr, type: ctx.level.type }; return { experimental: true, ok: true, kind: 'phoneme' }; });
  const r = await e.endTrialAndRecognize(rec);
  assert.equal(r.recognition.experimental, true);
  assert.equal(got.type, 'cv_syllable');
  assert.ok(got.n > 16000);
  assert.ok(r.metrics.syllableCount >= 1);

  // Same audio, scored WITHOUT the recognizer: the acoustic result must be identical.
  const b = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(b);
  b.beginTrial({ id: 'cv', type: 'cv_syllable', syllable: 'ba', reps: 1 });
  feed(b, trialSignal());
  const plain = b.endTrial();
  const strip = ({ recognition, startedAt, ...rest }) => rest;
  assert.deepEqual(strip(r), strip(plain));
});

test('recognizer failure never fails the trial; silence skips recognition entirely', async () => {
  const a = new PhonationAnalyzer({ sampleRate: FS });
  calibrate(a);
  const e = engineWith(a);
  e.beginTrial(SV, { captureAudio: true });
  feed(a, trialSignal());
  const boom = new MockRecognizer(async () => { throw new Error('model crashed'); });
  const r = await e.endTrialAndRecognize(boom);
  assert.equal(r.recognition.ok, false);
  assert.match(r.recognition.error, /model crashed/);
  assert.equal(typeof r.passed, 'boolean');

  e.beginTrial(SV, { captureAudio: true });
  feed(a, withNoise(silence(2), -70));
  let called = false;
  const spy = new MockRecognizer(async () => { called = true; return {}; });
  const quiet = await e.endTrialAndRecognize(spy);
  assert.equal(called, false, 'no voicing -> do not run a model that would hallucinate on silence');
  assert.equal(quiet.recognition, undefined);
});

// ------------------------------------------------------------- report summary

function fakeResult(over = {}) {
  return {
    schemaVersion: 1, levelId: 'cv-ba-3', type: 'cv_syllable', startedAt: '2026-10-03T10:00:00.000Z',
    durationSec: 6, passed: true, progress: 1, stars: 3,
    metrics: { syllableCount: 3, meanDurMs: 180, votMeanMs: 12, mannerMatches: 3, expectedManner: 'voiced_stop' },
    events: [], quality: { flags: [], reliable: true, noiseFloorDb: -68, snrDb: 30, clippedSamples: 0, captureProcessing: {} },
    recognition: { experimental: true, heard: ['b', 'ɑ'] },
    playerCode: 'CHICK29', childName: 'Ananya', ...over,
  };
}

test('summarizeForReport is whitelist-based: no ids, names, timestamps, experimental metrics or recognizer output', () => {
  const s = summarizeForReport([fakeResult(), fakeResult({ passed: false, progress: 0.66, quality: { flags: ['high_noise'], reliable: false, noiseFloorDb: -40, snrDb: 12, clippedSamples: 0, captureProcessing: {} } })], { ageBand: '5-6' });
  const json = JSON.stringify(s);
  for (const leak of ['CHICK29', 'Ananya', '2026-10-03', 'votMeanMs', 'mannerMatches', 'heard', 'startedAt', 'playerCode']) {
    assert.ok(!json.includes(leak), `must not contain ${leak}`);
  }
  assert.equal(s.totalTrials, 2);
  assert.equal(s.types[0].passed, 1);
  assert.equal(s.types[0].unreliableTrials, 1);
  assert.equal(s.qualityFlagCounts.high_noise, 1);
  assert.equal(s.ageBand, '5-6');
  assert.equal(s.types[0].metrics.syllableCount.median, 3);
});

test('buildDraftPrompt demands clinician review and forbids diagnosis', () => {
  const p = buildDraftPrompt(summarizeForReport([fakeResult()]));
  assert.match(p, /DRAFT - clinician review required/);
  assert.match(p, /Do not diagnose/);
  assert.match(p, /relative dBFS/);
});

// ------------------------------------------------------------ worklet source

import { readFileSync } from 'node:fs';
import { WORKLET_SOURCE } from '../workletSource.js';

test('embedded worklet source matches phonation-worklet.js (no drift) and registers the processor', () => {
  const file = readFileSync(new URL('../phonation-worklet.js', import.meta.url), 'utf8');
  assert.equal(WORKLET_SOURCE, file);
  assert.match(WORKLET_SOURCE, /registerProcessor\('phonation-capture'/);
});

test('tone-digit and length variants of the target vowel are the target, not a competitor', () => {
  const V = ['<pad>', 'k', 'g', 'ɑ5', 'aː', 'a', 'ɔ'];
  const r = resolveTargets('ka', V);
  assert.deepEqual(r.vowel.labels, ['ɑ5', 'aː', 'a']);
  const T = 4, post = [];
  for (let t = 0; t < T; t++) post.push(Float32Array.from([0.05, 0, 0, 0, 0, 0, 0]));
  post[1] = Float32Array.from([0, 0.9, 0, 0, 0, 0, 0]);          // k
  post[2] = Float32Array.from([0, 0, 0, 0.8, 0.1, 0.05, 0.05]);  // ɑ5
  const s = scorePosteriors(post, V, 'ka');
  assert.equal(s.vowel.verdict, 'target_dominant');
  assert.equal(s.consonant.verdict, 'target_dominant');
});

test('p vs b: right place with unclear voicing is reported as place ok, voicing unsure', () => {
  const V = ['<pad>', 'p', 'b', 't', 'a'];
  const post = [
    Float32Array.from([0, 0.5, 0.45, 0, 0]),
    Float32Array.from([0, 0, 0, 0, 0.9]),
  ];
  const s = scorePosteriors(post, V, 'pa');
  assert.equal(s.consonant.verdict, 'ambiguous');
  assert.equal(s.consonant.place, 'ok');
  assert.equal(s.consonant.voicing, 'unsure');
});

test('a different place (k heard for t) is still wrong, not forgiven as voicing', () => {
  const V = ['<pad>', 't', 'd', 'k', 'a'];
  const post = [
    Float32Array.from([0, 0.1, 0.05, 0.85, 0]),
    Float32Array.from([0, 0, 0, 0, 0.9]),
  ];
  const s = scorePosteriors(post, V, 'ta');
  assert.equal(s.consonant.place, 'wrong');
});

test('digraph and fricative onsets resolve: sha, tha, cha, nga-style codas, vowel-only', () => {
  const V = ['<pad>', 'ʃ', 'ʒ', 'θ', 'ð', 'tʃ', 'dʒ', 'ŋ', 'f', 'v', 's', 'z', 'ɹ', 'j', 'l', 'ɑ', 'i', 'ɪ', 'u2', 'ʊ', 'e', 'ɛ', 'o', 'ɔ', 'm', 'p'];
  assert.deepEqual(resolveTargets('sha', V).consonant.labels, ['ʃ']);
  assert.deepEqual(resolveTargets('tha', V).consonant.labels, ['θ']);
  assert.deepEqual(resolveTargets('cha', V).consonant.labels, ['tʃ']);
  assert.deepEqual(resolveTargets('ja', V).consonant.labels, ['dʒ']);
  assert.deepEqual(resolveTargets('ra', V).consonant.labels, ['ɹ']);
  assert.deepEqual(resolveTargets('ya', V).consonant.labels, ['j']);
  assert.deepEqual(resolveTargets('ang', V).coda.labels, ['ŋ']);
  assert.deepEqual(resolveTargets('im', V).coda.labels, ['m']);
  assert.equal(resolveTargets('i', V).consonant, null);
  assert.deepEqual(resolveTargets('bi', ['b', 'i', 'ɪ']).vowel.labels, ['i', 'ɪ']);
  assert.deepEqual(resolveTargets('bu', ['b', 'u', 'ʊ']).vowel.labels, ['u', 'ʊ']);
  assert.deepEqual(resolveTargets('bo', ['b', 'o', 'ɔ']).vowel.labels, ['o', 'ɔ']);
  assert.deepEqual(resolveTargets('be', ['b', 'e', 'ɛ']).vowel.labels, ['e', 'ɛ']);
});

test('s vs z and f vs v behave like p vs b: place ok, voicing separate', () => {
  const V = ['<pad>', 's', 'z', 'f', 'a'];
  const post = [Float32Array.from([0, 0.5, 0.45, 0, 0]), Float32Array.from([0, 0, 0, 0, 0.9])];
  const s = scorePosteriors(post, V, 'sa');
  assert.equal(s.consonant.place, 'ok');
  assert.equal(s.consonant.voicing, 'unsure');
  const wrong = scorePosteriors([Float32Array.from([0, 0.05, 0.05, 0.9, 0]), Float32Array.from([0, 0, 0, 0, 0.9])], V, 'sa');
  assert.equal(wrong.consonant.place, 'wrong');
});

test('all five vowels are scored, and a wrong vowel is caught', () => {
  const V = ['<pad>', 'b', 'a', 'e', 'i', 'o', 'u'];
  const frames = (c, v) => {
    const mk = (idx, pk) => { const r = new Float32Array(V.length); r[idx] = pk; return r; };
    return [mk(1, 0.9), mk(V.indexOf(v), 0.85)];
  };
  for (const v of 'aeiou') assert.equal(scorePosteriors(frames('b', v), V, 'b' + v).vowel.verdict, 'target_dominant');
  assert.equal(scorePosteriors(frames('b', 'i'), V, 'bu').vowel.verdict, 'competitor_dominant');
});

test('final consonant is scored too', () => {
  const V = ['<pad>', 'a', 'm', 'n'];
  const mk = (idx, pk) => { const r = new Float32Array(V.length); r[idx] = pk; return r; };
  const s = scorePosteriors([mk(1, 0.9), mk(2, 0.8)], V, 'am');
  assert.equal(s.coda.verdict, 'target_dominant');
  assert.equal(s.consonant, null);
});

test('Indian-English realisations count: ɕ/ʂ/s. for sh, tɕ for ch, dʑ for j; retroflex t. still counts as t', () => {
  const V = ['<pad>', 'ʃ', 's.', 'ɕ', 's', 'tʃ', 'tɕ', 'dʑ', 'dʒ', 't', 't.', 'ɑ5'];
  assert.deepEqual(resolveTargets('sha', V).consonant.labels, ['ʃ', 's.', 'ɕ']);
  assert.deepEqual(resolveTargets('sa', V).consonant.labels, ['s']);
  assert.deepEqual(resolveTargets('cha', V).consonant.labels, ['tʃ', 'tɕ']);
  assert.deepEqual(resolveTargets('ja', V).consonant.labels, ['dʑ', 'dʒ']);
  assert.deepEqual(resolveTargets('ta', V).consonant.labels, ['t', 't.']);
  const mk = (idx, pk) => { const r = new Float32Array(V.length); r[idx] = pk; return r; };
  const s = scorePosteriors([mk(2, 0.9), mk(11, 0.8)], V, 'sha'); // heard s. then ɑ5
  assert.equal(s.consonant.verdict, 'target_dominant');
});
