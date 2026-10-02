# Phonation module: typed levels with acoustic biofeedback

A browser-side module for phonation games. Each level has a **type**; the type decides what is measured, what the child sees live, and how the trial is scored. Only derived features leave the module: **no raw audio is stored or transmitted**.

```
mic ─► PhonationEngine ─► PhonationAnalyzer ─► live biofeedback state (≈100 Hz)
        (browser I/O)       FeatureExtractor      └► scoreTrial() ─► TrialResult (JSON)
                            (16 kHz, 5 ms hop)
```

`PhonationAnalyzer` and everything under it are DOM-free and unit-tested in Node (`node --test __tests__/phonation.test.js`).

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
- Use a headset or external mic at a consistent distance where possible; laptop mics at variable distance make intensity measures unreliable.
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

## Files

`dsp.js` (YIN, FFT, decimator, stats) · `FeatureExtractor.js` (frames) · `analysis.js` (segments, nuclei, onset/VOT) · `scoring.js` (per-type scorers, quality) · `levelSchema.js` (typed levels, validation) · `PhonationAnalyzer.js` (calibration, live state, trials) · `PhonationEngine.js` + `phonation-worklet.js` (browser mic) · `levels.js` (starter curriculum) · `types.d.ts` · `__tests__/`
