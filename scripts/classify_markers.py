"""Read the digit inside each room marker by template-matching against hand-labelled markers from one plan."""
import json, sys
import cv2
import numpy as np

plan_dir, markers_json, ref_pid, ref_labels, out_json = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4]), sys.argv[5]
M = json.load(open(markers_json))

def glyph(pid, x, y, r):
    g = cv2.cvtColor(cv2.imread(f'{plan_dir}/{pid}.webp')[..., :3], cv2.COLOR_BGR2GRAY)
    k = int(r * 0.72)
    c = g[max(0, int(y) - k): int(y) + k, max(0, int(x) - k): int(x) + k]
    c = cv2.resize(c, (40, 40))
    # digits are the brightest strokes inside the ring
    t = np.percentile(c, 82)
    b = (c >= max(t, c.mean() + 20)).astype(np.float32)
    ys, xs = np.nonzero(b)
    if len(xs) == 0:
        return b
    b = b[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    h, w = b.shape
    s = 30 / max(h, w)
    b = cv2.resize(b, (max(1, int(w * s)), max(1, int(h * s))))
    out = np.zeros((32, 32), np.float32)
    oy, ox = (32 - b.shape[0]) // 2, (32 - b.shape[1]) // 2
    out[oy: oy + b.shape[0], ox: ox + b.shape[1]] = b
    return cv2.GaussianBlur(out, (5, 5), 0)

templates = {}
for i, num in ref_labels.items():
    x, y, r = M[ref_pid]['markers'][int(i)]
    templates[num] = glyph(ref_pid, x, y, r)

def score(a, b):
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-6))

result = {}
for pid, d in M.items():
    labelled = []
    for (x, y, r) in d['markers']:
        g = glyph(pid, x, y, r)
        best = sorted(((score(g, t), n) for n, t in templates.items()), reverse=True)
        labelled.append({'n': best[0][1], 'x': x, 'y': y, 'conf': round(best[0][0], 2), 'alt': best[1][1]})
    result[pid] = {'size': d['size'], 'markers': labelled}
    print(pid, sorted(m['n'] for m in labelled), [m['conf'] for m in labelled if m['conf'] < 0.6])
json.dump(result, open(out_json, 'w'))
