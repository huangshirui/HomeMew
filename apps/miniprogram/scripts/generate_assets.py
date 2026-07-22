"""Generate placeholder image assets for HomeMew Mini Program.

Produces the images documented in miniprogram/assets/README.md that are
referenced by wxml but not yet present:
- images/logo.png            (launch page logo)
- images/empty-family.png    (home empty state)
- images/default-avatar.png  (profile fallback avatar)

Pure Pillow-based, brand color #4CAF50. Run from anywhere:
    python scripts/generate_assets.py
"""

from PIL import Image, ImageDraw

OUT_DIR = r"c:\Users\shirui\Antigravity\HomeMew\apps\miniprogram\miniprogram\assets\images"
BRAND = (76, 175, 80, 255)        # #4CAF50
BRAND_DARK = (56, 142, 60, 255)   # #388E3C
GRAY_LIGHT = (224, 224, 224, 255) # #E0E0E0
GRAY = (158, 158, 158, 255)       # #9E9E9E
WHITE = (255, 255, 255, 255)


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_logo(size=144):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rounded_rect(d, (0, 0, size - 1, size - 1), 32, BRAND)
    # simple "house" glyph in white
    cx = size // 2
    roof_y = size * 0.30
    base_y = size * 0.70
    # roof
    d.polygon([(cx, roof_y), (size * 0.28, base_y * 0.78), (size * 0.72, base_y * 0.78)], fill=WHITE)
    # body
    d.rectangle((size * 0.36, base_y * 0.78, size * 0.64, base_y), fill=WHITE)
    return img


def make_default_avatar(size=120):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, size - 1, size - 1), fill=GRAY_LIGHT)
    # head
    hr = size * 0.16
    hcy = size * 0.40
    d.ellipse((size // 2 - hr, hcy - hr, size // 2 + hr, hcy + hr), fill=GRAY)
    # shoulders
    d.arc((size * 0.22, size * 0.52, size * 0.78, size * 1.05), start=200, end=340, fill=GRAY, width=int(size * 0.10))
    return img


def make_empty_family(size=240):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # soft rounded panel
    rounded_rect(d, (size * 0.12, size * 0.12, size * 0.88, size * 0.88), 28, (245, 246, 247, 255))
    # two simplified person silhouettes
    cx1, cx2 = size * 0.40, size * 0.62
    cy = size * 0.50
    for cx in (cx1, cx2):
        r = size * 0.10
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GRAY_LIGHT)
        d.arc((cx - r * 1.5, cy, cx + r * 1.5, cy + size * 0.30), start=200, end=340, fill=GRAY_LIGHT, width=int(size * 0.06))
    return img


def main():
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    make_logo().save(os.path.join(OUT_DIR, "logo.png"), "PNG")
    make_default_avatar().save(os.path.join(OUT_DIR, "default-avatar.png"), "PNG")
    make_empty_family().save(os.path.join(OUT_DIR, "empty-family.png"), "PNG")
    print("Wrote assets to:", OUT_DIR)
    for f in sorted(os.listdir(OUT_DIR)):
        p = os.path.join(OUT_DIR, f)
        print(f"  {f}  ({os.path.getsize(p)} bytes)")


if __name__ == "__main__":
    main()
