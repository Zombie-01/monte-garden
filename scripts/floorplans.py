"""Cut each apartment floor-plan render out of its poster and derive a wall mask for 3D extrusion.

Writes, per plan id: public/assets/plans/<id>.webp (RGBA plan) and src/plans/<id>.json (wall runs + size).
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

src_dir, out_img, out_json, debug_dir = sys.argv[1:5]
ids = json.loads(sys.argv[5])  # {"id": "filename.jpg", ...}
os.makedirs(out_img, exist_ok=True)
os.makedirs(out_json, exist_ok=True)
os.makedirs(debug_dir, exist_ok=True)

CELL = 3  # px per wall grid cell at working resolution

for pid, fname in ids.items():
    im = Image.open(os.path.join(src_dir, fname)).convert('RGB')
    a = np.asarray(im).astype(int)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]

    # plan = warm / neutral pixels; poster background and legend panel are blue
    plan = (R >= B - 6) & (a.mean(-1) > 40)
    plan = ndimage.binary_opening(plan, iterations=2)
    plan = ndimage.binary_closing(plan, iterations=6)
    lab, n = ndimage.label(plan)
    sizes = ndimage.sum(plan, lab, range(1, n + 1))
    plan = lab == (np.argmax(sizes) + 1)
    plan = ndimage.binary_fill_holes(plan)
    ys, xs = np.nonzero(plan)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 6
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(a.shape[0], y1 + pad), min(a.shape[1], x1 + pad)

    crop = a[y0:y1, x0:x1]
    mask = plan[y0:y1, x0:x1]
    alpha = (ndimage.gaussian_filter(mask.astype(float), 1.2) * 255).clip(0, 255).astype(np.uint8)
    rgba = np.dstack([crop.astype(np.uint8), alpha])
    Image.fromarray(rgba, 'RGBA').save(os.path.join(out_img, f'{pid}.webp'), quality=88, method=6)

    # walls: flat pinkish-beige render colour
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    lum = crop.mean(-1)
    m1 = ndimage.uniform_filter(lum, 3)
    sd = np.sqrt(np.maximum(ndimage.uniform_filter(lum ** 2, 3) - m1 ** 2, 0))
    # wall colour varies per poster: walls are the brightest flat, slightly warm surface (white fixtures/labels excluded)
    cand = ndimage.binary_erosion(mask, iterations=4) & (sd < 2.0) & (r - b > 10) & (r - b < 50)
    thr = np.percentile(lum[cand], 85)
    ref = np.median(crop[cand & (lum >= thr)], axis=0)
    dist = np.sqrt(((crop - ref) ** 2).sum(-1))
    strong = (dist < 16) & (sd < 5) & mask
    # shaded wall tops: dimmer but just as flat — accept them only where they connect to a strong wall
    weak = (dist < 30) & (sd < 4) & (lum > ref.mean() - 45) & mask
    wall = ndimage.binary_propagation(strong, mask=weak | strong)
    wall = ndimage.binary_dilation(wall, iterations=1) & mask  # recover the edge pixels the texture test drops
    # walls are thin; anything that survives a ~20 px wide opening is furniture (sofas, beds, counters)
    yy, xx = np.mgrid[-10:11, -10:11]
    blob = ndimage.binary_opening(wall, structure=(xx ** 2 + yy ** 2) <= 100)
    # ...unless the thick part is long and narrow: that's a thick outer wall, not furniture
    blab, bn = ndimage.label(blob)
    for k, sl in enumerate(ndimage.find_objects(blab), 1):
        comp = blab[sl] == k
        length = max(comp.shape)
        if length > 110 and comp.sum() / length < 34:
            blob[sl][comp] = False
    wall &= ~ndimage.binary_dilation(blob, iterations=2)
    # deck boards / grain stripes are narrower than any wall: drop components never wider than ~8 px
    dt = ndimage.distance_transform_edt(wall)
    wlab, wn = ndimage.label(wall)
    if wn:
        widest = ndimage.maximum(dt, wlab, range(1, wn + 1))
        wall = np.isin(wlab, np.nonzero(widest >= 4.5)[0] + 1)
    wall = ndimage.binary_opening(wall, iterations=1)
    wall = ndimage.binary_closing(wall, iterations=1)
    lab, n = ndimage.label(wall)
    sizes = ndimage.sum(wall, lab, range(1, n + 1))
    wall = np.isin(lab, np.nonzero(sizes > 120)[0] + 1)

    # isolated specks left on furniture would become stray pillars in 3D
    wlab, wn = ndimage.label(wall)
    if wn:
        sizes = ndimage.sum(wall, wlab, range(1, wn + 1))
        wall = np.isin(wlab, np.nonzero(sizes > 350)[0] + 1)

    H, W = wall.shape
    gh, gw = H // CELL, W // CELL
    grid = wall[: gh * CELL, : gw * CELL].reshape(gh, CELL, gw, CELL).mean((1, 3)) > 0.5
    # merge identical row spans into rectangles → [col, row, width, height] in grid cells
    runs = []
    open_rects = {}
    for yy in range(gh + 1):
        spans = set()
        if yy < gh:
            row = grid[yy]
            xx = 0
            while xx < gw:
                if row[xx]:
                    st = xx
                    while xx < gw and row[xx]:
                        xx += 1
                    spans.add((st, xx - st))
                else:
                    xx += 1
        for key in list(open_rects):
            if key not in spans:
                y0r = open_rects.pop(key)
                runs.append([key[0], y0r, key[1], yy - y0r])
        for key in spans:
            open_rects.setdefault(key, yy)
    json.dump({'w': W, 'h': H, 'cell': CELL, 'area': int(mask.sum()), 'rects': runs}, open(os.path.join(out_json, f'{pid}.json'), 'w'), separators=(',', ':'))

    dbg = crop.astype(np.uint8).copy()
    dbg[wall] = [255, 0, 0]
    Image.fromarray(dbg).resize((W // 2, H // 2)).save(os.path.join(debug_dir, f'{pid}.png'))
    print(pid, (W, H), 'wall ref', ref.astype(int), 'runs', len(runs))
