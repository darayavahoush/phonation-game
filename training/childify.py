import argparse, csv, os, sys
from fractions import Fraction
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--factors", default="1.25,1.5")
ap.add_argument("--all", action="store_true", help="also shift the augmented takes, not just _00")
a = ap.parse_args()

rows = list(csv.DictReader(open(os.path.join(a.src, "manifest.csv"), encoding="utf-8")))
if not rows:
    sys.exit("empty manifest")
need = {"file", "speaker", "voice"}
if not need <= set(rows[0]):
    sys.exit(f"manifest columns are {list(rows[0])}; expected at least {sorted(need)}")


def locate(v):
    for rel in (v, os.path.join("clips", v), os.path.join("clips", os.path.basename(v))):
        if os.path.isfile(os.path.join(a.src, rel)):
            return rel
    return None


out_rows, made = [], 0
for f in [float(x) for x in a.factors.split(",")]:
    tag = "c" + str(int(round(f * 100)))
    fr = Fraction(f).limit_denominator(100)
    for r in rows:
        rel = locate(r["file"])
        base, ext = os.path.splitext(os.path.basename(r["file"]))
        if rel is None:
            sys.exit(f"cannot find clip for manifest entry {r['file']!r}")
        if not a.all and not base.endswith("_00"):
            continue
        sr, x = wavfile.read(os.path.join(a.src, rel))
        x = x.astype(np.float32)
        y = resample_poly(x, fr.denominator, fr.numerator)
        y = np.clip(y, -32768, 32767).astype(np.int16)
        nb = f"{base}_{tag}{ext}"
        newrel = os.path.join(os.path.dirname(rel), nb)
        os.makedirs(os.path.join(a.dst, os.path.dirname(newrel)), exist_ok=True)
        wavfile.write(os.path.join(a.dst, newrel), sr, y)
        n = dict(r)
        n["file"] = os.path.join(os.path.dirname(r["file"]), nb)
        n["voice"] = r["voice"] + "-" + tag
        out_rows.append(n)
        made += 1
with open(os.path.join(a.dst, "manifest.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(out_rows)
print(f"wrote {made} clips to {a.dst}")
