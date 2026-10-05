#!/usr/bin/env python3
"""An independent test set from the macOS built-in voices (`say`): a second speech engine, offline, no rate limits.

  python training/make_say_dataset.py --list                       # which voices this Mac has, by language
  python training/make_say_dataset.py --out training/say-en --consonants b p d t g k --vowels a --per-lang 4
  python training/make_say_dataset.py --out training/say-in --consonants --extra training/india.csv --per-lang 2

Same output layout as make_tts_dataset.py, so features.py reads it unchanged. Speakers are named tts-<lang>-<voice>.

Why: every training clip so far came from Google's TTS, so a held-out Google voice is still Google. Apple's voices are a
different synthesiser, so training on gTTS and testing on `say` is a harder, more honest check (still synthetic, still no
children, still not real speech):
  python training/features.py training/say-en --out training/feats_say.npz
  python training/relabel_npz.py training/feats_say.npz training/feats_say_fixed.npz      # only if you used --extra
  python training/merge_classes.py training/feats_say_fixed.npz training/feats_say_plain.npz --aspirates
  python training/ensemble.py --train training/feats_big_plain.npz --test training/feats_say_plain.npz

Indic voices are only there if you downloaded them: System Settings > Accessibility > Spoken Content > System voice >
Manage Voices. Check the --sample files by ear: a voice that cannot read a script may skip it or spell the letters out.
"""
import argparse
import csv
import os
import re
import subprocess
import sys

import numpy as np

import make_tts_dataset as M

NOVELTY = {'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Deranged', 'Good News', 'Hysterical', 'Jester',
           'Organ', 'Pipe Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Ralph', 'Kathy', 'Princess'}


def parse_voices(text):
    """`say -v '?'` lines look like:  Alex                en_US    # Most people recognize me by my voice."""
    out = []
    for line in text.splitlines():
        m = re.match(r'^(.*?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#', line)
        if m: out.append((m.group(1).strip(), m.group(2)))
    return out


def installed_voices():
    p = subprocess.run(['say', '-v', '?'], capture_output=True, text=True)
    if p.returncode: sys.exit('could not run `say -v ?` (this script needs macOS): ' + p.stderr[:200])
    return parse_voices(p.stdout)


def pick(voices, lang, per_lang, only):
    found = [(n, loc) for n, loc in voices if loc.split('_')[0] == lang and n not in NOVELTY and (not only or n in only)]
    found.sort(key=lambda t: (not t[1].endswith('_IN'), t[0]))      # Indian-locale voices first, then by name
    return list(dict.fromkeys(n for n, _ in found))[:per_lang]


def safe(name): return re.sub(r'\W+', '', name)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='training/say-data')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--consonants', nargs='*', default=['b', 'p', 'd', 't', 'g', 'k'], help='English-spelling consonants (pass none to skip English)')
    ap.add_argument('--vowels', nargs='+', default=['a'])
    ap.add_argument('--extra', nargs='*', default=[], help='CSV(s) of syllable,lang,tld,text rows (e.g. india.csv); the tld column is ignored')
    ap.add_argument('--per-lang', type=int, default=4, help='most voices to use per language')
    ap.add_argument('--voices', nargs='*', help='only these voice names')
    ap.add_argument('--augment', type=int, default=2)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--sample', type=int, default=12)
    a = ap.parse_args(argv)

    voices = installed_voices()
    if a.list:
        langs = sorted({loc.split('_')[0] for _, loc in voices})
        for lg in langs: print(f'{lg}: ' + ', '.join(f'{n} ({loc})' for n, loc in voices if loc.split('_')[0] == lg and n not in NOVELTY))
        return

    rows = [(c + v, 'en', M.text_for(c, v)) for c in a.consonants for v in a.vowels]
    extra = []
    for path in a.extra:
        for r in csv.DictReader(open(path, encoding='utf-8')):
            extra.append(r)
    langs = sorted({'en'} | {r['lang'] for r in extra}) if (rows or extra) else []
    chosen = {lg: pick(voices, lg, a.per_lang, a.voices) for lg in langs}
    for lg in langs:
        if not chosen[lg]: print(f'warning: no usable `say` voice for language "{lg}" on this Mac; skipping it (see --list)', file=sys.stderr)
    real = {}                                   # sanitised name used in file names -> the actual voice name
    jobs = []
    for syl, lg, text in rows:
        for vname in chosen.get('en', []): real[safe(vname)] = vname; jobs.append({'syllable': syl, 'lang': 'en', 'tld': safe(vname), 'text': text})
    for r in extra:
        for vname in chosen.get(r['lang'], []):
            real[safe(vname)] = vname
            jobs.append({'syllable': r['syllable'], 'lang': r['lang'], 'tld': safe(vname), 'text': r['text'],
                         'consonant': r.get('consonant', ''), 'vowel': r.get('vowel', ''), 'variant': r.get('variant', '')})
    if not jobs: sys.exit('nothing to synthesise: no matching voices (try --list)')
    os.makedirs(a.out, exist_ok=True)
    jobs_csv = os.path.join(a.out, 'jobs.csv')
    with open(jobs_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['syllable', 'lang', 'tld', 'text', 'consonant', 'vowel', 'variant'])
        w.writeheader(); w.writerows(jobs)
    print('voices: ' + '; '.join(f'{lg}: {", ".join(v)}' for lg, v in chosen.items() if v) + f'  ->  {len(jobs)} syllable x voice jobs')

    def synth(text, lang, tld, cache):
        aiff = os.path.splitext(cache)[0] + '.aiff'
        if not os.path.exists(aiff):
            p = subprocess.run(['say', '-v', real[tld], '-o', aiff, '--', text], capture_output=True, text=True)
            if p.returncode: raise RuntimeError(f'say failed for {text!r} with {real[tld]}: {p.stderr[:200]}')
        q = subprocess.run(['ffmpeg', '-v', 'error', '-i', aiff, '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'], capture_output=True)
        if q.returncode or not q.stdout: raise RuntimeError('ffmpeg failed: ' + q.stderr.decode()[:200])
        x = np.frombuffer(q.stdout, dtype='<i2').astype(np.float32) / 32768.0
        if np.abs(x).max() < 1e-3: raise RuntimeError(f'{real[tld]} produced silence for {text!r} (voice cannot read that script?)')
        return x

    return M.main(['--out', a.out, '--consonants', '--extra', jobs_csv, '--augment', str(a.augment),
                   '--seed', str(a.seed), '--sample', str(a.sample)], synth=synth)


if __name__ == '__main__':
    main()
