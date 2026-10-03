#!/usr/bin/env python3
"""Compare PhonationAnalyzer output with (a) a reference tool (Praat) and (b) human labels.

  python3 validation/compare.py validation/manifest.json validation/out/clean.jsonl
  python3 validation/compare.py MANIFEST CLEAN.jsonl --vs validation/out/snr10.jsonl     # how much does noise change results?
  python3 validation/compare.py MANIFEST CLEAN.jsonl --tune mptSec                        # data-driven pass threshold for one metric

Ground truth is whatever you put in manifest "truth": passed, count, mptSec, f0MeanHz, rangeSemitones.
Praat is only a second opinion (a different algorithm), never the truth. Human labels win where present.
"""
import argparse, json, math, os, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("manifest"); ap.add_argument("results")
ap.add_argument("--vs", help="second results file (e.g. noise-mixed run) to measure drift against")
ap.add_argument("--tune", help="engine metric to pick a pass threshold for, against truth.passed")
ap.add_argument("--no-praat", action="store_true")
a = ap.parse_args()

base = os.path.dirname(os.path.abspath(a.manifest))
man = {e["id"]: e for e in json.load(open(a.manifest))}
def load(p): return {r["id"]: r for r in map(json.loads, open(p)) if "result" in r}
res = load(a.results)
rows = [(man[i], r) for i, r in res.items() if i in man]
print(f"{len(rows)} recordings joined (manifest {len(man)}, results {len(res)})\n")

PROFILE_F0 = {"child": (130, 700), "adult": (70, 450)}   # same ranges the engine uses, for a fair Praat comparison

# ---------------------------------------------------------------- Praat reference
def praat_ref(e, r):
    import parselmouth
    from parselmouth.praat import call
    snd = parselmouth.Sound(os.path.join(base, e["file"]))
    calib = e.get("calibSec", 0 if e.get("noiseFile") else 0.8)
    if not e.get("noiseFile") and calib: snd = snd.extract_part(from_time=calib, preserve_times=False)
    lo, hi = PROFILE_F0[e.get("profile", "child")]
    pit = snd.to_pitch_ac(time_step=0.005, pitch_floor=lo, pitch_ceiling=hi, very_accurate=False)
    f0 = pit.selected_array["frequency"]; voiced = f0 > 0
    hop = 0.005
    # bridge unvoiced gaps shorter than 60 ms, like the engine documents, then longest run
    v = voiced.copy(); i = 0
    while i < len(v):
        if not v[i]:
            j = i
            while j < len(v) and not v[j]: j += 1
            if 0 < i and j < len(v) and (j - i) * hop < 0.06: v[i:j] = True
            i = j
        else: i += 1
    best = cur = 0
    for x in v:
        cur = cur + 1 if x else 0; best = max(best, cur)
    out = {"mptSec": best * hop}
    if voiced.sum() >= 3:
        st = 12 * np.log2(f0[voiced] / np.median(f0[voiced]))
        out.update(f0MeanHz=float(np.mean(f0[voiced])), f0SdSemitones=float(np.std(st, ddof=1)),
                   rangeSemitones=float(np.percentile(st, 95) - np.percentile(st, 5)))
    return out

# ---------------------------------------------------------------- stats helpers
def agree(name, x, y, tol=None, unit=""):
    x, y = np.array(x, float), np.array(y, float)
    m = ~(np.isnan(x) | np.isnan(y)); x, y = x[m], y[m]
    if len(x) < 3: print(f"  {name:<22} n={len(x)} (too few)"); return
    d = x - y; sd = d.std(ddof=1)
    r = np.corrcoef(x, y)[0, 1] if x.std() > 0 and y.std() > 0 else float("nan")
    s = f"  {name:<22} n={len(x):<3} r={r:5.2f}  bias={d.mean():+.2f}{unit}  LoA=[{d.mean()-1.96*sd:+.2f},{d.mean()+1.96*sd:+.2f}]  MAE={np.abs(d).mean():.2f}"
    if tol is not None: s += f"  within±{tol}: {100*np.mean(np.abs(d) <= tol):.0f}%"
    print(s)

def conf(truth, pred):
    t, p = np.array(truth, bool), np.array(pred, bool)
    tp, fp, fn, tn = (t & p).sum(), (~t & p).sum(), (t & ~p).sum(), (~t & ~p).sum(); n = len(t)
    acc = (tp + tn) / n; pe = ((tp + fn) * (tp + fp) + (fp + tn) * (fn + tn)) / n**2
    kap = (acc - pe) / (1 - pe) if pe < 1 else float("nan")
    sens = tp / (tp + fn) if tp + fn else float("nan"); spec = tn / (tn + fp) if tn + fp else float("nan")
    return dict(n=n, acc=acc, sens=sens, spec=spec, kappa=kap, tp=tp, fp=fp, fn=fn, tn=tn)

def show_conf(label, c):
    print(f"  {label:<28} n={c['n']:<3} agreement={100*c['acc']:.0f}%  kappa={c['kappa']:.2f}  "
          f"engine-pass vs human-pass: sensitivity={100*c['sens']:.0f}% specificity={100*c['spec']:.0f}%  (TP{c['tp']} FP{c['fp']} FN{c['fn']} TN{c['tn']})")

def metric(r, k): return r["result"]["metrics"].get(k)
def nan(v): return float("nan") if v is None else v

# ---------------------------------------------------------------- 1. reference-tool agreement
print("== 1. Engine vs Praat (second opinion) and vs human labels ==")
praat = {}
if not a.no_praat:
    try:
        for e, r in rows: praat[e["id"]] = praat_ref(e, r)
    except ImportError: print("  (praat-parselmouth not installed: pip install praat-parselmouth)  skipping Praat")
for key, tol, unit in [("mptSec", 0.25, "s"), ("f0MeanHz", None, "Hz"), ("f0SdSemitones", 0.3, "st"), ("rangeSemitones", 1.0, "st")]:
    eng = [nan(metric(r, key)) for e, r in rows]
    if praat and not all(math.isnan(v) for v in eng):
        agree(f"{key} vs Praat", eng, [praat[e["id"]].get(key, float("nan")) for e, r in rows], tol, unit)
    truth = [e.get("truth", {}).get(key, float("nan")) for e, r in rows]
    if not all(math.isnan(v) for v in truth): agree(f"{key} vs human", eng, truth, tol, unit)
cnt_t = [(metric(r, "syllableCount"), e["truth"]["count"]) for e, r in rows if "count" in e.get("truth", {}) and metric(r, "syllableCount") is not None]
if cnt_t:
    d = np.array([p - t for p, t in cnt_t]); print(f"  syllable count vs human  n={len(d)}  exact={100*np.mean(d==0):.0f}%  within±1={100*np.mean(abs(d)<=1):.0f}%  bias={d.mean():+.2f}  MAE={np.abs(d).mean():.2f}  (over-count {np.sum(d>0)}, under-count {np.sum(d<0)})")

# ---------------------------------------------------------------- 2. pass/fail + quality gate
print("\n== 2. Pass/fail against human 'passed' labels, and does the quality gate help? ==")
lab = [(e, r) for e, r in rows if "passed" in e.get("truth", {})]
if lab:
    show_conf("all recordings", conf([e["truth"]["passed"] for e, r in lab], [r["result"]["passed"] for e, r in lab]))
    rel = [(e, r) for e, r in lab if r["result"]["quality"]["reliable"]]
    if rel and len(rel) < len(lab):
        show_conf("only quality.reliable", conf([e["truth"]["passed"] for e, r in rel], [r["result"]["passed"] for e, r in rel]))
        print(f"  gate rejected {len(lab)-len(rel)}/{len(lab)} recordings ({100*(len(lab)-len(rel))/len(lab):.0f}%). If rejected ones are mostly the bad recordings, the gate is doing its job.")
    groups = sorted({e.get("group") for e, r in lab if e.get("group")})
    if len(groups) > 1:
        print("  by group:")
        for g in groups:
            sub = [(e, r) for e, r in lab if e.get("group") == g]
            show_conf(f"    {g}", conf([e["truth"]["passed"] for e, r in sub], [r["result"]["passed"] for e, r in sub]))
    devs = sorted({e.get("device") for e, r in lab if e.get("device")})
    if len(devs) > 1:
        print("  by device (gate rate + agreement):")
        for dv in devs:
            sub = [(e, r) for e, r in lab if e.get("device") == dv]
            u = sum(not r["result"]["quality"]["reliable"] for e, r in sub)
            show_conf(f"    {dv} ({u} unreliable)", conf([e["truth"]["passed"] for e, r in sub], [r["result"]["passed"] for e, r in sub]))
else: print("  no truth.passed labels in the manifest")
flags = {}
for e, r in rows:
    for f in r["result"]["quality"]["flags"]: flags[f] = flags.get(f, 0) + 1
print("  quality flags raised:", flags or "none")

# ---------------------------------------------------------------- 3. robustness
if a.vs:
    print(f"\n== 3. Drift under noise ({a.vs}) ==")
    other = load(a.vs); both = [(i, res[i], other[i]) for i in res if i in other]
    flips = sum(r1["result"]["passed"] != r2["result"]["passed"] for _, r1, r2 in both)
    unrel = sum(r1["result"]["quality"]["reliable"] and not r2["result"]["quality"]["reliable"] for _, r1, r2 in both)
    print(f"  {len(both)} paired; pass/fail changed in {flips}; newly flagged unreliable: {unrel}")
    for key, unit in [("mptSec", "s"), ("f0MeanHz", "Hz"), ("syllableCount", ""), ("rangeSemitones", "st")]:
        x = [nan(r1["result"]["metrics"].get(key)) for _, r1, _ in both]; y = [nan(r2["result"]["metrics"].get(key)) for _, _, r2 in both]
        if not all(math.isnan(v) for v in x): agree(f"{key} clean vs noisy", y, x, None, unit)
    wrong = [i for i, r1, r2 in both if r1["result"]["passed"] != r2["result"]["passed"] and r2["result"]["quality"]["reliable"]]
    if wrong: print(f"  !! flipped while still marked reliable (gate missed them): {wrong[:10]}")

# ---------------------------------------------------------------- 4. tuning a pass threshold
if a.tune:
    print(f"\n== 4. Threshold for '{a.tune}' vs human pass/fail (5-fold cross-validated) ==")
    pts = [(metric(r, a.tune), bool(e["truth"]["passed"])) for e, r in lab if metric(r, a.tune) is not None]
    if len(pts) < 20: print(f"  only {len(pts)} labelled points; a threshold fitted on this few will not generalise. Collect more first.")
    if len(pts) >= 6:
        v = np.array([p[0] for p in pts]); t = np.array([p[1] for p in pts])
        def best(vv, tt):
            cands = np.unique(vv); bj, bt = -2, None
            for c in cands:
                p = vv >= c; sens = (p & tt).sum() / max(1, tt.sum()); spec = (~p & ~tt).sum() / max(1, (~tt).sum())
                if sens + spec - 1 > bj: bj, bt = sens + spec - 1, c
            return bt, bj
        thr, j = best(v, t); p = v >= thr
        print(f"  best in-sample threshold: {a.tune} >= {thr:.3g}  (Youden J={j:.2f}; sens={100*(p&t).sum()/max(1,t.sum()):.0f}% spec={100*(~p&~t).sum()/max(1,(~t).sum()):.0f}%)")
        rng = np.random.default_rng(0); idx = rng.permutation(len(v)); folds = np.array_split(idx, 5); ok = 0
        for f in folds:
            tr = np.setdiff1d(idx, f); th, _ = best(v[tr], t[tr]); ok += ((v[f] >= th) == t[f]).sum()
        print(f"  cross-validated accuracy: {100*ok/len(v):.0f}%   (compare with {100*max(t.mean(), 1-t.mean()):.0f}% from always guessing the majority)")
        print("  Tip: tune per population (e.g. child vs adult) and never on the recordings you will report results on.")
