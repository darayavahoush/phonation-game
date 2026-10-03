#!/usr/bin/env python3
"""Play recordings and type the human answer into the manifest's `truth`.

  python3 validation/label.py validation/manifest-neurovoz.json --field count --sample 20
  python3 validation/label.py validation/manifest-mine.json --field passed
  python3 validation/label.py MANIFEST --field count --units-per 3     # you count pa-ta-ka triplets; stored count = 3 x what you type

Keys at the prompt: a number (or y/n for `passed`), r = replay, s = skip, q = save and quit.
Label BEFORE you look at engine results, or you will be biased. Uses macOS `afplay` (falls back to `ffplay`).
"""
import argparse, json, os, random, shutil, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("manifest"); ap.add_argument("--field", default="count", choices=["count", "passed", "mptSec"])
ap.add_argument("--sample", type=int, default=0); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--units-per", type=int, default=1)
a = ap.parse_args()
base = os.path.dirname(os.path.abspath(a.manifest))
man = json.load(open(a.manifest))
todo = [e for e in man if a.field not in e.setdefault("truth", {})]
if a.sample: todo = random.Random(a.seed).sample(todo, min(a.sample, len(todo)))
player = ["afplay"] if shutil.which("afplay") else (["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"] if shutil.which("ffplay") else None)
if not player: print("No audio player found (afplay/ffplay). Paths will be printed instead.")
def save(): json.dump(man, open(a.manifest + ".tmp", "w"), indent=2); os.replace(a.manifest + ".tmp", a.manifest)
done = 0
for k, e in enumerate(todo, 1):
    path = os.path.join(base, e["file"])
    while True:
        if player: subprocess.run(player + [path])
        else: print("  file:", path)
        ans = input(f"[{k}/{len(todo)}] {e['id']}  {a.field}? ").strip().lower()
        if ans == "r": continue
        if ans == "s": break
        if ans == "q": save(); print(f"saved; labelled {done}"); sys.exit()
        try:
            if a.field == "passed": v = {"y": True, "n": False}[ans]
            elif a.field == "count": v = int(ans) * a.units_per
            else: v = float(ans)
        except (KeyError, ValueError): print("  type a number (y/n for passed), r, s or q"); continue
        e["truth"][a.field] = v; done += 1; save(); break
save(); print(f"saved; labelled {done}")
