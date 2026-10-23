"""Find the white numbered room markers (circles) on each cropped plan; save centres + an index sheet for labelling."""
import json, sys, glob, os
import cv2
import numpy as np

plan_dir, out_json, dbg_dir = sys.argv[1:4]
os.makedirs(dbg_dir, exist_ok=True)
res = {}
for f in sorted(glob.glob(os.path.join(plan_dir, '*.webp'))):
    pid = os.path.basename(f)[:-5]
    rgba = cv2.imread(f, cv2.IMREAD_UNCHANGED)
    bgr = rgba[..., :3]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    white = ((gray > 225) & (hsv[..., 1] < 40)).astype(np.uint8) * 255
    found = []
    for thr in (240, 228, 215, 195):
        white = ((gray > thr) & (hsv[..., 1] < 50)).astype(np.uint8)
        cnts, hier = cv2.findContours(white, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if hier is None:
            continue
        for i, c in enumerate(cnts):
            if hier[0][i][3] != -1 or hier[0][i][2] == -1:
                continue  # want outer contours that enclose a hole (a ring)
            (x, y), r = cv2.minEnclosingCircle(c)
            if not 11 <= r <= 42:
                continue
            area = cv2.contourArea(c)
            if area / (np.pi * r * r) < 0.78:
                continue
            ring = area - sum(cv2.contourArea(cnts[j]) for j in range(len(cnts)) if hier[0][j][3] == i)
            if ring / area > 0.6:
                continue  # solid white blob (lamp, plate), not a ring
            if all(np.hypot(x - fx, y - fy) > 10 for fx, fy, _ in found):
                found.append([float(x), float(y), float(r)])
    res[pid] = {'size': [bgr.shape[1], bgr.shape[0]], 'markers': found}
    dbg = bgr.copy()
    for i, (x, y, r) in enumerate(found):
        cv2.circle(dbg, (int(x), int(y)), int(r), (0, 0, 255), 2)
        cv2.putText(dbg, str(i), (int(x + r), int(y - r)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 0, 255), 2)
    cv2.imwrite(os.path.join(dbg_dir, f'{pid}.jpg'), dbg)
    print(pid, len(found))
json.dump(res, open(out_json, 'w'))
