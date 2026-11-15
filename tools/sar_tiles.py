#!/usr/bin/env python3
"""Make the map tiles for the SAR pair viewer (site/sar-viewer/) from two Sentinel-1 GRD TIFFs.

    python3 tools/sar_tiles.py BEFORE.tiff AFTER.tiff [--out site/sar-viewer/tiles] [--res 80]

The TIFFs carry no map projection, only ground control points (lon/lat for a grid of pixels), as in the user's
viewer (geo_utils.py). Both scenes are warped from their GCPs with a thin-plate spline (GDAL's GCP_TPS, the same
transform geo_utils.py fits with scipy) onto one shared grid in Antarctic polar stereographic (EPSG:3031) at --res
metres a pixel, averaging the pixels that fall in each cell.

Brightness is in decibels (20 log10 of the amplitude), stretched to 8 bits with one stretch for both dates (their
pooled 2nd to 98th percentiles), so the two read the same. No-data is transparent.

It writes WebP tiles, 256 px, z/x/y, for zoom levels 0..Z (Z is full resolution):
  before/, after/   each scene in gray
  overlay/          red = before, cyan = after, only where both have data
and meta.json, with the tiles that exist (empty ones aren't written), the grid (origin, resolution, size), the zoom levels, the scene dates, each scene's footprint
and their overlap (convex hulls of the GCPs, in full-resolution pixels), and a few GCPs per scene for checking
alignment. Needs rasterio, numpy, Pillow.
"""
import argparse, json, math, re, shutil
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform as warp_points
from PIL import Image

TILE = 256
DST = CRS.from_epsg(3031)


def scene_date(path):
    """The start time from a Sentinel-1 file name, as ISO 8601 UTC."""
    m = re.search(r"(\d{8})t(\d{6})", Path(path).name.lower())
    d, t = m.group(1), m.group(2)
    return "%s-%s-%sT%s:%s:%sZ" % (d[:4], d[4:6], d[6:], t[:2], t[2:4], t[4:])


def gcps_xy(gcps):
    """GCPs as arrays: pixel col, row and EPSG:3031 x, y."""
    lon = [g.x for g in gcps]
    lat = [g.y for g in gcps]
    x, y = warp_points(CRS.from_epsg(4326), DST, lon, lat)
    return np.array([g.col for g in gcps]), np.array([g.row for g in gcps]), np.array(x), np.array(y), np.array(lon), np.array(lat)


def hull(points):
    """Convex hull of 2-D points, counter-clockwise (monotone chain)."""
    pts = sorted(map(tuple, points))
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out
    lower, upper = half(pts), half(reversed(pts))
    return lower[:-1] + upper[:-1]


def clip(subject, clipper):
    """Sutherland-Hodgman: the part of convex polygon `subject` inside convex polygon `clipper` (both CCW)."""
    def inside(p, a, b):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
    def cross(p, q, a, b):
        x1, y1, x2, y2, x3, y3, x4, y4 = *p, *q, *a, *b
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    out = list(subject)
    for i in range(len(clipper)):
        a, b = clipper[i], clipper[(i + 1) % len(clipper)]
        src, out = out, []
        for j in range(len(src)):
            p, q = src[j], src[(j + 1) % len(src)]
            if inside(q, a, b):
                if not inside(p, a, b):
                    out.append(cross(p, q, a, b))
                out.append(q)
            elif inside(p, a, b):
                out.append(cross(p, q, a, b))
    return out


def warp(path, dst_transform, shape):
    """The scene's amplitude on the shared grid, float32, NaN where there's no data."""
    with rasterio.open(path) as src:
        gcps, gcp_crs = src.gcps
        data = src.read(1).astype(np.float32)
    data[data == 0] = np.nan
    out = np.full(shape, np.nan, np.float32)
    reproject(data, out, gcps=gcps, src_crs=gcp_crs, src_nodata=np.nan, dst_transform=dst_transform, dst_crs=DST,
              dst_nodata=np.nan, resampling=Resampling.average, SRC_METHOD="GCP_TPS", num_threads=4)
    return out


def to_db(a):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 20 * np.log10(a)


def save_tiles(name, rgba, z, out, quality, index):
    """One zoom level of tiles; tiles with nothing in them aren't written (index lists the ones that are).
    Returns the count and bytes."""
    h, w = rgba.shape[:2]
    n = size = 0
    have = []
    for ty in range(math.ceil(h / TILE)):
        for tx in range(math.ceil(w / TILE)):
            t = rgba[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
            if not t[..., 3].any():
                continue
            if t.shape[0] < TILE or t.shape[1] < TILE:
                t = np.pad(t, ((0, TILE - t.shape[0]), (0, TILE - t.shape[1]), (0, 0)))
            f = out / name / str(z) / str(tx) / ("%d.webp" % ty)
            f.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(t, "RGBA").save(f, "WEBP", quality=quality, alpha_quality=60, method=6)
            n += 1
            size += f.stat().st_size
            have.append("%d/%d" % (tx, ty))
    index.setdefault(name, {})[str(z)] = have
    return n, size


def downsample(a):
    """Halve a float image (NaN = no data) by averaging 2x2 blocks, ignoring NaNs."""
    h, w = a.shape
    a = np.pad(a, ((0, h % 2), (0, w % 2)), constant_values=np.nan)
    b = a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2)
    with np.errstate(invalid="ignore"), __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore", RuntimeWarning)
        return np.nanmean(b, axis=(1, 3))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--out", default="site/sar-viewer/tiles")
    ap.add_argument("--res", type=float, default=80, help="metres a pixel at full zoom (Sentinel-1 EW GRDM is 40)")
    ap.add_argument("--quality", type=int, default=55, help="WebP quality for the tiles")
    args = ap.parse_args()
    out = Path(args.out)

    scenes = []
    for p in (args.before, args.after):
        with rasterio.open(p) as src:
            gcps, _ = src.gcps
        scenes.append(dict(path=p, gcps=gcps_xy(gcps), date=scene_date(p)))

    # The shared grid: the union of both scenes' GCP extents, padded a little.
    xs = np.concatenate([s["gcps"][2] for s in scenes])
    ys = np.concatenate([s["gcps"][3] for s in scenes])
    pad = 5 * args.res
    x0, y1 = xs.min() - pad, ys.max() + pad
    w = int(math.ceil((xs.max() + pad - x0) / args.res))
    h = int(math.ceil((y1 - (ys.min() - pad)) / args.res))
    dst_transform = from_origin(x0, y1, args.res, args.res)
    print("grid %d x %d at %g m" % (w, h, args.res))

    amps = [warp(s["path"], dst_transform, (h, w)) for s in scenes]
    dbs = [to_db(a) for a in amps]
    pooled = np.concatenate([d[np.isfinite(d)] for d in dbs])
    lo, hi = (float(v) for v in np.percentile(pooled, (2, 98)))
    print("stretch %.1f..%.1f dB" % (lo, hi))

    # Zoom levels: Z is full resolution; 0 is the level where the whole grid fits in about one tile.
    zmax = max(0, math.ceil(math.log2(max(w, h) / TILE)))
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    stats, index = {}, {}
    level = amps
    for z in range(zmax, -1, -1):
        d = [to_db(a) for a in level]
        g = [np.clip((x - lo) / (hi - lo), 0, 1) for x in d]
        ok = [np.isfinite(x) for x in d]
        u8 = [np.nan_to_num(x * 255, nan=0).round().astype(np.uint8) for x in g]
        for name, v, m in (("before", u8[0], ok[0]), ("after", u8[1], ok[1])):
            rgba = np.dstack([v, v, v, np.where(m, 255, 0).astype(np.uint8)])
            n, b = save_tiles(name, rgba, z, out, args.quality, index)
            stats[name] = [stats.get(name, [0, 0])[0] + n, stats.get(name, [0, 0])[1] + b]
        both = ok[0] & ok[1]
        rgba = np.dstack([u8[0], u8[1], u8[1], np.where(both, 255, 0).astype(np.uint8)])
        n, b = save_tiles("overlay", rgba, z, out, args.quality, index)
        stats["overlay"] = [stats.get("overlay", [0, 0])[0] + n, stats.get("overlay", [0, 0])[1] + b]
        level = [downsample(a) for a in level]

    # Footprints and overlap, as convex hulls of the GCPs (as in geo_utils.py), in full-resolution grid pixels.
    def px(x, y):
        return ((x - x0) / args.res, (y1 - y) / args.res)
    feet = []
    for s in scenes:
        _, _, gx, gy, _, _ = s["gcps"]
        # Grid pixels have y going down, which flips the winding; hull() wants y up, so hull in (x, -y).
        hp = hull([(a, -b) for a, b in (px(x, y) for x, y in zip(gx, gy))])
        feet.append(hp)
    overlap = clip(feet[0], feet[1])
    flip = lambda poly: [[round(a, 1), round(-b, 1)] for a, b in poly]

    # A few GCPs per scene for checking the alignment: the source pixel, its lon/lat, where it lands on the grid.
    checks = []
    for s in scenes:
        col, row, gx, gy, lon, lat = s["gcps"]
        idx = np.linspace(0, len(col) - 1, 9).round().astype(int)
        checks.append([dict(col=float(col[i]), row=float(row[i]), lon=float(lon[i]), lat=float(lat[i]),
                            gx=round(px(gx[i], gy[i])[0], 2), gy=round(px(gx[i], gy[i])[1], 2)) for i in idx])

    meta = dict(
        crs="EPSG:3031", origin=[float(x0), float(y1)], res=args.res, width=w, height=h, tile=TILE, maxZoom=zmax,
        stretch_db=[round(lo, 2), round(hi, 2)],
        scenes=[dict(date=s["date"], file=Path(s["path"]).name, footprint=flip(f), gcp_checks=c)
                for s, f, c in zip(scenes, feet, checks)],
        overlap=flip(overlap),
        tiles=index,
    )
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    total = sum(b for _, b in stats.values())
    for k, (n, b) in stats.items():
        print("%-8s %4d tiles  %6.2f MB" % (k, n, b / 1e6))
    print("total    %.2f MB, zoom 0..%d" % (total / 1e6, zmax))


if __name__ == "__main__":
    main()
