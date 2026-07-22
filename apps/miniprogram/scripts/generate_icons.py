"""Generate tab-bar icons from the HomeMew LOGO.

- home / home-active: derived from the LOGO image.
- calendar / task / profile: simple line icons in the same brand color.
- inactive variants are desaturated to gray.
"""

from PIL import Image, ImageDraw
import os

LOGO_PATH = r"C:\Users\shirui\AppData\Local\Temp\HomeMew LOGO.png"
OUT_DIR = r"c:\Users\shirui\Antigravity\HomeMew\apps\miniprogram\miniprogram\assets\icons"
SIZE = 81            # WeChat tab-bar icon canvas
PADDING = 12         # transparent margin so visual area ~ 57x57
STROKE = 6           # line stroke for the simple icons

# 1) Load the LOGO and detect its dominant color
logo = Image.open(LOGO_PATH).convert("RGBA")
print("LOGO size:", logo.size, "mode:", logo.mode)

# Sample a green region (avoid the rounded transparent corners
# and the white cat face in the center). We use a small grid of
# points and pick the most common non-white opaque color.
import collections
samples = []
ww, hh = logo.size
for y in range(0, hh, hh // 30):
    for x in range(0, ww, ww // 30):
        rr, gg, bb, aa = logo.getpixel((x, y))
        if aa > 200 and not (rr > 240 and gg > 240 and bb > 240):
            samples.append((rr, gg, bb))
most_common = collections.Counter(samples).most_common(1)[0][0]
r, g, b = most_common
brand_rgb = (r, g, b)
print("Sampled brand color RGB:", brand_rgb)
print("Hex: #{:02X}{:02X}{:02X}".format(r, g, b))

INACTIVE_GRAY = (122, 126, 131, 255)   # WeChat's default unselected color

os.makedirs(OUT_DIR, exist_ok=True)


def fit_logo_for_tab(icon_size: int) -> Image.Image:
    """Resize the LOGO so the visible content fits within ~57x57,
    leaving a transparent margin. Preserves the original rounded-square shape."""
    target_content = icon_size - 2 * PADDING
    src = logo.copy()
    src.thumbnail((target_content, target_content), Image.LANCZOS)
    canvas = Image.new("RGBA", (icon_size, icon_size), (0, 0, 0, 0))
    x = (icon_size - src.width) // 2
    y = (icon_size - src.height) // 2
    canvas.alpha_composite(src, (x, y))
    return canvas


def recolor(rgba_img: Image.Image, new_color) -> Image.Image:
    """Replace non-transparent pixels' RGB with new_color, keep alpha as mask."""
    _, _, _, a = rgba_img.split()
    new = Image.new("RGBA", rgba_img.size, new_color)
    new.putalpha(a)
    return new


def desaturate_to_gray(rgba_img: Image.Image) -> Image.Image:
    """Convert non-transparent pixels to a uniform gray, keep alpha."""
    _, _, _, a = rgba_img.split()
    gray_layer = Image.new("RGBA", rgba_img.size, INACTIVE_GRAY)
    gray_layer.putalpha(a)
    return gray_layer


# 2) Build the home icons from the LOGO
home_active = fit_logo_for_tab(SIZE)
home_inactive = desaturate_to_gray(home_active)

home_active.save(os.path.join(OUT_DIR, "home-active.png"), "PNG")
home_inactive.save(os.path.join(OUT_DIR, "home.png"), "PNG")
print("Wrote home.png & home-active.png")


# 3) Helper to draw a simple line icon, then we will recolor it
def make_stencil(draw_func, size=SIZE, stroke=STROKE) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_func(d, size, stroke)
    return img


BLACK = (0, 0, 0, 255)


# ---- calendar stencil ----
def draw_calendar(d, size, stroke):
    pad = PADDING + 2
    # Body rectangle (use plain rectangle; visual area already has margin)
    d.rectangle(
        (pad, pad + 6, size - pad, size - pad),
        outline=BLACK, width=stroke,
    )
    # Top header line
    d.line(
        (pad, pad + 16, size - pad, pad + 16),
        fill=BLACK, width=stroke,
    )
    # Two hangers on top
    hanger_y = pad
    for cx in (pad + 12, size - pad - 12):
        d.line((cx, hanger_y, cx, hanger_y + 10),
               fill=BLACK, width=stroke)
    # A few dots for grid
    for r in range(2):
        for c in range(3):
            x = pad + 8 + c * 14
            y = pad + 26 + r * 14
            d.rectangle((x, y, x + 5, y + 5), fill=BLACK)


# ---- task / checklist stencil ----
def draw_task(d, size, stroke):
    pad = PADDING
    # Clipboard body
    d.rectangle(
        (pad, pad + 6, size - pad, size - pad),
        outline=BLACK, width=stroke,
    )
    # Top clip rectangle
    d.rectangle(
        (size // 2 - 10, pad, size // 2 + 10, pad + 10),
        outline=BLACK, width=stroke,
    )
    # Three checkmark rows
    row_y = [pad + 22, pad + 34, pad + 46]
    for ry in row_y:
        # checkbox
        d.rectangle(
            (pad + 4, ry, pad + 14, ry + 10),
            outline=BLACK, width=stroke,
        )
        # line
        d.line((pad + 20, ry + 5, size - pad - 4, ry + 5),
               fill=BLACK, width=stroke)
    # Tick the first box to suggest "completed"
    d.line((pad + 6, pad + 26, pad + 9, pad + 29),
           fill=BLACK, width=stroke)
    d.line((pad + 9, pad + 29, pad + 13, pad + 23),
           fill=BLACK, width=stroke)


# ---- profile stencil ----
def draw_profile(d, size, stroke):
    pad = PADDING
    cx = size // 2
    # Head
    head_r = 11
    head_cy = pad + head_r + 2
    d.ellipse(
        (cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r),
        outline=BLACK, width=stroke,
    )
    # Shoulders / body as a half-ellipse arc
    d.arc(
        (pad, head_cy + 4, size - pad, size - pad + 24),
        start=200, end=340,
        fill=BLACK, width=stroke,
    )


stencils = {
    "calendar": draw_calendar,
    "task": draw_task,
    "profile": draw_profile,
}

for name, fn in stencils.items():
    stencil = make_stencil(fn)
    active = recolor(stencil, brand_rgb + (255,))
    inactive = recolor(stencil, INACTIVE_GRAY)
    active.save(os.path.join(OUT_DIR, f"{name}-active.png"), "PNG")
    inactive.save(os.path.join(OUT_DIR, f"{name}.png"), "PNG")
    print(f"Wrote {name}.png & {name}-active.png")

print("\nDone. Files in:", OUT_DIR)
for f in sorted(os.listdir(OUT_DIR)):
    p = os.path.join(OUT_DIR, f)
    print(f"  {f}  ({os.path.getsize(p)} bytes)")
