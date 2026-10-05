#!/usr/bin/env python3
"""Combine several heads (different hidden layers + the browser-sized CTC features) and see if it beats the best one.

  python training/ensemble.py training/feats_big_plain.npz
  python training/ensemble.py training/feats_big_plain.npz --sets "hidden layer 8" "hidden layer 16" "post (browser-sized)"
  python training/ensemble.py --train training/feats_big_plain.npz --test training/feats_say.npz     # other-engine test

Each feature set gets its own logistic head (same settings as train.py); the ensemble averages their probabilities.
Reports, per set and for the ensemble:
  consonant / vowel / syllable top-1     (same as train.py)
  consonant top-3                        (the right answer is among the three most likely)
  consonant pairwise                     (how often the true class scores higher than a given wrong class; 50% = coin flip).
                                         This is the number that matters for a game that already knows the target syllable.
Evaluation is the same as train.py: one voice group held out at a time. Not a substitute for real recordings.
"""
import argparse
import sys

import numpy as np

import train

DEFAULT_SETS = ['hidden layer 8', 'hidden layer 12', 'hidden layer 16', 'post (browser-sized)']


def proba(Xtr, ytr, Xte, classes, C):
    """Probabilities over the global class list; classes absent from the training fold get 0."""
    cidx = {c: i for i, c in enumerate(classes)}
    P = np.zeros((len(Xte), len(classes)))
    if len(set(ytr)) < 2:
        P[:, cidx[ytr[0]]] = 1.0
        return P
    sc, m = train.fit(Xtr, ytr, C)
    P[:, [cidx[c] for c in m.classes_]] = m.predict_proba(sc.transform(Xte))
    return P


def oof(X, y, folds, classes, C):
    P = np.zeros((len(X), len(classes)))
    for tr, te in folds:
        P[te] = proba(X[tr], y[tr], X[te], classes, C)
    return P


def top1(P, y, classes):
    return np.array(classes)[P.argmax(1)] == y


def topk(P, y, classes, k=3):
    cidx = {c: i for i, c in enumerate(classes)}
    t = np.array([cidx[c] for c in y])
    return (np.argsort(-P, 1)[:, :k] == t[:, None]).any(1)


def pairwise(P, y, classes):
    cidx = {c: i for i, c in enumerate(classes)}
    t = np.array([cidx[c] for c in y])
    true_p = P[np.arange(len(y)), t][:, None]
    beats = (true_p > P).sum(1) + 0.5 * ((true_p == P).sum(1) - 1)
    return float((beats / (P.shape[1] - 1)).mean())


def report(name, Pc, Pv, cons, vow, cc, vc, extra=True):
    ok_c, ok_v = top1(Pc, cons, cc), top1(Pv, vow, vc)
    line = f'{name:<28}{ok_c.mean():>10.1%}{ok_v.mean():>8.1%}{(ok_c & ok_v).mean():>10.1%}'
    if extra:
        line += f'{topk(Pc, cons, cc).mean():>10.1%}{pairwise(Pc, cons, cc):>11.1%}'
    print(line)


HEADER = f'{"features":<28}{"consonant":>10}{"vowel":>8}{"syllable":>10}{"cons top3":>10}{"cons pair":>11}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('feats', nargs='?')
    ap.add_argument('--train'); ap.add_argument('--test')
    ap.add_argument('--sets', nargs='+', default=DEFAULT_SETS)
    ap.add_argument('--C', type=float, default=0.1)
    a = ap.parse_args()

    if a.train and a.test:
        tr, te = np.load(a.train, allow_pickle=True), np.load(a.test, allow_pickle=True)
        if tr['post'].shape[1:] != te['post'].shape[1:] or list(tr['layers']) != list(te['layers']):
            sys.exit('The two feature files were made with different models/settings.')
        ftr, fte = train.feature_sets(tr), train.feature_sets(te)
        ctr, vtr = tr['consonant'].astype(str), tr['vowel'].astype(str)
        cons, vow = te['consonant'].astype(str), te['vowel'].astype(str)
        cc, vc = sorted(set(ctr)), sorted(set(vtr))
        unseen = (set(cons) - set(cc)) | (set(vow) - set(vc))
        if unseen: print(f'note: test has sounds the training set never saw: {sorted(unseen)} (they count as wrong)')
        # test clips of classes the model can't know would crash the lookups below, so drop them from scoring
        keep = np.array([c in set(cc) and v in set(vc) for c, v in zip(cons, vow)])
        cons, vow = cons[keep], vow[keep]
        print(f'train {len(ctr)} clips, test {int(keep.sum())} clips\n{HEADER}')
        Pcs, Pvs = [], []
        for name in a.sets:
            Pc = proba(ftr[name], ctr, fte[name][keep], cc, a.C); Pv = proba(ftr[name], vtr, fte[name][keep], vc, a.C)
            Pcs.append(Pc); Pvs.append(Pv); report(name, Pc, Pv, cons, vow, cc, vc)
        report('ENSEMBLE (average)', np.mean(Pcs, 0), np.mean(Pvs, 0), cons, vow, cc, vc)
        return

    if not a.feats: ap.error('give a features file, or --train and --test')
    d = np.load(a.feats, allow_pickle=True)
    cons, vow, spk = d['consonant'].astype(str), d['vowel'].astype(str), d['speaker'].astype(str)
    mode, folds = train.splits(d['syllable'], spk)
    cc, vc = sorted(set(cons)), sorted(set(vow))
    sets = train.feature_sets(d)
    missing = [s for s in a.sets if s not in sets]
    if missing: sys.exit(f'unknown feature sets {missing}; available: {list(sets)}')
    print(f'{len(cons)} clips, {len(set(spk))} voice groups, {mode}\n{HEADER}')
    Pcs, Pvs = [], []
    for name in a.sets:
        Pc, Pv = oof(sets[name], cons, folds, cc, a.C), oof(sets[name], vow, folds, vc, a.C)
        Pcs.append(Pc); Pvs.append(Pv); report(name, Pc, Pv, cons, vow, cc, vc)
    report('ENSEMBLE (average)', np.mean(Pcs, 0), np.mean(Pvs, 0), cons, vow, cc, vc)


if __name__ == '__main__':
    main()
