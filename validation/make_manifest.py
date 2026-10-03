#!/usr/bin/env python3
"""Build a manifest.json from a folder of recordings.

  # Saarbrücken Voice Database, after unzipping + converting .nsp -> .wav (see README)
  python3 validation/make_manifest.py --preset svd --root validation/data/svd --out validation/manifest-svd.json --limit-per-group 15

  # any other folder (e.g. NeuroVoz DDK clips)
  python3 validation/make_manifest.py --preset generic --glob "validation/data/neurovoz/**/*DDK*.wav" \
      --type syllable_train --syllable pa --profile adult --out validation/manifest-neurovoz.json

Paths in the manifest are stored relative to the manifest file. It prints what it matched and what it skipped,
so if a filename pattern is wrong you will see it immediately.
"""
import argparse, glob, json, os, random, re, sys

ap = argparse.ArgumentParser()
ap.add_argument("--preset", choices=["svd", "generic"], required=True)
ap.add_argument("--root"); ap.add_argument("--glob")
ap.add_argument("--out", required=True)
ap.add_argument("--profile", default="adult", choices=["adult", "child"])
ap.add_argument("--limit-per-group", type=int, default=0)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--group", help="generic: fixed group name (default: parent folder name)")
ap.add_argument("--type", default="sustained_voicing")
ap.add_argument("--syllable", default="ba"); ap.add_argument("--target", type=float, default=1.0)
ap.add_argument("--floor-db", type=float, help="declared room-noise level in dBFS RMS for the whole dataset (from inspect_clips.py); replaces the per-clip quietest-window guess")
ap.add_argument("--no-quietest", action="store_true", help="do NOT calibrate on the clip's quietest windows (use if clips have a silent lead-in: then set calibSec yourself)")
a = ap.parse_args()
base = os.path.dirname(os.path.abspath(a.out))
rel = lambda p: os.path.relpath(os.path.abspath(p), base)
entries, skipped = [], []

def level_for(kind):
    if kind == "sustained": return {"id": "sustained", "type": "sustained_voicing", "targetDurationSec": a.target}
    if kind == "glide":     return {"id": "glide", "type": "pitch_glide", "direction": "up", "minRangeSemitones": 4}
    if kind == "train":     return {"id": "ddk", "type": "syllable_train", "syllable": a.syllable, "durationSec": 10, "minSyllables": 5, "maxDurationSec": 14}
    if kind == "cv":        return {"id": "cv", "type": "cv_syllable", "syllable": a.syllable, "reps": 3}
    raise SystemExit(f"unknown level kind {kind}")

def add(i, path, group, level, **extra):
    e = {"id": i, "file": rel(path), "group": group, "device": extra.pop("device", None), "profile": a.profile,
         "level": level, "truth": {}}
    if a.floor_db is not None: e["calibFloorDb"] = a.floor_db
    elif not a.no_quietest: e["calibQuietest"] = True
    e.update(extra); entries.append(e)

if a.preset == "svd":
    if not a.root: sys.exit("--root required")
    pat = re.compile(r"(?P<spk>\d+)[-_](?P<v>[aiu])[_-](?P<p>lhl|n|h|l)(?![a-z])", re.I)
    for f in sorted(glob.glob(os.path.join(a.root, "**", "*.wav"), recursive=True) + glob.glob(os.path.join(a.root, "**", "*.WAV"), recursive=True)):
        name = os.path.basename(f)
        if "egg" in name.lower(): skipped.append((f, "EGG channel")); continue
        m = pat.search(name)
        if not m: skipped.append((f, "name did not match <speaker>-<vowel>_<n|h|l|lhl>")); continue
        top = os.path.relpath(f, a.root).split(os.sep)[0]
        group = "healthy" if top.lower().startswith("healthy") else f"pathological/{top}"
        kind = "glide" if m["p"].lower() == "lhl" else "sustained"
        add(f"{re.sub(r'[^A-Za-z0-9]+', '-', top)}_{m['spk']}_{m['v'].lower()}_{m['p'].lower()}", f, group, level_for(kind), device="clinic-studio")
else:
    if not a.glob: sys.exit("--glob required")
    kind = {"sustained_voicing": "sustained", "pitch_glide": "glide", "syllable_train": "train", "cv_syllable": "cv"}[a.type]
    for f in sorted(glob.glob(a.glob, recursive=True)):
        g = a.group or os.path.basename(os.path.dirname(f)) or "all"
        add(re.sub(r"[^A-Za-z0-9]+", "-", os.path.splitext(os.path.relpath(f))[0]).strip("-"), f, g, level_for(kind))

if a.limit_per_group:
    rng = random.Random(a.seed); by = {}
    for e in entries: by.setdefault((e["group"], e["level"]["id"]), []).append(e)
    entries = [e for v in by.values() for e in rng.sample(v, min(len(v), a.limit_per_group))]
    entries.sort(key=lambda e: e["id"])

json.dump(entries, open(a.out, "w"), indent=2)
from collections import Counter
print(f"{len(entries)} recordings -> {a.out}")
for (g, l), n in sorted(Counter((e['group'], e['level']['id']) for e in entries).items()): print(f"  {g:<40} {l:<10} {n}")
if skipped:
    print(f"skipped {len(skipped)}; first few:")
    for f, why in skipped[:6]: print(f"  {f}  ({why})")
if not entries: sys.exit("No recordings matched. Check --root/--glob and that .nsp files were converted to .wav.")
