import os
from PIL import Image

SRC = r"D:\Projects\Work\TAV 360 imageset layering\261002_SEQUENCE"
DST = r"D:\Projects\Work\TAV 360 imageset layering\frames"
W = 1920

os.makedirs(DST, exist_ok=True)
files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
total = len(files)
print(f"Found {total} frames -> {W}px wide WebP", flush=True)

for i, f in enumerate(files):
    stem = os.path.splitext(f)[0]
    out = os.path.join(DST, stem + ".webp")
    if os.path.exists(out):
        print(f"[{i + 1}/{total}] skip {stem}", flush=True)
        continue
    img = Image.open(os.path.join(SRC, f)).convert("RGB")
    if img.width != W:
        h = round(img.height * W / img.width)
        img = img.resize((W, h), Image.LANCZOS)
    img.save(out, "WEBP", quality=80, method=4)
    print(f"[{i + 1}/{total}] {stem}.webp", flush=True)

print("DONE", flush=True)
