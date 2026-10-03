# Phonation module: typed levels with acoustic biofeedback

A browser-side module for phonation games. Each level has a **type**; the type decides what is measured, what the child sees live, and how the trial is scored. By default only derived features exist: **no raw audio is kept, stored or transmitted**. The optional on-device recognition path (below) is opt-in per trial and holds audio in memory only until the trial is scored.

```
mic ─► PhonationEngine ─► PhonationAnalyzer ─► live biofeedback state (≈100 Hz)
        (browser I/O)       FeatureExtractor      └► scoreTrial() ─► TrialResult (JSON)
                            (16 kHz, 5 ms hop)
```

`PhonationAnalyzer` and everything under it are DOM-free and unit-tested in Node (`npm test`).

## Level types

| type | what the child does | measured | passes when |
|---|---|---|---|
| `sustained_voicing` | hold /a/, /m/, … | maximum phonation time (MPT), phonation ratio, mean/SD level, mean F0, F0 SD (semitones) | MPT ≥ target, SNR ≥ `minSnrDb`, and F0 SD ≤ `maxF0SdSemitones` if set |
| `cv_syllable` | "ba", "ma", "pa" × reps | syllable count and duration; *experimental:* VOT, onset class | count ≥ `reps` |
| `syllable_train` | "ba-ba-ba…" (repetition / DDK) | syllable count, rate (syll/s), inter-onset-interval CV | count ≥ `minSyllables`, rate within optional min/max |
| `pitch_glide` | slide up / down | F0 range (semitones), start/end Hz, slope, monotonicity | range ≥ target, right direction, monotonicity ≥ 0.7 |
| `loudness_ramp` | quiet→loud / loud→quiet | level change (dB), monotonicity | change ≥ target in the right direction |

Targets are **clinician-adjustable parameters, not norms**. `STARTER_LEVELS` is an illustrative progression only. The module deliberately ships no normative tables; compare against whatever references your clinicians use.

## What the numbers mean (read before interpreting)

- **Levels are dBFS, relative.** They are not dB SPL. They depend on mic gain and distance, so use them for *within-child, same-setup* change (and ramps), never as absolute loudness.
- **Calibration is required.** `calibrate()` measures room noise; voicing, SNR and onset detection are relative to it. Uncalibrated trials are flagged.
- **MPT** is the longest voiced segment; unvoiced dropouts under 60 ms are bridged. It is a game-grade measure, not a replacement for a clinician-timed MPT.
- **Syllable rate** follows the usual DDK approach (peaks of the intensity envelope inside voicing). Rate = (n−1) / (last peak − first peak).
- **F0** uses YIN with parabolic interpolation. Tracking glitches (octave jumps) are rejected against a running median.
- **VOT and onset class are EXPERIMENTAL.** They are off the pass/fail path by default (`requireMannerMatch: false`).

## Deliberately NOT computed

- **Jitter, shimmer, HNR, CPP:** these need controlled recording conditions, calibrated mics, and validated algorithms. Browser mic audio doesn't support valid values, and a plausible-looking number would be worse than none.
- **Articulation accuracy / "was that really /ba/":** this is acoustic feedback, not speech recognition and not a diagnosis. The module never labels a child's speech as disordered.

## Capture requirements

- Echo cancellation, noise suppression and AGC are requested **off**. If the browser ignores that, trials carry `capture_processing` and `quality.reliable = false`.
- Start from a user gesture (iOS/Chrome suspend audio otherwise).
- The worklet loads from an in-memory Blob URL (bundlers inline small worklet files as `data:` URLs, which `addModule()` does not reliably accept). If your CSP blocks blob workers, pass `workletUrl` (a real served copy of `phonation-worklet.js`); the engine also falls back to ScriptProcessor if the worklet cannot load.
- Use a headset or external mic at a consistent distance where possible; laptop mics at variable distance make intensity measures unreliable.
- `clipping` means flat-topped samples: runs of consecutive samples at full scale (about 0.08 ms or longer), at least 0.1 % of the trial. A loud voice whose peaks only touch full scale is not flagged. `quality.peakAbs` (0..1) and `quality.clipFraction` are reported next to the flag. The run length and fraction are placeholders: not yet validated on real devices.
- Quality flags: `not_calibrated`, `high_noise` (room above −45 dBFS), `clipping`, `capture_processing`, `low_snr` (< 15 dB), `no_voicing`. **Show `quality.reliable` to the clinician next to every metric.**

## Validation status (be honest about this with clinicians)

Validated **on synthetic signals only** (see tests):

- F0 within 1 % for 150–600 Hz (child profile, at 44.1 and 48 kHz capture rates) and within 1.5 Hz at 100 Hz (adult profile).
- MPT, glide range, ramp change, syllable count/rate and regularity behave as designed on controlled signals.
- Synthetic VOT: after compensating a measured ~10 ms voicing-detection lag (`VOICING_LAG_MS`), errors were within about ±10 ms (hop resolution is ~5 ms). Values within roughly 20–40 ms of the 30 ms boundary should be treated as ambiguous.

**Not yet validated:**

- Real children's speech, real rooms, real devices.
- VOT and nasal-murmur heuristics on recorded speech (children's VOT is longer and more variable than the default boundary assumes).
- Any comparison against a reference tool (e.g. Praat) on recorded data.

Before presenting any metric as clinically meaningful, record a small labelled set with consent and compare against a reference tool. The synthetic tests prove the code does what it claims, not that the claims hold on real voices.

## Integration sketch

```js
import { PhonationEngine, validateLevel, STARTER_LEVELS } from './phonation';

const engine = new PhonationEngine({ profile: 'child', onLive: (s) => (latest.current = s) });

// inside a click handler:
await engine.start();
const cal = await engine.calibrate(1500);          // "shh, stay quiet"
if (!cal.ok) showRoomWarning(cal.warnings);

engine.beginTrial(STARTER_LEVELS[3]);              // cv-ba-3
// requestAnimationFrame loop reads latest.current:
//   voiced / intensityNorm / voicedRunSec / f0Hz drive the visuals
const result = engine.endTrial();                  // TrialResult (JSON-safe, small)
// POST `result` to your session endpoint; render result.quality for clinicians.
```

Calling `endTrial()`: end it when `live.trialElapsedSec >= level.maxDurationSec`, when the level goal is reached, or when the child taps stop.

## Design notes for this population

- Keep feedback to **one** moving element with muted colours; no flashing. Latency matters more than richness: map `voiced` / `intensityNorm` straight to the visual.
- `voiced` bridges <60 ms dropouts so the visual doesn't flicker on natural micro-pauses.
- `stars` are gamification only; therapists should read `metrics` and `quality`.

## Optional: on-device recognition (EXPERIMENTAL)

A second, separate path for phoneme-level evidence. It **never** changes `passed`, `stars` or any acoustic metric, and it is attached to the result as `result.recognition` with `experimental: true`.

```js
import * as transformers from '@huggingface/transformers';           // the app installs this, the module doesn't depend on it
import { TransformersPhonemeRecognizer } from './phonation';

const recognizer = new TransformersPhonemeRecognizer({
  transformers,
  modelId: '<a phoneme-CTC model with ONNX weights>',                // no default on purpose, see "Choosing a model"
  // vocab: {...vocab.json...},                                      // pass this if the model's tokenizer can't be loaded
  // preprocess: async (audio16k) => audio16k,                       // optional hook, e.g. a neural denoiser
});
recognizer.ready();                                                  // warm up in the background

engine.beginTrial(level, { captureAudio: true });                    // audio kept IN MEMORY for this trial only
const result = await engine.endTrialAndRecognize(recognizer);        // audio is dropped before this returns
// result.recognition = { experimental, heard: ['b','ɑ'], consonant: { verdict, llr, bestCompetitor }, vowel: {...}, caveats }
```

How it works: the model's CTC posteriors are scored for isolated syllables (`cv_syllable`, `syllable_train`) as a GOP-style log-posterior ratio between the target phone and the best competing phone. There is no forced alignment, so it is only meaningful for short isolated syllables. If the model vocabulary has no label for the target phone, the result is `ok: false, reason: 'target_labels_not_in_vocab'` instead of a made-up score.

**Privacy change when enabled:** audio is buffered (16 kHz, in memory, capped at `maxDurationSec + 2` s) so the model can run on this device. It is never persisted or sent anywhere by this module. Say so in your consent text (the UI does when a `recognizer` prop is given). Silence/no-voicing trials skip the model entirely, because recognizers hallucinate on silence.

### Choosing a model (read before enabling)

- Character-level ASR models (for example `wav2vec2-base-960h`) output letters, not phonemes. You need a **phoneme** CTC model.
- Large models are heavy for children's tablets. One community ONNX phoneme model found while preparing this (`robg/speako-phoneme-recognizer`, a TIMIT-derived 39-symbol inventory) has a quantized file of roughly 355 MB; it has not been evaluated here. Measure download size, load time and latency on your target devices first.
- Models trained on adult read speech (TIMIT and similar) are likely to score young or atypical voices unfairly.
- Some phoneme models ship only a slow CTC tokenizer that Transformers.js cannot load; pass `vocab` yourself.

### Evaluate before trusting any output

1. Record a small set with parental consent: typical children and, with clinician involvement, children with known articulation differences. Keep recordings off the repo.
2. Have an SLP label each token (correct / substitution / distortion / omission).
3. Compare `consonant.verdict` against the labels. Report agreement per phone and per age band, including false "competitor_dominant" rates on typical speech.
4. Only then decide whether the output may be shown to clinicians, and under what wording. The thresholds in `recognition/posteriors.js` (`LLR_MARGIN`, `WEAK_PEAK`) are placeholders.

## Optional: de-identified session summary for drafted notes

`summarizeForReport(results, { ageBand })` builds a whitelist-only aggregate (no names, player codes, emails, timestamps, experimental metrics or recognizer output). `buildDraftPrompt(summary)` wraps it in instructions that require clinician review and forbid diagnosis. **This module makes no network calls.** Whether to send that text to any hosted model is the app's decision (check your consent and data-protection obligations first), and the generated text is a draft, never a clinical record.

## Considered but not included

- **Neural denoising (RNNoise / DeepFilterNet):** only as the `preprocess` hook on the recognizer's audio. It must never sit in front of the acoustic metrics, because it changes level, onsets and voicing. No implementation is shipped.
- **Whisper-class ASR:** the current levels are syllables and sounds, where it tends to hallucinate. Revisit when word-level levels exist.
- **Neural TTS, webcam lip tracking:** out of scope here. If lip tracking is added, keep it on-device; do not send a child's video to a hosted API.

## Files

`dsp.js` (YIN, FFT, decimator, stats) · `FeatureExtractor.js` (frames) · `analysis.js` (segments, nuclei, onset/VOT) · `scoring.js` (per-type scorers, quality) · `levelSchema.js` (typed levels, validation) · `PhonationAnalyzer.js` (calibration, live state, trials) · `PhonationEngine.js` + `phonation-worklet.js` (browser mic) · `levels.js` (starter curriculum) · `recognition/` (posterior scoring, recognizer adapters) · `report/` (de-identified summary) · `workletSource.js` (generated from `phonation-worklet.js`) · `ui/` · `types.d.ts` · `__tests__/`

## Noise floor and the "room is noisy" verdict

The room-noise floor is measured in calibration and refreshed from the last 10 s of audio before each
trial. Frames more than 6 dB above the quiet baseline (a cough, a click, speech) are treated as
transients and left out, so one disturbance does not make a quiet room "noisy" for the whole session.
`quality.noiseSource` says which estimate was used (`calibration` or `tracked`).

`quality.primaryIssue` names the one reason a recording was flagged so a UI can word it correctly:
`room_noisy` (find a quieter place), `voice_soft` (speak up or move closer), `too_loud`,
`device_processing`, `not_calibrated` or `no_voice`. A soft voice is not a noisy room.

The 6 dB margin, the 20th-percentile baseline, the 10 s window and the 15 dB `low_snr` limit are
placeholders chosen on synthetic audio. They are not validated on real devices or rooms.
