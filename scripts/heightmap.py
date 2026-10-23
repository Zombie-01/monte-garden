"""Download AWS Terrarium elevation tiles around Bogd Khan Uul and write a 16-bit-ish heightmap PNG."""
import math, sys, urllib.request, io
from PIL import Image

LAT, LON, Z, N = 47.845, 107.02, 12, 4  # N x N tiles
out, cache = sys.argv[1], sys.argv[2]

def tile(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

cx, cy = tile(LAT, LON, Z)
x0, y0 = int(cx - N / 2 + 0.5), int(cy - N / 2 + 0.5)
mosaic = Image.new('RGB', (256 * N, 256 * N))
for j in range(N):
    for i in range(N):
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x0+i}/{y0+j}.png'
        path = f'{cache}/{Z}_{x0+i}_{y0+j}.png'
        try:
            im = Image.open(path)
        except FileNotFoundError:
            data = urllib.request.urlopen(url).read()
            open(path, 'wb').write(data)
            im = Image.open(io.BytesIO(data))
        mosaic.paste(im.convert('RGB'), (256 * i, 256 * j))

px = mosaic.load()
W, H = mosaic.size
hs = [[px[x, y][0] * 256 + px[x, y][1] + px[x, y][2] / 256 - 32768 for x in range(W)] for y in range(H)]
lo = min(min(r) for r in hs); hi = max(max(r) for r in hs)
print('elevation range', round(lo), round(hi), 'm; tile size km', round(40075 * math.cos(math.radians(LAT)) / 2 ** Z * N, 1))
# pack normalized height into R (coarse) + G (fine) so the shader keeps 16-bit precision
img = Image.new('RGB', (W, H))
ip = img.load()
for y in range(H):
    for x in range(W):
        v = int((hs[y][x] - lo) / (hi - lo) * 65535)
        ip[x, y] = (v >> 8, v & 255, 0)
img.save(out)
print('meta', {'min': lo, 'max': hi})
