#!/usr/bin/env python3
"""Show the pitch track of one recording from the engine and from three Praat settings, side by side.

  python3 validation/f0_compare.py validation/manifest-svd-floor-70.json validation/out/svd-floor-70.jsonl 2390_a_n 1580_a_h

Ids may be given as any unique part of the id. If the engine says 163 Hz all the way through while Praat flips between
118 and 240, Praat is the one wobbling (and vice versa). Listen with `afplay` as the tie-break; this just tells you where to listen.
"""
import json, os, sys
import numpy as np
import parselmouth

man = {e["id"]: e for e in json.load(open(sys.argv[1]))}
res = {r["id"]: r for r in map(json.loads, open(sys.argv[2])) if "result" in r}
base = os.path.dirname(os.path.abspath(sys.argv[1]))
RANGE = {"child": (130, 700), "adult": (70, 450)}
for want in sys.argv[3:]:
    hits = [i for i in res if want in i]
    if len(hits) != 1: print(f"{want}: {len(hits)} matches {hits[:5]}"); continue
    i = hits[0]; e = man[i]; r = res[i]
    snd = parselmouth.Sound(os.path.join(base, e["file"]))
    crop = 0.0
    if not (e.get("noiseFile") or e.get("calibQuietest") or e.get("calibFloorDb") is not None):
        crop = e.get("calibSec", 0.8); snd = snd.extract_part(from_time=crop, preserve_times=False)
    lo, hi = RANGE[e.get("profile", "child")]
    tracks = {"praat-ac": snd.to_pitch_ac(0.01, lo, hi), "praat-cc": snd.to_pitch_cc(0.01, lo, hi), "praat-ac-wide": snd.to_pitch_ac(0.01, 50, 800)}
    cont = r["result"].get("contour") or []
    print(f"\n=== {i}   ({e.get('group')}, profile {e.get('profile')}, {snd.duration:.2f} s) ===")
    print(f"{'t s':>6} {'engine':>8} " + " ".join(f"{k:>14}" for k in tracks))
    cols = {"engine": []}; cols.update({k: [] for k in tracks})
    for c in cont:
        t = c["t"]; eng = c.get("f0")
        vals = {k: tr.get_value_at_time(t) for k, tr in tracks.items()}
        cols["engine"].append(np.nan if eng is None else eng)
        for k, v in vals.items(): cols[k].append(np.nan if v is None else v)
        if int(round(t * 20)) % 2 == 0:
            f = lambda v: "      -" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v:7.1f}"
            print(f"{t:6.2f} {f(eng):>8} " + " ".join(f"{f(v):>14}" for v in vals.values()))
    print("  median Hz / voiced share / 5th-95th pct:")
    for k, v in cols.items():
        a = np.array(v, float); ok = a[~np.isnan(a)]
        if len(ok): print(f"    {k:<14} {np.median(ok):7.1f}   {100*len(ok)/len(a):4.0f}%   {np.percentile(ok,5):6.1f} - {np.percentile(ok,95):6.1f}")
        else: print(f"    {k:<14} no voiced frames")
    print("  Reading it: tools agreeing with each other (3 Praat settings + engine) is strong evidence. A lone outlier is the suspect.")
