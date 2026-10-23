"""Re-colour the painted master plan into a realistic aerial ground texture and draw the traced road network."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

src, roads_json, buildings_json, out = sys.argv[1:5]
N = 2048
img = Image.open(src).convert('RGB').resize((N, N), Image.LANCZOS)
a = np.asarray(img).astype(float)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
lum = a.mean(-1)

water = (B > R + 22) & (B > G - 16) & (lum > 100)
water = ndimage.binary_closing(ndimage.binary_opening(water, iterations=1), iterations=3)
reddish = ndimage.binary_dilation(R - G > 16, iterations=2)  # labels, red paths, plan title, warm pads
turf = (G > R + 22) & (G > B + 40) & (lum > 120)
trees = (G > R + 6) & (G > B + 18) & (R < 165) & (G < 185) & ~reddish

rng = np.random.default_rng(3)
def smooth_noise(sigma):
    n = ndimage.gaussian_filter(rng.random((N, N)), sigma)
    return (n - n.min()) / (n.max() - n.min())
n1, n2 = smooth_noise(30), smooth_noise(4)

grass_a = np.array([88, 120, 52.0])
grass_b = np.array([128, 152, 74.0])
t = (n1 * 0.7 + n2 * 0.3)[..., None]
out_a = grass_a * (1 - t) + grass_b * t
forest = np.array([40, 64, 34.0]) * (0.8 + 0.4 * n2[..., None])
out_a = np.where(trees[..., None], forest, out_a)
out_a = np.where(turf[..., None], np.array([82, 148, 66.0]), out_a)
out_a = np.where(water[..., None], np.array([64, 124, 146.0]) + (B[..., None] - 180) * 0.3, out_a)

base = Image.fromarray(np.clip(out_a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
d = ImageDraw.Draw(base)

def catmull(pts, steps=10):
    pts = [pts[0]] + pts + [pts[-1]]
    res = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = map(np.array, pts[i - 1:i + 3])
        for s in range(steps):
            u = s / steps
            res.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    res.append(np.array(pts[-2]))
    return [(float(x * N), float(y * N)) for x, y in res]

# driveway / garden paving under each villa
for b in json.load(open(buildings_json)):
    cx, cy, w, h, ang = b['x'] * N, b['y'] * N, b['w'] * N * 1.35, b['d'] * N * 1.35, b['a']
    ca, sa = np.cos(ang), np.sin(ang)
    poly = [(cx + ca * sx * w / 2 - sa * sy * h / 2, cy + sa * sx * w / 2 + ca * sy * h / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    d.polygon(poly, fill=(176, 170, 156))

roads = json.load(open(roads_json))
for kind, width in (('streets', 12), ('main', 18)):
    for line in roads[kind]:
        pts = catmull(line)
        d.line(pts, fill=(196, 190, 176), width=width + 6, joint='curve')  # kerb / sidewalk
        d.line(pts, fill=(78, 81, 85), width=width, joint='curve')
        for p in (pts[0], pts[-1]):
            d.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=(78, 81, 85))
for line in roads['main']:
    pts = catmull(line, 24)
    for i in range(0, len(pts) - 1, 6):
        d.line([pts[i], pts[min(i + 2, len(pts) - 1)]], fill=(214, 210, 196), width=1)
# roundabout island
cx, cy = 0.725 * N, 0.19 * N
d.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), fill=(78, 81, 85))
d.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=(96, 136, 60))

base.save(out, quality=88, optimize=True, progressive=True)
print('saved', out)
