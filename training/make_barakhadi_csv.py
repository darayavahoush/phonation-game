#!/usr/bin/env python3
"""Write the --extra CSV for a Hindi barakhadi dataset: each consonant x the 12 vowel forms.

  python3 training/make_barakhadi_csv.py > training/barakhadi.csv
  python3 training/make_tts_dataset.py --out training/tts-hi --consonants --extra training/barakhadi.csv --accents com --augment 3

Labels use the game's consonant names. Hindi th/dh here are the aspirated stops थ/ध, NOT English θ/ð.
d and t each get two source letters (dental द त and retroflex ड ट) under the same label, because the game accepts both.
Skipped: zh (no Hindi letter) and w (व is already used for v, and two labels on one sound would poison training).
"""
import csv, sys

NUKTA = '\u093c'
CONS = [  # (label, letter, variant)
    ('k', 'क', ''), ('g', 'ग', ''), ('ch', 'च', ''), ('j', 'ज', ''),
    ('t', 'त', 'dental'), ('t', 'ट', 'retroflex'), ('d', 'द', 'dental'), ('d', 'ड', 'retroflex'),
    ('n', 'न', ''), ('p', 'प', ''), ('b', 'ब', ''), ('m', 'म', ''),
    ('y', 'य', ''), ('r', 'र', ''), ('l', 'ल', ''), ('v', 'व', ''),
    ('sh', 'श', ''), ('s', 'स', ''), ('h', 'ह', ''),
    ('f', 'फ' + NUKTA, ''), ('z', 'ज' + NUKTA, ''),
    ('th', 'थ', ''), ('dh', 'ध', ''),
]
VOWELS = [('a', ''), ('aa', 'ा'), ('i', 'ि'), ('ii', 'ी'), ('u', 'ु'), ('uu', 'ू'),
          ('e', 'े'), ('ai', 'ै'), ('o', 'ो'), ('au', 'ौ'), ('am', 'ं'), ('ah', 'ः')]

w = csv.writer(sys.stdout, lineterminator='\n')
w.writerow(['syllable', 'lang', 'tld', 'text', 'consonant', 'vowel', 'variant'])
for c, letter, variant in CONS:
    for v, sign in VOWELS:
        w.writerow([c + v, 'hi', 'com', letter + sign, c, v, variant])
