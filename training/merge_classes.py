import sys
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
z = np.load(src, allow_pickle=True)
d = {k: z[k] for k in z.files}
CM = {"tt": "t", "tth": "th", "dd": "d", "ddh": "dh", "nn": "n", "ll": "l", "rr": "r", "ss": "sh"}
VM = {"ii": "i", "uu": "u", "ee": "e", "oo": "o"}
d["consonant"] = np.array([CM.get(c, c) for c in np.array(d["consonant"]).astype(str)])
d["vowel"] = np.array([VM.get(v, v) for v in np.array(d["vowel"]).astype(str)])
np.savez_compressed(dst, **d)
print("consonants:", len(set(d["consonant"])), sorted(set(d["consonant"])))
print("vowels:", sorted(set(d["vowel"])))
