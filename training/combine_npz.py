import sys
import numpy as np
dst, srcs = sys.argv[1], sys.argv[2:]
zs = [np.load(s, allow_pickle=True) for s in srcs]
keys = zs[0].files
out = {}
for k in keys:
    if k == "layers":
        assert all(list(z[k]) == list(zs[0][k]) for z in zs), "layer lists differ"
        out[k] = zs[0][k]
    else:
        out[k] = np.concatenate([z[k] for z in zs], axis=0)
np.savez_compressed(dst, **out)
print("saved", dst, {k: out[k].shape for k in keys})
