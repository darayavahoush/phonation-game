#!/usr/bin/env python3
"""Build a synthetic labelled syllable dataset with gTTS (Google Translate text-to-speech).

  pip install gTTS numpy scipy        # and: brew install ffmpeg
  python3 training/make_tts_dataset.py --out training/tts-data
  python3 training/make_tts_dataset.py --out training/tts-data --consonants b p d t g k --vowels a --augment 6

Output is a folder in the same layout as the /collect.html export (manifest.csv + clips/*.wav), so
features.py reads it unchanged:   python3 training/features.py training/tts-data --out training/feats_tts.npz

What it does: for each syllable it asks gTTS for several English accents (the `tld` option picks the accent),
decodes to 16 kHz mono, then makes extra copies with random speed, loudness, room echo, noise and lead-in
silence. Each accent is one "speaker" in the manifest. MP3s are cached in <out>/mp3 so re-runs are free.

READ THIS BEFORE TRUSTING IT
- The label is the text you sent, not what Google actually said. TTS can read "pa" as a word or a letter name.
  Listen to a sample (--sample N plays nothing, it just lists files to open), and check the plain model's per-syllable
  agreement after features.py.
- It is a handful of synthetic voices, no children, no mic noise, no real hesitation. A model trained only on it
  will look great on TTS and may fall apart on people. The only test that counts is real recordings from
  /collect.html:  train.py --train feats_tts.npz --test feats_real.npz
- gTTS calls an unofficial Google endpoint. Fine for a small personal experiment; it can rate-limit or break.
"""
import argparse, csv, io, math, os, subprocess, sys, time, wave
import numpy as np

ACCENTS = ['com', 'co.uk', 'com.au', 'co.in', 'ca', 'ie', 'co.za']      # gTTS `tld` values; English only
VOWEL_SPELL = {'a': 'ah', 'e': 'eh', 'i': 'ee', 'o': 'oh', 'u': 'oo'}   # so "pa" is read "pah", not "pay"
CONSONANTS = ['b', 'p', 'd', 't', 'g', 'k', 'm', 'n', 'f', 'v', 's', 'z', 'sh', 'zh', 'th', 'dh', 'ch', 'j', 'h', 'l', 'r', 'y', 'w']
# English spellings are unreliable for these; the script warns instead of pretending.
SHAKY = {'zh': 'no common English spelling', 'dh': 'spelling "dh" is not read as /ð/', 'th': 'may read as voiced or voiceless'}


def decode_mp3(mp3):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'],
                       input=mp3, capture_output=True)
    if p.returncode or not p.stdout: raise RuntimeError('ffmpeg failed: ' + p.stderr.decode()[:200])
    return np.frombuffer(p.stdout, dtype='<i2').astype(np.float32) / 32768.0


def gtts_mp3(text, lang, tld, cache, retries=4):
    if os.path.exists(cache): return open(cache, 'rb').read()
    from gtts import gTTS
    for k in range(retries):
        try:
            buf = io.BytesIO(); gTTS(text, lang=lang, tld=tld).write_to_fp(buf)
            open(cache, 'wb').write(buf.getvalue()); time.sleep(0.4); return buf.getvalue()
        except Exception as e:
            wait = 2 ** (k + 1); print(f'  gTTS failed ({e}); retry in {wait}s', file=sys.stderr); time.sleep(wait)
    raise RuntimeError(f'gTTS kept failing for {text!r} ({lang}/{tld}); you may be rate-limited, try again later')


def speech_span(x, sr=16000):
    fl = sr // 100; n = len(x) // fl
    e = np.sqrt((x[:n * fl].reshape(n, fl) ** 2).mean(1))
    pk = e.max() + 1e-9; thr = max(np.sort(e)[int(n * 0.2)] * 3, pk * 0.1); idx = np.where(e > thr)[0]
    if not len(idx): return 0, 0, -99.0
    return int(idx[0] * 10), int((idx[-1] + 1) * 10), round(float(20 * np.log10(pk)), 1)


def trim_silence(x, sr=16000, keep_ms=120):
    s, e, _ = speech_span(x, sr)
    if e == 0: return x
    return x[max(0, int((s - keep_ms) * sr / 1000)): int((e + keep_ms) * sr / 1000)]


def augment(x, rng, sr=16000):
    from scipy.signal import fftconvolve, resample_poly
    f = rng.choice([0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2])               # speed (also shifts pitch a bit)
    if f != 1.0: x = resample_poly(x, 100, int(round(100 * f))).astype(np.float32)
    if rng.random() < 0.5:                                                # small room: decaying noise impulse response
        rt = rng.uniform(0.08, 0.35); n = int(sr * rt); ir = rng.normal(size=n) * np.exp(-6.9 * np.arange(n) / n); ir[0] = 1.0
        x = fftconvolve(x, ir * rng.uniform(0.05, 0.25) / np.abs(ir[1:]).max(), 'full')[:len(x) + n // 2].astype(np.float32)
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (rng.uniform(-24, -6) / 20)  # loudness: peak -24 to -6 dBFS
    lead, tail = rng.uniform(0.2, 0.7), rng.uniform(0.15, 0.5)
    x = np.concatenate([np.zeros(int(sr * lead), np.float32), x, np.zeros(int(sr * tail), np.float32)])
    snr = rng.uniform(12, 35); p = (x ** 2).mean() + 1e-12                # background noise at 12-35 dB SNR, speech-weighted
    x = x + rng.normal(size=len(x)).astype(np.float32) * math.sqrt(p / 10 ** (snr / 10))
    return np.clip(x, -1, 1).astype(np.float32)


def write_wav(path, x, sr=16000):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def text_for(c, v): return c + VOWEL_SPELL[v]


def main(argv=None, synth=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='training/tts-data'); ap.add_argument('--consonants', nargs='*', default=['b', 'p', 'd', 't', 'g', 'k'], help='English-spelling consonants; pass none (--consonants) to skip English')
    ap.add_argument('--vowels', nargs='+', default=['a']); ap.add_argument('--accents', nargs='+', default=ACCENTS)
    ap.add_argument('--augment', type=int, default=4, help='extra randomised copies per clip, on top of the clean one')
    ap.add_argument('--extra', help='CSV: syllable,lang,tld,text and optionally consonant,vowel,variant (see make_barakhadi_csv.py)')
    ap.add_argument('--seed', type=int, default=0); ap.add_argument('--sample', type=int, default=0)
    a = ap.parse_args(argv)
    for c in a.consonants:
        if c in SHAKY: print(f'warning: "{c}": {SHAKY[c]}. Check these by ear, or use --extra with a better text.', file=sys.stderr)
    rng = np.random.default_rng(a.seed)
    jobs = [(c + v, c, v, text_for(c, v), 'en', t, '') for c in a.consonants for v in a.vowels for t in a.accents] if a.consonants else []
    if a.extra:
        for r in csv.DictReader(open(a.extra, encoding='utf-8')):
            syl = r['syllable']; c, v = (syl[:-1], syl[-1]) if syl[-1] in VOWEL_SPELL else (syl, '')
            jobs.append((syl, r.get('consonant') or c, r.get('vowel') or v, r['text'], r['lang'], r.get('tld') or 'com', r.get('variant') or ''))
    os.makedirs(os.path.join(a.out, 'clips'), exist_ok=True); os.makedirs(os.path.join(a.out, 'mp3'), exist_ok=True)
    head = ['file', 'speaker', 'voice', 'syllable', 'consonant', 'vowel', 'take', 'sample_rate', 'speech_start_ms', 'speech_end_ms', 'peak_db', 'created_at', 'tts_text']
    rows, now = [], time.strftime('%Y-%m-%dT%H:%M:%S')
    for k, (syl, c, v, text, lang, tld, variant) in enumerate(jobs, 1):
        spk = f'tts-{lang}-{tld}'.replace('.', '')
        tag = f'{syl}-{variant}' if variant else syl      # same label, different source letter (e.g. dental vs retroflex t)
        cache = os.path.join(a.out, 'mp3', f'{spk}_{tag}.mp3')
        x = trim_silence(synth(text, lang, tld, cache) if synth else decode_mp3(gtts_mp3(text, lang, tld, cache)))
        for take in range(a.augment + 1):
            y = x if take == 0 else augment(x, rng)
            if take == 0: y = np.concatenate([np.zeros(3200, np.float32), y, np.zeros(3200, np.float32)])
            rel = f'clips/{spk}_{tag}_{take:02d}.wav'; write_wav(os.path.join(a.out, rel), y)
            s, e, pk = speech_span(y)
            rows.append([rel, spk, 'tts', syl, c, v, take + 1, 16000, s, e, pk, now, text])
        if k % 10 == 0 or k == len(jobs): print(f'  {k}/{len(jobs)} voices x syllables', flush=True)
    with open(os.path.join(a.out, 'manifest.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(head); w.writerows(rows)
    print(f'wrote {len(rows)} clips to {a.out}')
    if a.sample:
        print('\nListen to these before trusting the labels (the clean take of each):')
        for r in [r for r in rows if r[6] == 1][:: max(1, len(jobs) // a.sample)][:a.sample]: print(f'  {r[3]:<5} text={r[12]!r:<8} {os.path.join(a.out, r[0])}')
    return rows


if __name__ == '__main__':
    main()
