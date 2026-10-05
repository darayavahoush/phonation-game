#!/usr/bin/env python3
"""A third speech engine for training: Microsoft Edge neural voices via the `edge-tts` package (needs internet).

  pip install edge-tts                                            # inside the .venv
  python training/make_edge_dataset.py --list --lang hi           # which voices exist for a language
  python training/make_edge_dataset.py --out training/edge-en --consonants b p d t g k --vowels a e i o u --per-lang 4
  python training/make_edge_dataset.py --out training/edge-in --consonants --extra training/india.csv --per-lang 2

Same output layout as make_tts_dataset.py (manifest.csv + clips/*.wav), so features.py reads it unchanged. Speakers are named
tts-<lang>-<voice>. Voices are chosen Indian-locale first, alternating female/male so you get both.

Why: gTTS gave one or two voices per language. This adds a different engine with several voices per language, which is the
cheapest way to widen the training voices without real speakers. Keep the macOS `say` set as the held-out test:
  python training/ensemble.py --train <gTTS + edge features> --test training/feats_say2_plain.npz

Like gTTS this is an unofficial endpoint: it can rate-limit or change. MP3s are cached in <out>/mp3 so re-runs resume. The label is
the text you sent, not what the voice said, so listen to the files --sample prints before trusting them.
"""
import argparse
import asyncio
import csv
import os
import sys
import time

import make_tts_dataset as M
from make_say_dataset import safe


def all_voices():
    import edge_tts
    return asyncio.run(edge_tts.list_voices())


def pick(voices, lang, per_lang, only):
    """Indian-locale first, then by name; alternate Female/Male so both are represented."""
    found = [v for v in voices if v['Locale'].split('-')[0] == lang and (not only or v['ShortName'] in only)]
    found.sort(key=lambda v: (not v['Locale'].endswith('-IN'), v['ShortName']))
    by_gender = {'Female': [v for v in found if v.get('Gender') == 'Female'], 'Male': [v for v in found if v.get('Gender') == 'Male']}
    out, order = [], ['Female', 'Male']
    while len(out) < per_lang and (by_gender['Female'] or by_gender['Male']):
        for g in order:
            if by_gender[g] and len(out) < per_lang: out.append(by_gender[g].pop(0)['ShortName'])
    return out


def fetch(text, voice, path, retries=3):
    import edge_tts
    for k in range(retries):
        try:
            asyncio.run(edge_tts.Communicate(text, voice).save(path))
            if os.path.getsize(path) > 0:
                time.sleep(0.3)
                return
        except Exception as e:
            wait = 2 ** (k + 1)
            print(f'  edge-tts failed ({e}); retry in {wait}s', file=sys.stderr)
            time.sleep(wait)
    if os.path.exists(path) and os.path.getsize(path) == 0: os.remove(path)
    raise RuntimeError(f'edge-tts kept failing for {text!r} with {voice}; try again later')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='training/edge-data')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--lang', help='with --list: only this language code, e.g. hi')
    ap.add_argument('--consonants', nargs='*', default=['b', 'p', 'd', 't', 'g', 'k'], help='English-spelling consonants (pass none to skip English)')
    ap.add_argument('--vowels', nargs='+', default=['a'])
    ap.add_argument('--extra', nargs='*', default=[], help='CSV(s) of syllable,lang,tld,text (e.g. india.csv); tld is ignored')
    ap.add_argument('--per-lang', type=int, default=2)
    ap.add_argument('--voices', nargs='*', help='only these voice ShortNames, e.g. hi-IN-SwaraNeural')
    ap.add_argument('--augment', type=int, default=2)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--sample', type=int, default=12)
    a = ap.parse_args(argv)

    try:
        voices = all_voices()
    except ImportError:
        sys.exit('edge-tts is not installed: pip install edge-tts')
    if a.list:
        for v in sorted(voices, key=lambda v: v['ShortName']):
            if not a.lang or v['Locale'].split('-')[0] == a.lang: print(f"{v['ShortName']:<32}{v['Locale']:<8}{v.get('Gender', '')}")
        return

    rows = [(c + v, M.text_for(c, v)) for c in a.consonants for v in a.vowels]
    extra = [r for path in a.extra for r in csv.DictReader(open(path, encoding='utf-8'))]
    langs = sorted(({'en'} if rows else set()) | {r['lang'] for r in extra})
    chosen = {lg: pick(voices, lg, a.per_lang, a.voices) for lg in langs}
    for lg in langs:
        if not chosen[lg]: print(f'warning: no edge voice for language "{lg}"; skipping it (see --list --lang {lg})', file=sys.stderr)
    real, jobs = {}, []
    for syl, text in rows:
        for v in chosen.get('en', []): real[safe(v)] = v; jobs.append({'syllable': syl, 'lang': 'en', 'tld': safe(v), 'text': text})
    for r in extra:
        for v in chosen.get(r['lang'], []):
            real[safe(v)] = v
            jobs.append({'syllable': r['syllable'], 'lang': r['lang'], 'tld': safe(v), 'text': r['text'],
                         'consonant': r.get('consonant', ''), 'vowel': r.get('vowel', ''), 'variant': r.get('variant', '')})
    if not jobs: sys.exit('nothing to synthesise: no matching voices (try --list)')
    os.makedirs(a.out, exist_ok=True)
    jobs_csv = os.path.join(a.out, 'jobs.csv')
    with open(jobs_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['syllable', 'lang', 'tld', 'text', 'consonant', 'vowel', 'variant'])
        w.writeheader(); w.writerows(jobs)
    print('voices: ' + '; '.join(f'{lg}: {", ".join(v)}' for lg, v in chosen.items() if v) + f'  ->  {len(jobs)} syllable x voice jobs')

    def synth(text, lang, tld, cache):
        if not os.path.exists(cache): fetch(text, real[tld], cache)
        return M.trim_silence(M.decode_mp3(open(cache, 'rb').read()))

    # M.main trims silence again; trimming twice is harmless.
    return M.main(['--out', a.out, '--consonants', '--extra', jobs_csv, '--augment', str(a.augment),
                   '--seed', str(a.seed), '--sample', str(a.sample)], synth=synth)


if __name__ == '__main__':
    main()
