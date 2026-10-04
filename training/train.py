#!/usr/bin/env python3
"""Train and compare small classifiers on the features from features.py. Runs in seconds on a laptop.

  python3 training/train.py training/feats.npz
  python3 training/train.py training/feats.npz --export training/head.json   # also save the browser-sized head
  python3 training/train.py --train training/feats_tts.npz --test training/feats_real.npz   # train on TTS, test on real voices

Two heads, one for the starting consonant and one for the vowel, so a sound you recorded in a few
syllables still helps the others. A syllable counts as right only if BOTH heads are right.

Honest evaluation: with 2+ speakers it holds out one whole speaker at a time (the real test: a new voice).
With one speaker it can only split by take, which is optimistic because the voice and session are the same.
"""
import argparse, json, re, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneGroupOut, StratifiedKFold
from sklearn.preprocessing import StandardScaler

# What the plain model's greedy output would have to contain for the baseline to count as right (same tolerant
# variants the lab accepts: retroflex t/d, Indian-English sh/ch/j, tone digits and length marks ignored).
CONS = {'b': ['b'], 'p': ['p'], 'd': ['d', 'ɖ'], 't': ['t', 'ʈ'], 'g': ['ɡ', 'g'], 'k': ['k'], 'm': ['m'], 'n': ['n', 'ɳ'],
        'f': ['f'], 'v': ['v', 'ʋ'], 's': ['s'], 'z': ['z'], 'sh': ['ʃ', 's.', 'ɕ', 'ʂ'], 'zh': ['ʒ', 'ʑ', 'ʐ'], 'th': ['θ'],
        'dh': ['ð'], 'ch': ['tʃ', 'tɕ', 'ʧ'], 'j': ['dʒ', 'dʑ', 'ʤ'], 'h': ['h', 'ɦ'], 'l': ['l', 'ɭ'], 'r': ['r', 'ɾ', 'ɹ'],
        'y': ['j'], 'w': ['w']}
VOW = {'a': ['a', 'ɑ', 'ɐ', 'æ'], 'e': ['e', 'ɛ'], 'i': ['i', 'ɪ'], 'o': ['o', 'ɔ'], 'u': ['u', 'ʊ']}
PAIRS = [('p', 'b'), ('t', 'd'), ('k', 'g'), ('s', 'z'), ('f', 'v'), ('sh', 'zh'), ('th', 'dh'), ('ch', 'j')]


def clean(tok): return re.sub(r'[0-9ː˞ʰʲʷ]', '', tok)


def baseline(greedy, cons, vowel):
    toks = [clean(t) for t in greedy.split()]
    if not toks: return False, False
    vowels = {v for vs in VOW.values() for v in vs}
    first_v = next((t for t in toks if t in vowels), None)
    return toks[0] in CONS.get(cons, []), first_v in VOW.get(vowel, [])


def feature_sets(d):
    sets = {'post (browser-sized)': d['post'].reshape(len(d['post']), -1).astype(np.float32)}
    for i, l in enumerate(d['layers']):
        sets[f'hidden layer {int(l)}'] = d['hid'][:, i].reshape(len(d['hid']), -1).astype(np.float32)
    return sets


def splits(y_syl, speakers):
    if len(set(speakers)) >= 2:
        return 'leave-one-speaker-out', list(LeaveOneGroupOut().split(y_syl, y_syl, speakers))
    n = min(5, min(np.unique(y_syl, return_counts=True)[1]))
    if n < 2: sys.exit('Need at least 2 clips of every syllable (or 2+ speakers) to evaluate.')
    return f'{n}-fold by take (ONE speaker: optimistic)', list(StratifiedKFold(n, shuffle=True, random_state=0).split(y_syl, y_syl))


def fit(X, y, C):
    sc = StandardScaler().fit(X)
    return sc, LogisticRegression(C=C, max_iter=3000).fit(sc.transform(X), y)


def evaluate(X, cons, vow, folds, C):
    pc, pv = np.empty(len(X), dtype=object), np.empty(len(X), dtype=object)
    for tr, te in folds:
        for y, out in ((cons, pc), (vow, pv)):
            if len(set(y[tr])) < 2: out[te] = y[tr][0]; continue
            sc, m = fit(X[tr], y[tr], C); out[te] = m.predict(sc.transform(X[te]))
    return pc, pv


def run(path, C=0.1, export=None, quiet=False):
    d = np.load(path, allow_pickle=True)
    cons, vow, syl, spk = d['consonant'], d['vowel'], d['syllable'], d['speaker']
    mode, folds = splits(syl, spk)
    say = (lambda *a, **k: None) if quiet else print
    say(f'{len(syl)} clips, {len(set(syl))} syllables, {len(set(spk))} speaker(s). Evaluation: {mode}\n')

    base = np.array([baseline(g, c, v) for g, c, v in zip(d['greedy'], cons, vow)])
    res = {'baseline': (base[:, 0].mean(), base[:, 1].mean(), (base[:, 0] & base[:, 1]).mean())}
    say(f'{"features":<26}{"consonant":>10}{"vowel":>8}{"syllable":>10}')
    say(f'{"plain model (baseline)":<26}{res["baseline"][0]:>10.0%}{res["baseline"][1]:>8.0%}{res["baseline"][2]:>10.0%}')
    best = None
    for name, X in feature_sets(d).items():
        pc, pv = evaluate(X, cons, vow, folds, C)
        ac, av, asy = (pc == cons).mean(), (pv == vow).mean(), ((pc == cons) & (pv == vow)).mean()
        res[name] = (ac, av, asy); say(f'{name:<26}{ac:>10.0%}{av:>8.0%}{asy:>10.0%}')
        if best is None or asy > best[0]: best = (asy, name, pc)
    say(f'\nBest: {best[1]}')

    pc, present = best[2], set(cons)
    say('\nVoicing pairs (consonant head, best features): of clips meant as X, how many came out as X / as the twin')
    for x, y in PAIRS:
        if x in present and y in present:
            for a, b in ((x, y), (y, x)):
                m = cons == a; say(f'  {a} -> {a}: {(pc[m] == a).mean():.0%}   {a} -> {b}: {(pc[m] == b).mean():.0%}   (n={m.sum()})')
    if export:
        X = feature_sets(d)['post (browser-sized)']
        out = {'features': 'post: per-phone max probability over early/middle/late thirds of the speech, flattened (3 x vocab)', 'C': C}
        for key, y in (('consonant', cons), ('vowel', vow)):
            sc, m = fit(X, y, C)
            out[key] = {'classes': [str(c) for c in m.classes_], 'mean': sc.mean_.tolist(), 'scale': sc.scale_.tolist(),
                        'coef': m.coef_.tolist(), 'intercept': m.intercept_.tolist()}
        json.dump(out, open(export, 'w')); say(f'\nsaved {export} (not used by the game yet)')
    return res


def transfer(train_path, test_path, C=0.1):
    """Fit on one dataset (e.g. TTS), score on another (real recordings). The only number that says whether TTS data helps."""
    tr, te = np.load(train_path, allow_pickle=True), np.load(test_path, allow_pickle=True)
    if tr['post'].shape[1:] != te['post'].shape[1:] or list(tr['layers']) != list(te['layers']):
        sys.exit('The two feature files were made with different models/settings.')
    seen = set(tr['consonant']) | set(tr['vowel']); unseen = (set(te['consonant']) | set(te['vowel'])) - seen
    print(f'train: {len(tr["syllable"])} clips from {len(set(tr["speaker"]))} voices.  test: {len(te["syllable"])} clips from {len(set(te["speaker"]))} speaker(s).')
    if unseen: print(f'note: test has sounds the training set never saw: {sorted(unseen)} (they will count as wrong)')
    cons, vow = te['consonant'], te['vowel']
    base = np.array([baseline(g, c, v) for g, c, v in zip(te['greedy'], cons, vow)])
    print(f'\n{"features":<26}{"consonant":>10}{"vowel":>8}{"syllable":>10}')
    print(f'{"plain model (baseline)":<26}{base[:, 0].mean():>10.0%}{base[:, 1].mean():>8.0%}{(base[:, 0] & base[:, 1]).mean():>10.0%}')
    ftr, fte = feature_sets(tr), feature_sets(te); out = {}
    for name in ftr:
        pr = []
        for ytr, yte in ((tr['consonant'], cons), (tr['vowel'], vow)):
            sc, m = fit(ftr[name], ytr, C); pr.append(m.predict(sc.transform(fte[name])))
        ok = (pr[0] == cons, pr[1] == vow); out[name] = (ok[0].mean(), ok[1].mean(), (ok[0] & ok[1]).mean())
        print(f'{name:<26}{out[name][0]:>10.0%}{out[name][1]:>8.0%}{out[name][2]:>10.0%}')
        if name.startswith('post'): pc = pr[0]
    print('\nVoicing pairs on the real clips (browser-sized features):')
    for x, y in PAIRS:
        for a, b in ((x, y), (y, x)):
            m = cons == a
            if m.any(): print(f'  {a} -> {a}: {(pc[m] == a).mean():.0%}   {a} -> {b}: {(pc[m] == b).mean():.0%}   (n={m.sum()})')
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('feats', nargs='?'); ap.add_argument('--C', type=float, default=0.1); ap.add_argument('--export')
    ap.add_argument('--train'); ap.add_argument('--test')
    a = ap.parse_args()
    if a.train and a.test: transfer(a.train, a.test, a.C)
    elif a.feats: run(a.feats, a.C, a.export)
    else: ap.error('give a features file, or --train and --test')
