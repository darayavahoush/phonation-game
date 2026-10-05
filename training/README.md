# Training your own syllable recognizer

Everything here runs on your machine. Nothing is uploaded.

## 1. Collect clips

`npm run dev`, open `http://localhost:5173/collect.html`.

1. Enter a speaker id (a code like `s01`, not a name), pick adult or child, tick the consent box.
2. Pick consonants and vowels (or a preset). Start with **Stop pairs + a**: ba pa da ta ga ka, 10 takes each.
3. Start the mic, press **Make the list**, then Space = record/stop, Enter = keep, R = redo.
   Only keep a clip if it really is the syllable shown.
4. **Export .zip** at the end of every session (clips live in the browser until you do).

Tips that matter more than the model:
- Several speakers beat many clips from one speaker. Aim for 5+ speakers before trusting any number.
- Record in the same room, with the same mic and distance, as the game.
- Record the sound the way your target players say it (for example Tamil or Indian-English th/dh), and decide that before you start.
- Children: needs guardian consent and a plan for storing clips. Adult clips will not stand in for them.

## 1b. Or generate synthetic clips with gTTS (no recording)

```bash
pip install gTTS numpy scipy && brew install ffmpeg
python3 training/make_tts_dataset.py --out training/tts-data --sample 6
```

Makes ba pa da ta ga ka in 7 English accents, plus randomised copies (speed, echo, loudness, noise). Same folder layout as the
collector export. **Listen to the files `--sample` prints before trusting the labels**: the label is the text sent to Google, not
what it said. This is a few synthetic adult voices, so test it on real recordings (step 3, transfer mode), never on itself.
For Hindi/other-script targets pass `--extra file.csv` (columns `syllable,lang,tld,text`).

## 1c. Hindi barakhadi (every consonant x 12 vowel forms)

```bash
python training/make_barakhadi_csv.py > training/barakhadi.csv
python training/make_tts_dataset.py --out training/tts-hi --consonants --extra training/barakhadi.csv --accents com --augment 3 --sample 12
```

276 syllable texts, one Google Hindi voice (so held-out-speaker scores are meaningless here; use real recordings as the test).
Hindi th/dh are the aspirated stops थ/ध, not English θ/ð. d and t use both dental and retroflex letters under one label.
zh and w are skipped (no Hindi letter). Vowel labels: a aa i ii u uu e ai o au am ah.

## 2. Features (downloads the PyTorch model from Hugging Face, over 1 GB)

```bash
pip install torch transformers huggingface_hub scipy numpy scikit-learn
python3 training/features.py ~/Downloads/lumivox-clips-2026-10-04.zip --out training/feats.npz
```

## 3. Train and compare

```bash
python3 training/train.py training/feats.npz
```

Prints consonant, vowel and whole-syllable accuracy for the plain model (baseline), a head on the browser-sized
features, and heads on several hidden layers, plus how often p/b, t/d, k/g and the other voicing pairs are swapped.
With 2+ speakers it holds out one whole speaker at a time. With one speaker the number is optimistic.

Train on TTS, test on real recordings (the number that matters):

```bash
python3 training/features.py training/tts-data --out training/feats_tts.npz
python3 training/features.py ~/Downloads/lumivox-clips-....zip --out training/feats_real.npz
python3 training/train.py --train training/feats_tts.npz --test training/feats_real.npz
```

`python3 training/selftest.py` checks the training code on synthetic features (it says nothing about real speech).

## 1d. Indian-language syllables (Hindi, Malayalam, Tamil, Telugu, Kannada, Gujarati, Marathi, Bengali, Punjabi)

```bash
python training/make_india_csv.py --langs hi,ml,ta --vowels a,i,ii,u,uu,e,ee,o,oo > training/india.csv
python training/make_tts_dataset.py --out training/tts-india --consonants --extra training/india.csv --accents com --augment 2 --sample 24
python training/make_india_csv.py --langs te,kn,gu,mr,bn,pa --vowels a,i,ii,u,uu,e,ee,o,oo --no-english > training/india2.csv
python training/make_tts_dataset.py --out training/tts-india2 --consonants --extra training/india2.csv --accents com --augment 2 --sample 24
python training/childify.py training/tts-india training/tts-india-child      # pitch/formant-shifted copies
```

Google asks for about one request per second, so the big sets take 15-25 minutes; the mp3 cache makes a re-run resume where it stopped.

Then build one game-sized feature file and train on it:

```bash
python training/features.py training/tts-india --out training/feats_tts_india.npz     # repeat for tts-india2, tts-india-child
python training/combine_npz.py training/feats_big.npz training/feats_tts_india.npz training/feats_tts_india2.npz training/feats_tts_india_child.npz
python training/relabel_npz.py training/feats_big.npz training/feats_big_fixed.npz     # split syllable labels into consonant + vowel
python training/merge_classes.py training/feats_big_fixed.npz training/feats_big_game.npz   # tt->t, dd->d, ss->sh, ii->i ...
python training/train.py training/feats_big_game.npz
python training/confusions.py training/feats_big_game.npz --layer 8 --classes th dh z f   # what is going wrong, and is it fair
```

The generated `.npz` files, clips and logs are git-ignored; only the scripts and CSVs are committed.

Caveats when reading the scores:
- The held-out "speaker" here is one TTS voice (a language or accent), so the number mixes new-voice and new-language transfer. A class that exists in only one voice (z and f) scores 0% by construction; `confusions.py` reports the score with those left out.
- In the Indic sets `th`/`dh` are the aspirated dental stops (थ ध), not English θ/ð, and merging retroflex into dental (`tth`->`th`) widens them further. Decide which sound the game means before reading much into those two rows.

## Not done yet

- `features.py` has not been run against the real model (no access from where it was written). Expect to fix small things on first run.
- The game does not use a trained head yet. `--export` writes the browser-sized head as JSON, but nothing loads it.
- Hidden-state heads (usually stronger) need a model export that returns hidden states. Decide that only if they clearly win in step 3.
- Fine-tuning the model itself comes after we see these numbers.
