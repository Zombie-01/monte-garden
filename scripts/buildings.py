"""Detect villa footprints on the Monte Garden master plan and emit oriented rectangles as JSON (normalized 0..1 coords)."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out, debug = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.asarray(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape
R, G, B = im[..., 0], im[..., 1], im[..., 2]
warm = (R >= G + 4) & (R - B > 38) & (R > 165) & (G > 110)
warm = ndimage.binary_opening(warm, iterations=1)
lab, n = ndimage.label(warm)
objs = ndimage.find_objects(lab)

def rect(ys, xs):
    pts = np.stack([xs, ys], 1).astype(float)
    c = pts.mean(0)
    cov = np.cov((pts - c).T)
    w, v = np.linalg.eigh(cov)
    ax = v[:, 1]
    ang = np.arctan2(ax[1], ax[0])
    rot = np.array([[np.cos(-ang), -np.sin(-ang)], [np.sin(-ang), np.cos(-ang)]])
    p = (pts - c) @ rot.T
    lo, hi = np.percentile(p, 2, 0), np.percentile(p, 98, 0)
    mid = (lo + hi) / 2
    c2 = c + mid @ np.linalg.inv(rot).T
    return c2, hi - lo, ang

items = []
for i, sl in enumerate(objs, 1):
    m = lab[sl] == i
    area = m.sum()
    if area < 250 or area > 40000:
        continue
    ys, xs = np.nonzero(m)
    ys = ys + sl[0].start; xs = xs + sl[1].start
    c, size, ang = rect(ys, xs)
    fill = area / max(size[0] * size[1], 1)
    if fill < 0.45 or min(size) < 12 or max(size) / max(min(size), 1) > 5:
        continue  # thin lines, labels, paths
    col = im[ys, xs].mean(0)
    if col[0] < 222 and col[0] - col[1] < 26:
        continue  # khaki ground pads (playgrounds, plazas), not buildings
    parts = [(c, size, ang)]
    if fill < 0.72 and area > 900:
        # L / stepped footprints: split along the principal axis into two halves
        pts = np.stack([xs, ys], 1).astype(float)
        proj = (pts - c) @ np.array([np.cos(ang), np.sin(ang)])
        parts = []
        for sel in (proj < 0, proj >= 0):
            if sel.sum() > 120:
                parts.append(rect(ys[sel], xs[sel]))
    for (pc, ps, pa) in parts:
        items.append({'x': round(pc[0] / W, 5), 'y': round(pc[1] / H, 5), 'w': round(ps[0] / W, 5),
                      'd': round(ps[1] / H, 5), 'a': round(float(pa), 4),
                      'c': '#%02x%02x%02x' % tuple(int(v) for v in col), 'big': int(area > 6000)})

json.dump(items, open(out, 'w'))
print(len(items), 'footprints')

dbg = Image.open(src).convert('RGB').resize((W // 2, H // 2))
from PIL import ImageDraw
d = ImageDraw.Draw(dbg)
for it in items:
    cx, cy, w, h, a = it['x'] * W / 2, it['y'] * H / 2, it['w'] * W / 2, it['d'] * H / 2, it['a']
    ca, sa = np.cos(a), np.sin(a)
    pts = [(cx + ca * sx * w / 2 - sa * sy * h / 2, cy + sa * sx * w / 2 + ca * sy * h / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    d.polygon(pts, outline=(0, 0, 255))
dbg.save(debug)
