#!/usr/bin/env python3
"""Where does the consonant head go wrong, and is the number fair?

  python training/confusions.py training/feats_big_game.npz --layer 8
  python training/confusions.py training/feats_big_game.npz --layer 8 --classes th dh z f

Uses the same held-out evaluation as train.py (one voice group held out at a time) and prints:
  * consonant accuracy on all clips, and on clips whose class appears in 2+ voice groups. A class that exists in only
    one group (z and f in the big set) can never be learned when that group is held out, so it scores 0% by construction.
  * per class: clips, groups it appears in, accuracy, and the three most common wrong answers.
  * with --classes, the full list of what those classes were heard as.
Note the "speaker" column is really a voice (a language/accent), so this measures new-voice AND new-language transfer.
"""
import argparse
import sys
from collections import Counter

import numpy as np

import train


def wrong_answers(pred, true, label, k):
    c = Counter(pred[true == label][pred[true == label] != label])
    n = (true == label).sum()
    return ', '.join(f'{p} {v / n:.0%}' for p, v in c.most_common(k))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('feats')
    ap.add_argument('--layer', type=int, default=8)
    ap.add_argument('--C', type=float, default=0.1)
    ap.add_argument('--classes', nargs='*', default=[])
    ap.add_argument('--worst', type=int, default=15, help='how many of the lowest-scoring classes to list')
    a = ap.parse_args()

    d = np.load(a.feats, allow_pickle=True)
    cons, vow = d['consonant'].astype(str), d['vowel'].astype(str)
    spk = d['speaker'].astype(str)
    sets = train.feature_sets(d)
    name = f'hidden layer {a.layer}'
    if name not in sets:
        sys.exit(f'no {name}; available: {[k for k in sets if k.startswith("hidden")]}')
    mode, folds = train.splits(d['syllable'], spk)
    print(f'{len(cons)} clips, {len(set(spk))} voice groups, {name}, {mode}\n')
    pc, _ = train.evaluate(sets[name], cons, vow, folds, a.C)

    groups = {c: len(set(spk[cons == c])) for c in set(cons)}
    learnable = np.array([groups[c] >= 2 for c in cons])
    ok = pc == cons
    print(f'consonant accuracy, all clips:                       {ok.mean():.1%}  (n={len(ok)})')
    print(f'consonant accuracy, classes in 2+ groups only:       {ok[learnable].mean():.1%}  (n={learnable.sum()})')
    single = sorted(str(c) for c in groups if groups[c] < 2)
    if single:
        print(f'classes in only one group (score 0% by construction): {single}')

    rows = []
    for c in sorted(set(cons)):
        m = cons == c
        rows.append((ok[m].mean(), c, m.sum(), groups[c]))
    print(f'\n{a.worst} lowest classes (accuracy, class, clips, groups, most common wrong answers):')
    for acc, c, n, g in sorted(rows)[:a.worst]:
        print(f'  {acc:>4.0%}  {c:<5} n={n:<4} groups={g}  heard as: {wrong_answers(pc, cons, c, 3) or "-"}')

    for c in a.classes:
        m = cons == c
        if not m.any():
            print(f'\n{c}: not in this file')
            continue
        counts = Counter(pc[m])
        print(f'\n{c}: {m.sum()} clips from {groups[c]} group(s); heard as ->')
        for p, v in counts.most_common(8):
            print(f'  {p:<5} {v / m.sum():.0%}')
        per_group = {g: (ok[m & (spk == g)].mean(), (m & (spk == g)).sum()) for g in sorted(set(spk[m]))}
        print('  by held-out group: ' + ', '.join(f'{g} {acc:.0%} (n={n})' for g, (acc, n) in per_group.items()))


if __name__ == '__main__':
    main()
