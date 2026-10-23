"""Sample tree canopy positions (dark green blobs) on the master plan for instanced 3D trees."""
import json, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape
R, G, B = im[..., 0], im[..., 1], im[..., 2]
canopy = (G > R + 6) & (G > B + 18) & (R < 165) & (G < 185)
rng = np.random.default_rng(7)
cell = 22
pts = []
for y in range(0, H - cell, cell):
    for x in range(0, W - cell, cell):
        c = canopy[y:y + cell, x:x + cell]
        frac = c.mean()
        if frac > 0.3:
            ys, xs = np.nonzero(c)
            k = rng.integers(len(xs))
            tint = im[y + ys[k], x + xs[k]]
            pts.append([round((x + xs[k]) / W, 4), round((y + ys[k]) / H, 4), round(float(frac), 2),
                        int(tint[0]), int(tint[1]), int(tint[2])])
json.dump(pts, open(out, 'w'))
print(len(pts), 'trees')
