#!/usr/bin/env python3
"""Checks that train.py's split / fit / evaluate / export plumbing works, on SYNTHETIC features.
It says nothing about how well real speech will do. Run: python3 training/selftest.py"""
import json, os, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import train

rng = np.random.default_rng(0)
cons = ['b', 'p', 'd', 't', 'g', 'k']; vows = ['a', 'i']
V, H, L = 60, 32, 2
rows = []
for spk in ['s01', 's02', 's03']:
    for c in cons:
        for v in vows:
            for _ in range(5): rows.append((spk, c, v))
N = len(rows)
cid = {c: i for i, c in enumerate(cons)}; vid = {v: i for i, v in enumerate(vows)}
post = rng.random((N, 3, V)).astype(np.float32) * 0.2
hid = rng.normal(size=(N, L, 3, H)).astype(np.float32)
for n, (s, c, v) in enumerate(rows):
    post[n, 0, cid[c]] += 2.0; post[n, 2, 10 + vid[v]] += 2.0      # consonant evidence early, vowel late
    hid[n, :, 0, cid[c]] += 8; hid[n, :, 2, 10 + vid[v]] += 8
greedy = [f"{c} {v}" for _, c, v in rows]
tmp = os.path.join(tempfile.mkdtemp(), 'f.npz')
np.savez(tmp, hid=hid, post=post, greedy=np.array(greedy), layers=np.array([8, 12]), syllable=np.array([c + v for _, c, v in rows]),
         consonant=np.array([c for _, c, _ in rows]), vowel=np.array([v for _, _, v in rows]), speaker=np.array([s for s, _, _ in rows]))
out = os.path.join(os.path.dirname(tmp), 'head.json')
res = train.run(tmp, export=out, quiet=True)
assert res['baseline'][2] == 1.0, res['baseline']                       # baseline reads the greedy string
assert res['post (browser-sized)'][2] > 0.8, res                         # learnable by construction
assert res['hidden layer 8'][2] > 0.8, res
h = json.load(open(out)); assert h['consonant']['classes'] == sorted(cons) and len(h['consonant']['coef'][0]) == 3 * V
# one speaker -> falls back to by-take folds
one = dict(np.load(tmp)); keep = one['speaker'] == 's01'
np.savez(tmp, **{k: (v[keep] if getattr(v, 'shape', None) and len(v) == N else v) for k, v in one.items()})
r1 = train.run(tmp, quiet=True); assert r1['post (browser-sized)'][2] > 0.3  # 48 training clips: low but far above chance (0.08)
# transfer: train on "tts" speakers, test on a differently shifted "real" speaker; and a label-shuffled control
d = dict(np.load(tmp)); n = len(d['syllable'])
tts, real = os.path.join(os.path.dirname(tmp), 'tts.npz'), os.path.join(os.path.dirname(tmp), 'real.npz')
np.savez(tts, **d); d2 = dict(d); d2['post'] = d['post'] + rng.normal(0, 0.05, d['post'].shape).astype(np.float32); np.savez(real, **d2)
tr = train.transfer(tts, real); assert tr['post (browser-sized)'][2] > 0.3, tr
d3 = dict(d2); d3['consonant'] = rng.permutation(d2['consonant']); np.savez(real, **d3)
ctl = train.transfer(tts, real); assert ctl['post (browser-sized)'][0] < 0.45, ctl           # shuffled labels must not score well
print('selftest OK')
