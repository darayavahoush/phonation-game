import sys
import numpy as np

CONS = ["k", "kh", "g", "gh", "ng", "ch", "chh", "j", "jh", "ny", "tt", "tth", "dd", "ddh", "nn",
        "t", "th", "d", "dh", "n", "p", "ph", "b", "bh", "m", "y", "r", "rr", "l", "ll", "zh", "v",
        "sh", "ss", "s", "h", "q", "x", "rd", "rdh", "f", "z", "w"]
VOW = ["a", "aa", "i", "ii", "u", "uu", "e", "ee", "o", "oo", "ai", "au", "am", "ah", "ax"]


def split(label):
    base = label.split("-")[0]
    for n in range(min(3, len(base)), 0, -1):
        if base[:n] in CONS and base[n:] in VOW:
            return base[:n], base[n:]
    return None


src, dst = sys.argv[1], sys.argv[2]
z = np.load(src, allow_pickle=True)
d = {k: z[k] for k in z.files}
syl = np.array(d["syllable"]).astype(str)
cons, vow, bad = [], [], set()
for s in syl:
    r = split(s)
    if r is None:
        bad.add(s)
        r = ("?", "?")
    cons.append(r[0])
    vow.append(r[1])
if bad:
    print("could not split:", sorted(bad)[:30])
    sys.exit(1)
old_c = len(set(np.array(d["consonant"]).astype(str)))
old_v = len(set(np.array(d["vowel"]).astype(str)))
d["consonant"], d["vowel"] = np.array(cons), np.array(vow)
np.savez_compressed(dst, **d)
print(f"consonant classes {old_c} -> {len(set(cons))}, vowel classes {old_v} -> {len(set(vow))}")
print("consonants:", sorted(set(cons)))
print("vowels:    ", sorted(set(vow)))
print("saved", dst)
