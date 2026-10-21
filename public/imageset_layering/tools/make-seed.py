"""Generate a DRAFT first-pass seed of per-floor silhouettes.

Strategy:
  - Hand-traced outer building silhouette at 8 anchor angles (0..315 step 45).
  - Split each silhouette into 4 stacked floor bands by vertical fraction.
  - Emit normalized polygons (0..1) into polygons.js.

The result is a rough draft meant to be refined in the app's draw mode.
"""
import os

W, H = 3840, 2160
FRAME_COUNT = 120

# outer building silhouette traced from full-res grid crops (full-res px, clockwise)
OUTLINES = {
    0:   [(1500, 250), (2060, 250), (2450, 555), (2900, 690), (2890, 1150), (2600, 1420), (1210, 1420), (1010, 1180), (965, 800), (955, 560)],
    15:  [(1560, 255), (2060, 255), (2410, 555), (2910, 690), (2960, 1080), (2620, 1420), (1210, 1420), (1030, 1260), (1015, 800), (1010, 560)],
    30:  [(1710, 70), (2110, 75), (2560, 380), (2880, 660), (2880, 1080), (2530, 1370), (1160, 1370), (1010, 1060), (1040, 330)],
    45:  [(1900, 70), (2120, 80), (2620, 260), (2920, 610), (2920, 1050), (2620, 1400), (1120, 1400), (1010, 1010), (1010, 610), (1060, 370)],
    60:  [(1850, 80), (2100, 90), (2600, 320), (2900, 660), (2900, 1100), (2600, 1420), (1200, 1420), (960, 1150), (960, 700), (960, 560)],
    75:  [(1800, 120), (2100, 130), (2650, 360), (2900, 660), (2880, 1100), (2550, 1400), (1150, 1400), (1000, 1100), (1000, 700), (1050, 470)],
    90:  [(1760, 190), (2060, 200), (2560, 350), (2900, 700), (2900, 1100), (2560, 1400), (1150, 1400), (1000, 1100), (1000, 700), (1060, 350)],
    105: [(1650, 230), (2060, 240), (2500, 520), (2860, 760), (2860, 1130), (2500, 1400), (1200, 1400), (1000, 1150), (985, 780), (1050, 500)],
}

# vertical band fractions (top -> bottom): tum, lung, tang2, tang1
CUTS = [0.0, 0.27, 0.49, 0.72, 1.0]
# band index (0=top) -> floor id
BAND_TO_FLOOR = [4, 3, 2, 1]


def intersections(poly, y):
    xs = []
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 <= y < y2) or (y2 <= y < y1):
            x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            xs.append(x)
    return xs


def band_polygon(poly, yA, yB, samples=7):
    left, right = [], []
    for i in range(samples):
        y = yA + (yB - yA) * i / (samples - 1)
        xs = intersections(poly, y)
        if not xs:
            continue
        left.append((min(xs), y))
        right.append((max(xs), y))
    return left + right[::-1]


def main():
    floors = {1: {}, 2: {}, 3: {}, 4: {}}
    for anchor, outline in OUTLINES.items():
        ys = [p[1] for p in outline]
        ytop, ybot = min(ys), max(ys)
        span = ybot - ytop
        for b in range(4):
            yA = ytop + CUTS[b] * span
            yB = ytop + CUTS[b + 1] * span
            pts = band_polygon(outline, yA, yB)
            norm = [[round(x / W, 5), round(y / H, 5)] for x, y in pts]
            floors[BAND_TO_FLOOR[b]][anchor] = norm

    lines = []
    lines.append("// AUTO-GENERATED DRAFT SEED - rough first pass, refine in draw mode.")
    lines.append("// Coordinates are normalized 0..1 relative to the 3840x2160 frame.")
    lines.append("window.TAV_SEED = {")
    lines.append('  draft: true,')
    lines.append('  floors: {')
    for fid in (1, 2, 3, 4):
        lines.append(f'    "{fid}": {{')
        for fr in sorted(floors[fid]):
            pts = ", ".join(f"[{x}, {y}]" for x, y in floors[fid][fr])
            lines.append(f'      "{fr}": [{pts}],')
        lines.append("    },")
    lines.append("  },")
    lines.append("};")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "polygons.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote", os.path.abspath(out))


if __name__ == "__main__":
    main()
