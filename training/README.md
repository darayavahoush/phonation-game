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

`python3 training/selftest.py` checks the training code on synthetic features (it says nothing about real speech).

## Not done yet

- `features.py` has not been run against the real model (no access from where it was written). Expect to fix small things on first run.
- The game does not use a trained head yet. `--export` writes the browser-sized head as JSON, but nothing loads it.
- Hidden-state heads (usually stronger) need a model export that returns hidden states. Decide that only if they clearly win in step 3.
- Fine-tuning the model itself comes after we see these numbers.
