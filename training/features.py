#!/usr/bin/env python3
"""Turn collected clips into training features, using the same wav2vec2 phone model the lab runs.

  python3 training/features.py lumivox-clips-2026-10-04.zip --out training/feats.npz

Input: the .zip from /collect.html (or the unzipped folder), with manifest.csv + clips/*.wav.
Runs locally; downloads the model from Hugging Face once. Nothing else leaves your machine.

Per clip it saves, pooled over the speech part only (from the manifest's speech_start/end), split into
early / middle / late thirds:
  hid   hidden-state means from several layers   (N, layers, 3, hidden)   <- richest, for offline experiments
  post  per-phone max CTC probability            (N, 3, vocab)            <- what the browser model also gives
  greedy  the plain greedy phone string, for the baseline
"""
import argparse, csv, io, json, math, os, sys, wave, zipfile
import numpy as np

MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"   # PyTorch original of the ONNX model used in lab.html
LAYERS = [8, 12, 16, 20, 24]                      # middle layers usually hold the most phonetic detail
FRAME_MS = 20


def read_manifest(src):
    if os.path.isdir(src):
        rd = lambda p: open(os.path.join(src, p), "rb").read()
    else:
        z = zipfile.ZipFile(src); rd = z.read
    rows = list(csv.DictReader(io.StringIO(rd("manifest.csv").decode("utf-8"))))
    return rows, rd


def read_wav(raw):
    w = wave.open(io.BytesIO(raw))
    assert w.getsampwidth() == 2 and w.getnchannels() == 1, "expected 16-bit mono wav"
    x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    return x, w.getframerate()


def to16k(x, sr):
    if sr == 16000:
        return x
    from scipy.signal import resample_poly
    g = math.gcd(sr, 16000)
    return resample_poly(x, 16000 // g, sr // g).astype(np.float32)


def span_frames(row, T):
    s, e = float(row["speech_start_ms"]), float(row["speech_end_ms"])
    if e <= s:                                    # no speech found: use the whole clip
        return 0, T
    t0 = max(0, int((s - 60) // FRAME_MS)); t1 = min(T, int(math.ceil((e + 60) / FRAME_MS)) + 1)
    return (t0, t1) if t1 - t0 >= 3 else (0, T)


def thirds(t0, t1):
    n = t1 - t0; edges = [t0 + round(n * k / 3) for k in range(4)]
    return [(edges[k], max(edges[k + 1], edges[k] + 1)) for k in range(3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("--out", default="training/feats.npz"); ap.add_argument("--model", default=MODEL)
    a = ap.parse_args()
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    rows, rd = read_manifest(a.src)
    print(f"{len(rows)} clips; loading {a.model} ...", flush=True)
    fe = Wav2Vec2FeatureExtractor.from_pretrained(a.model)
    model = Wav2Vec2ForCTC.from_pretrained(a.model).eval()
    vocab = json.load(open(hf_hub_download(a.model, "vocab.json")))
    inv = {i: t for t, i in vocab.items()}; blank = vocab.get("<pad>", 0); V = model.config.vocab_size
    layers = [l for l in LAYERS if l <= model.config.num_hidden_layers]

    hid, post, greedy = [], [], []
    for k, r in enumerate(rows):
        x, sr = read_wav(rd(r["file"])); x = to16k(x, sr)
        inp = fe(x, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            out = model(inp.input_values, output_hidden_states=True)
        p = torch.softmax(out.logits[0], -1).numpy(); T = p.shape[0]
        t0, t1 = span_frames(r, T); parts = thirds(t0, t1)
        post.append(np.stack([p[a_:b_].max(0) for a_, b_ in parts]))
        hid.append(np.stack([np.stack([out.hidden_states[l][0, a_:b_].mean(0).numpy() for a_, b_ in parts]) for l in layers]))
        ids = p.argmax(-1); toks, prev = [], None
        for i in ids:
            if i != prev and i != blank: toks.append(inv.get(int(i), "?"))
            prev = i
        greedy.append(" ".join(toks))
        if (k + 1) % 20 == 0: print(f"  {k + 1}/{len(rows)}", flush=True)

    col = lambda n: np.array([r[n] for r in rows])
    np.savez_compressed(a.out, hid=np.array(hid, dtype=np.float16), post=np.array(post, dtype=np.float32), greedy=np.array(greedy),
                        layers=np.array(layers), syllable=col("syllable"), consonant=col("consonant"), vowel=col("vowel"),
                        speaker=col("speaker"), voice=col("voice"), clip_file=col("file"))
    print("saved", a.out)


if __name__ == "__main__":
    main()
