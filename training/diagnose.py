#!/usr/bin/env python3
"""Per-speaker breakdown of the leave-one-speaker-out result.

    python training/diagnose.py training/feats_tts_india.npz --layer 8

Prints, for each held-out speaker: consonant and vowel accuracy, accuracy on
classes the training speakers also had ("seen"), the classes that were never in
training, and the top consonant confusions. Uses a plain logistic regression on
the chosen hidden layer, so numbers will be close to, not identical with, train.py.
"""
import argparse, collections
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ap = argparse.ArgumentParser()
ap.add_argument("feats")
ap.add_argument("--layer", type=int, default=8)
ap.add_argument("--C", type=float, default=0.1)
a = ap.parse_args()

z = np.load(a.feats, allow_pickle=True)
print("keys:", {k: z[k].shape for k in z.files})
hid, layers = z["hid"], [int(x) for x in z["layers"]]
if a.layer not in layers:
    raise SystemExit(f"layer {a.layer} not in {layers}")
X = hid[:, layers.index(a.layer)]          # (clips, [segments,] features)
X = X.reshape(len(X), -1).astype(np.float32)  # flatten any per-segment axis
cons, vow, spk = (np.array(z[k]).astype(str) for k in ("consonant", "vowel", "speaker"))


def fit_predict(tr, te, y):
    sc = StandardScaler().fit(X[tr])
    m = LogisticRegression(C=a.C, max_iter=300).fit(sc.transform(X[tr]), y[tr])
    return m.predict(sc.transform(X[te]))


print(f"\nfeatures {X.shape}, layer {a.layer}, {len(set(cons))} consonant classes, "
      f"chance ~{100 / len(set(cons)):.0f}%\n")
for s in sorted(set(spk)):
    te = spk == s
    tr = ~te
    pc, pv = fit_predict(tr, te, cons), fit_predict(tr, te, vow)
    seen = np.isin(cons[te], np.unique(cons[tr]))
    never = sorted(set(cons[te][~seen]))
    acc_c = (pc == cons[te]).mean() * 100
    acc_v = (pv == vow[te]).mean() * 100
    acc_seen = (pc[seen] == cons[te][seen]).mean() * 100 if seen.any() else float("nan")
    print(f"== held out {s}: {te.sum()} clips   consonant {acc_c:.0f}%   vowel {acc_v:.0f}%")
    print(f"   consonant on classes the others also had: {acc_seen:.0f}%   never in training: {never}")
    conf = collections.Counter((t, p) for t, p in zip(cons[te], pc) if t != p and t in set(cons[tr]))
    print("   top confusions (true->heard):",
          ", ".join(f"{t}->{p} x{n}" for (t, p), n in conf.most_common(8)))
    print()
