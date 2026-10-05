#!/usr/bin/env python3
"""Fold the fine script-level labels into the classes the game uses.

  python training/merge_classes.py feats_big_fixed.npz feats_big_game.npz
  python training/merge_classes.py feats_big_fixed.npz feats_big_plain.npz --aspirates --drop-single-group

Always: retroflex -> dental (tt->t, tth->th, dd->d, ddh->dh, nn->n, ll->l, rr->r), ss->sh, long vowels -> short.
--aspirates          also fold aspirated stops into their plain twin (kh->k gh->g jh->j bh->b dh->d th->t ph->p chh->ch).
                     TTS voices barely make that contrast (Malayalam th was heard as t 67% of the time), so TTS labels
                     cannot teach it. Keep it off once real recordings show the contrast is audible.
--drop-single-group  drop classes that exist in only one voice group (they cannot be learned when that group is held out).
"""
import argparse

import numpy as np

CM = {"tt": "t", "tth": "th", "dd": "d", "ddh": "dh", "nn": "n", "ll": "l", "rr": "r", "ss": "sh"}
VM = {"ii": "i", "uu": "u", "ee": "e", "oo": "o"}
ASP = {"kh": "k", "gh": "g", "jh": "j", "bh": "b", "dh": "d", "th": "t", "ph": "p", "chh": "ch"}

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--aspirates", action="store_true")
ap.add_argument("--drop-single-group", action="store_true")
a = ap.parse_args()

z = np.load(a.src, allow_pickle=True)
d = {k: z[k] for k in z.files}
cons = [CM.get(c, c) for c in np.array(d["consonant"]).astype(str)]
if a.aspirates:
    cons = [ASP.get(c, c) for c in cons]
cons = np.array(cons)
d["consonant"] = cons
d["vowel"] = np.array([VM.get(v, v) for v in np.array(d["vowel"]).astype(str)])

if a.drop_single_group:
    spk = np.array(d["speaker"]).astype(str)
    groups = {c: len(set(spk[cons == c])) for c in set(cons)}
    dropped = sorted(str(c) for c, g in groups.items() if g < 2)
    keep = np.array([groups[c] >= 2 for c in cons])
    n = len(cons)
    for k in d:
        if k != "layers" and len(d[k]) == n:
            d[k] = d[k][keep]
    print(f"dropped {int((~keep).sum())} clips of single-group classes: {dropped}")

np.savez_compressed(a.dst, **d)
print("consonants:", len(set(d["consonant"])), sorted(str(c) for c in set(d["consonant"])))
print("vowels:", sorted(str(v) for v in set(d["vowel"])))
print("clips:", len(d["consonant"]))
