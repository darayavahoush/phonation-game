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

## Not done yet

- `features.py` has not been run against the real model (no access from where it was written). Expect to fix small things on first run.
- The game does not use a trained head yet. `--export` writes the browser-sized head as JSON, but nothing loads it.
- Hidden-state heads (usually stronger) need a model export that returns hidden states. Decide that only if they clearly win in step 3.
- Fine-tuning the model itself comes after we see these numbers.
