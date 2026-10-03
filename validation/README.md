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

Access terms below were read from the sources on 2026-10-03. Re-check before you rely on them, and cite every dataset you use.

| Question | Data | Access and notes |
|---|---|---|
| Does F0 / voicing hold up on disordered adult voices? | **Saarbrücken Voice Database** (Zenodo 10.5281/zenodo.16874898) | CC-BY 4.0, free. German adults, healthy plus ~70 diagnoses (incl. Parkinson's, ALS, dysarthria, stuttering, Down syndrome, orofacial dyspraxia). Vowels /i a u/ at normal/high/low/rising-falling pitch, 1-3 s, 50 kHz. Files are `.nsp`; convert with ffmpeg (see below). Good for F0, glide, voicing on rough/breathy voices. No labelled counts, too short for MPT, adults only. |
| Does syllable counting survive atypical speech? | **NeuroVoz** (Zenodo 10.5281/zenodo.10777657) | Castilian-Spanish Parkinson's + controls, ~108 speakers. Sustained vowels (x3), ~10 s /pa-ta-ka/ DDK, GRBAS voice ratings. Public, but check the Zenodo record's licence yourself (GitHub says MIT; the paper carries a different licence). Has no hand-counted syllables, so label a sample with `label.py`. |
| Real *children's* voices, clinical setting | **UltraSuite** (UXTD typically developing, UXSSD + UPX speech sound disorders; ~86 children) | UK English child speech-therapy sessions with transcripts and phone/word boundaries. A small sample is on Edinburgh DataShare; the full set is requested via ultrax-speech.org (terms not verified by me). Good for voicing/noise-gate/F0 on real child recordings; not for DDK counts. |
| More disordered-adult speech | Speech Accessibility Project | Adults (Parkinson's, ALS, CP, Down syndrome, stroke), ~1,090 h. Signed data use agreement + one-page proposal; no redistribution; framed around speech recognition. I have not checked whether it has repetition tasks. |
| Does it work for *your* children, on *their* devices | Your own small consented set | 30-60 clips, hand-labelled by a speech-language pathologist, recorded on the real tablets. Public labelled child DDK data is scarce; this is the decisive set. |
| Does the quality gate catch bad rooms? | Any set above + `--snr` | Synthetic white noise only. Add a few recordings from genuinely noisy places. |

### Saarbrücken, step by step

```bash
brew install ffmpeg                      # once
mkdir -p validation/data/svd && cd validation/data/svd
# Start small. In a browser open https://zenodo.org/records/16874898 and download, for example:
#   healthy.zip (6 GB; or skip at first), Morbus Parkinson.zip (5.5 MB), Amyotrophe Lateralsklerose.zip (14 MB),
#   Dysarthrophonie.zip (144 MB), Morbus Down.zip (9 MB), Orofaciale Dyspraxie.zip (9.7 MB)
# unzip each into its OWN folder named after the zip:
for z in ~/Downloads/*.zip; do d="$(basename "$z" .zip)"; mkdir -p "$d" && unzip -qo "$z" -d "$d"; done
cd ../../..
curl -LO https://raw.githubusercontent.com/UMEssen/stimmdatenbank-converter/main/convert_nsp_to_wav.py
python3 convert_nsp_to_wav.py validation/data/svd && rm convert_nsp_to_wav.py     # writes .wav next to each .nsp
python3 validation/make_manifest.py --preset svd --root validation/data/svd --out validation/manifest-svd.json --limit-per-group 20
node validation/run-engine.mjs validation/manifest-svd.json --out validation/out/svd.jsonl
python3 validation/compare.py validation/manifest-svd.json validation/out/svd.jsonl
```

Read section 5 of the report first: per diagnosis, how often the engine finds no voice, how often it calls the recording
unreliable, and how far its F0 is from Praat. Then listen to the ten largest disagreements.

Things to expect, so you do not misread the result:
- The builder uses the adult profile (F0 70-450 Hz). Female *high-pitch* vowels can exceed 450 Hz; that is out of range by design, not a bug. Re-run with `--profile child` (130-700 Hz) to see the difference.
- These clips may have almost no silence, so calibration uses the clip's own quietest windows (`calibQuietest`). If a clip is voiced from the first sample, the noise floor is overestimated and the engine may report `no_voicing`; that is a limit of the data.
- "Pathological" is a diagnosis, not a score. This tests whether the *measurement* survives rough, breathy or unsteady voices, not whether the engine detects disease.

### Labelling a sample by ear

```bash
python3 validation/label.py validation/manifest-neurovoz.json --field count --sample 20 --units-per 3   # you count pa-ta-ka triplets
```

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
