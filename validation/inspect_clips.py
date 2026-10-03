#!/usr/bin/env python3
"""How much silence do these recordings really contain, and what room-noise level do they imply?

  python3 validation/inspect_clips.py validation/manifest-svd.json [--all]

Prints, per clip, window levels in dBFS (20 ms RMS windows): quietest 1%, median, loudest 5%, plus the gap between them.
If the quiet-to-loud gap is small (< ~30 dB) the clip has no real silence, so any "noise floor" taken from it is the VOICE, not the room.
It then suggests a dataset-level floor: the 10th percentile of the per-clip quietest levels, which comes from the clips that DO have silence.
Use it only for a set recorded in one room/setup (like the Saarbrücken studio recordings). Check the table before trusting the suggestion.
"""
import json, os, sys
import numpy as np
import parselmouth

man = json.load(open(sys.argv[1])); base = os.path.dirname(os.path.abspath(sys.argv[1])); show_all = "--all" in sys.argv
rows = []
for e in man:
    snd = parselmouth.Sound(os.path.join(base, e["file"]))
    x = snd.values.mean(axis=0); fs = snd.sampling_frequency; w = max(1, int(0.02 * fs))
    n = len(x) // w
    if n < 5: continue
    rms = np.sqrt((x[: n * w].reshape(n, w) ** 2).mean(axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-6))             # clamp at -120 dBFS so digital silence cannot dominate
    nz = db[db > -119] if (db > -119).sum() > 3 else db   # ignore exact digital zeros when estimating the quiet end
    q1, med, p95 = np.percentile(nz, 1), np.median(nz), np.percentile(db, 95)
    rows.append((e["id"], e.get("group", ""), len(x) / fs, 20 * np.log10(max(np.abs(x).max(), 1e-6)), q1, med, p95, p95 - q1, float((db <= -119).mean())))
if not rows: sys.exit("no readable clips")
print(f"{'clip':<34}{'dur s':>6}{'peak':>7}{'quiet1%':>9}{'median':>8}{'loud95%':>9}{'gap dB':>8}{'digital0':>9}")
for r in (rows if show_all else rows[:12]):
    print(f"{r[0][:33]:<34}{r[2]:>6.2f}{r[3]:>7.1f}{r[4]:>9.1f}{r[5]:>8.1f}{r[6]:>9.1f}{r[7]:>8.1f}{100*r[8]:>8.0f}%")
if not show_all and len(rows) > 12: print(f"  ... {len(rows)-12} more (use --all)")
gap = np.array([r[7] for r in rows]); q = np.array([r[4] for r in rows])
print(f"\n{len(rows)} clips. quiet-to-loud gap: median {np.median(gap):.0f} dB, min {gap.min():.0f}, max {gap.max():.0f}")
print(f"clips with gap < 30 dB (effectively no silence): {int((gap < 30).sum())}/{len(rows)}")
print(f"per-clip quietest level: median {np.median(q):.1f} dBFS, 10th pct {np.percentile(q,10):.1f}, min {q.min():.1f}")
print(f"digital-zero padding present in {int(sum(r[8] > 0.05 for r in rows))} clips (exact-zero silence, not real room noise)")
nosil = int((gap < 30).sum())
if nosil > len(rows) / 2:
    print(f"\nMost clips ({nosil}/{len(rows)}) contain no usable silence: a room-noise floor CANNOT be measured from these files.")
    print("Any number derived from the clip levels (e.g. 'quietest 10th percentile') would be the VOICE, not the room. Do not use one.")
    print("What to do instead: declare an assumed floor and prove the results do not depend on it:")
    print("    bash validation/floor_sweep.sh svd validation/data/svd 20 -70 -60 -50")
    print("If results barely change across those floors, the assumption is harmless. These clips then validate F0/voicing, NOT noise handling.")
else:
    rec = float(np.percentile(q, 10))
    print(f"\nSuggested dataset floor: {rec:.0f} dBFS  ->  python3 validation/make_manifest.py ... --floor-db {rec:.0f}")
    if rec < -85: print("That floor is very low: digital-zero padding or a noise-gated recording. Treat with suspicion; a real room is rarely below -80 dBFS.")
