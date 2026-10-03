# Validating the phonation engine on recorded speech

`../README.md` says the engine is validated on synthetic signals only. This folder is the tooling to change that.
Nothing here uploads audio. Everything runs locally.

## Quick start (synthetic smoke test: proves the tooling works, NOT that the engine is valid)

```bash
pip install praat-parselmouth numpy            # once
node validation/make-synthetic.mjs
node validation/run-engine.mjs validation/manifest-synthetic.json --out validation/out/clean.jsonl
python3 validation/compare.py validation/manifest-synthetic.json validation/out/clean.jsonl

# noise robustness (works on any set of recordings, no extra data needed)
node validation/run-engine.mjs validation/manifest-synthetic.json --snr 10 --out validation/out/snr10.jsonl
python3 validation/compare.py validation/manifest-synthetic.json validation/out/clean.jsonl --vs validation/out/snr10.jsonl
```

## With real recordings

1. Copy recordings to `validation/data/` (git-ignored). Mono or stereo WAV, any sample rate.
2. Write `validation/manifest.json` (see `manifest.example.json`). Each entry says which level to run and what the humans decided (`truth`).
   - Calibration: either `noiseFile` (a few seconds of room tone) or `calibSec` (use the first N seconds as the quiet lead-in).
     If your recordings start talking immediately, use `noiseFile` or `calibSec: 0`; a lead-in containing speech gives a wrong noise floor.
   - `truth` can hold any of: `passed`, `count`, `mptSec`, `f0MeanHz`, `rangeSemitones`. Human labels beat Praat as ground truth.
3. Run `run-engine.mjs`, then `compare.py` (add `--vs` for a noisy run, `--tune mptSec` to pick a pass threshold).

`compare.py` reports: agreement with Praat (r, bias, 95% limits of agreement), agreement with human counts and pass/fail
(sensitivity, specificity, kappa), results split by `group` and `device`, how many recordings the quality gate rejected,
and whether anything changed result under noise while still marked reliable.

## Which data answers which question

| Question | Data | Notes |
|---|---|---|
| Does F0 / voicing hold up on disordered adult voices? | Saarbrücken Voice Database | >2000 German speakers, healthy and 71 pathologies; /i a u/ at normal, high, low and rising-falling pitch; clips of 1-3 s at 50 kHz. Free to download. Good for F0 and glide direction. Too short for MPT; adults only. |
| Does syllable/voicing detection survive atypical speech? | Speech Accessibility Project | Adults with Parkinson's, ALS, cerebral palsy, Down syndrome, stroke; ~1,090 h. Needs a signed data use agreement plus a one-page proposal; no redistribution; it is aimed at speech-recognition work, so frame your proposal honestly. I have not checked whether it contains repetition (DDK) tasks. |
| Does it work for the children you built it for, on their devices? | Your own small consented set | Public labelled *clinical child* recordings are scarce, and I have not verified the access terms of PhonBank/TalkBank. 30-60 recordings with a speech-language pathologist counting syllables by hand is more decisive than any adult database. Record on the real tablets/phones. |
| Does the quality gate catch bad rooms? | Any set above + `--snr` sweep | Mixes synthetic white noise. Real rooms (fans, babble, TV) are harder, so also record a few in genuinely noisy places. |

## What "tuning" means for this engine

There are no trained weights. The knobs are thresholds:

- Per level (safe to change): `targetDurationSec`, `minSnrDb`, `maxF0SdSemitones`, `minRangeSemitones`, `minSyllables`, `votBoundaryMs`.
- Inside the engine: `GATE_MARGIN_DB` (8), `YIN_THRESHOLD` (0.2), syllable `minDipDb` (3) and `minSepSec` (0.08), monotonicity cut-off (0.7),
  `QUALITY.HIGH_NOISE_DB` (-45), `CLIP_FRACTION`.

Rules that keep the result honest:
1. Decide pass criteria with your clinician BEFORE looking at results.
2. Split by speaker, not by recording. Tune on one split, report on the other.
3. If counts are systematically off, send me the `compare.py` output. The syllable settings are not yet exposed as level parameters; I will add that once there is data showing which direction they need to move.
4. A neural phoneme recognizer (the optional `recognition/` path) is a separate project: fine-tuning needs hundreds of labelled child/Indian-English utterances and a GPU. Measure its error rate first.

## Privacy

Never commit recordings, real manifests, or `out/`. They are in `.gitignore`. Children's recordings need guardian consent and ethics approval.
Dataset agreements generally forbid sharing the audio, so keep it off GitHub, off shared drives, and out of chat uploads.
