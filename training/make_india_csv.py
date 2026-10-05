#!/usr/bin/env python3
"""Build a syllable CSV covering the sounds of the major Indian languages.

Columns match `make_tts_dataset.py --extra`:  syllable,lang,tld,text
The label is <consonant><vowel>, e.g. kha, ttii, zhu. The language lives in the
voice name that the generator builds (tts-te-com, tts-ml-com, ...), so labels
do not need a language suffix.

Run from the repo root:
    python training/make_india_csv.py --langs hi,te,kn,ml,ta > training/india.csv
    python training/make_tts_dataset.py --out training/tts-india --consonants \
        --extra training/india.csv --accents com --augment 2 --sample 24

Labels
  Consonants  k kh g gh ng | ch chh j jh ny | tt tth dd ddh nn (retroflex) |
              t th d dh n (dental) | p ph b bh m | y r rr l ll(retroflex) v zh |
              sh(palatal) ss(retroflex) s h | q x rd rdh (Hindi nukta letters)
  Vowels      a aa i ii u uu e ee o oo ai au am ah
              Indo-Aryan e/o are long monophthongs (Hindi ए ओ). Dravidian has
              short e/o and long ee/oo; labels follow the script's own length.
  i = short (English "pih"), ii = long (English "pee").

Every script block is laid out in the same order as Devanagari (the ISCII
layout), so one table of offsets generates all of them.
"""
import argparse, csv, sys

# Offsets from the script's base code point, Devanagari order
CONS = {
    "k": 0x15, "kh": 0x16, "g": 0x17, "gh": 0x18, "ng": 0x19,
    "ch": 0x1A, "chh": 0x1B, "j": 0x1C, "jh": 0x1D, "ny": 0x1E,
    "tt": 0x1F, "tth": 0x20, "dd": 0x21, "ddh": 0x22, "nn": 0x23,
    "t": 0x24, "th": 0x25, "d": 0x26, "dh": 0x27, "n": 0x28,
    "p": 0x2A, "ph": 0x2B, "b": 0x2C, "bh": 0x2D, "m": 0x2E,
    "y": 0x2F, "r": 0x30, "rr": 0x31, "l": 0x32, "ll": 0x33, "zh": 0x34,
    "v": 0x35, "sh": 0x36, "ss": 0x37, "s": 0x38, "h": 0x39,
}
# Vowel signs by offset. "" = bare consonant (inherent a).
VOW_INDO = {"a": "", "aa": 0x3E, "i": 0x3F, "ii": 0x40, "u": 0x41, "uu": 0x42,
            "e": 0x47, "ai": 0x48, "o": 0x4B, "au": 0x4C, "am": 0x02, "ah": 0x03}
VOW_DRAV = {"a": "", "aa": 0x3E, "i": 0x3F, "ii": 0x40, "u": 0x41, "uu": 0x42,
            "e": 0x46, "ee": 0x47, "ai": 0x48, "o": 0x4A, "oo": 0x4B, "au": 0x4C,
            "am": 0x02, "ah": 0x03}

ALL = list(CONS)
# language -> (base, tld, vowel table, consonants it can be trusted for)
LANGS = {
    "hi": (0x0900, VOW_INDO, [c for c in ALL if c not in ("rr", "zh")]),
    "mr": (0x0900, VOW_INDO, [c for c in ALL if c not in ("rr", "zh", "ch", "chh", "j", "jh")]),  # च ज are ts/dz before a o u
    "gu": (0x0A80, VOW_INDO, [c for c in ALL if c not in ("rr", "zh")]),
    "te": (0x0C00, VOW_DRAV, [c for c in ALL if c not in ("rr", "zh")]),
    "kn": (0x0C80, VOW_DRAV, [c for c in ALL if c not in ("rr", "zh")]),
    "ml": (0x0D00, VOW_DRAV, ALL),
    # Bengali: no vowel length, inherent vowel is /o/, শ ষ স all /sh/, ব is /b/
    "bn": (0x0980, {"aa": 0x3E, "i": 0x3F, "u": 0x41, "e": 0x47, "ai": 0x48, "o": 0x4B, "au": 0x4C},
           ["k", "kh", "g", "gh", "ch", "chh", "j", "jh", "tt", "tth", "dd", "ddh", "t", "th", "d", "dh",
            "n", "p", "ph", "b", "bh", "m", "r", "l", "sh", "h"]),
    # Punjabi: voiced aspirates became tones, so they are left out
    "pa": (0x0A00, {k: v for k, v in VOW_INDO.items() if k not in ("am", "ah")},
           ["k", "kh", "g", "ch", "chh", "j", "tt", "tth", "dd", "nn", "t", "th", "d", "n", "p", "ph",
            "b", "m", "y", "r", "l", "ll", "v", "sh", "s", "h"]),
}
# Tamil is not laid out like the others
TA_CONS = {"k": 0x0B95, "ng": 0x0B99, "ch": 0x0B9A, "ny": 0x0B9E, "tt": 0x0B9F, "nn": 0x0BA3,
           "t": 0x0BA4, "n": 0x0BA8, "p": 0x0BAA, "m": 0x0BAE, "y": 0x0BAF, "r": 0x0BB0,
           "rr": 0x0BB1, "l": 0x0BB2, "ll": 0x0BB3, "zh": 0x0BB4, "v": 0x0BB5,
           "j": 0x0B9C, "ss": 0x0BB7, "s": 0x0BB8, "h": 0x0BB9}
TA_VOW = {"a": "", "aa": 0x0BBE, "i": 0x0BBF, "ii": 0x0BC0, "u": 0x0BC1, "uu": 0x0BC2,
          "e": 0x0BC6, "ee": 0x0BC7, "ai": 0x0BC8, "o": 0x0BCA, "oo": 0x0BCB, "au": 0x0BCC}

NUKTA = "\u093c"
HI_NUKTA = {"q": "\u0915" + NUKTA, "x": "\u0916" + NUKTA, "rd": "\u0921" + NUKTA, "rdh": "\u0922" + NUKTA}

EN_CONS = ["b", "p", "d", "t", "g", "k", "m", "n", "f", "v", "s", "z", "sh", "ch", "j", "h", "l", "r", "y", "w"]
EN_VOW = {"a": "ah", "e": "eh", "i": "ih", "ii": "ee", "o": "oh", "uu": "oo", "ax": "uh"}


def rows_for(lang, vowels):
    out = []
    if lang == "ta":
        for c, cp in TA_CONS.items():
            for v, off in TA_VOW.items():
                if vowels and v not in vowels:
                    continue
                out.append((c + v, "ta", "com", chr(cp) + ("" if off == "" else chr(off))))
        return out
    base, vtab, cons = LANGS[lang]
    for c in cons:
        for v, off in vtab.items():
            if vowels and v not in vowels:
                continue
            if v == "a" and lang == "bn":
                continue
            out.append((c + v, lang, "com", chr(base + CONS[c]) + ("" if off == "" else chr(base + off))))
    if lang == "hi":
        for c, ch in HI_NUKTA.items():
            for v, off in VOW_INDO.items():
                if vowels and v not in vowels:
                    continue
                out.append((c + v, "hi", "com", ch + ("" if off == "" else chr(0x900 + off))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="hi,te,kn,ml,ta", help="comma list from: hi mr gu te kn ml ta bn pa")
    ap.add_argument("--vowels", default="", help="space or comma list to keep, e.g. a,i,ii,u,e,o (default: all)")
    ap.add_argument("--no-english", action="store_true", help="skip the English ih/ee/oo/uh block")
    a = ap.parse_args()
    keep = set(x for x in a.vowels.replace(",", " ").split()) or None
    rows = []
    for lang in a.langs.split(","):
        lang = lang.strip()
        if lang not in LANGS and lang != "ta":
            sys.exit(f"unknown language {lang!r}")
        rows += rows_for(lang, keep)
    if not a.no_english:
        for c in EN_CONS:
            for v, vs in EN_VOW.items():
                if keep and v not in keep:
                    continue
                rows.append((c + v, "en", "co.in", c + vs))
    seen = set()
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(["syllable", "lang", "tld", "text"])
    per = {}
    for r in rows:
        key = (r[0], r[1])
        if key in seen:
            continue
        seen.add(key)
        w.writerow(r)
        per[r[1]] = per.get(r[1], 0) + 1
    tot = sum(per.values())
    print(f"# {tot} rows {per}; about {tot / 55:.0f} min of requests at ~1 per 1.1 s", file=sys.stderr)


if __name__ == "__main__":
    main()
