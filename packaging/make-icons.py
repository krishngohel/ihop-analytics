"""Draws the app icons from the same mark the dashboard uses (three stacked pancakes on blue).
Run once and commit the results: python3 packaging/make-icons.py   (needs Pillow; macOS for the .icns)
"""
import os
import subprocess
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets")


def stack(draw, box, color, width):
    """The mark, drawn inside box = (x0, y0, x1, y1) on the dashboard's 24-unit grid."""
    x0, y0, x1, y1 = box
    u = (x1 - x0) / 24
    p = lambda x, y: (x0 + x * u, y0 + y * u)
    draw.ellipse([*p(4, 5), *p(20, 11)], outline=color, width=width)
    for top in (9.5, 14):
        draw.arc([*p(4, top), *p(20, top + 6)], 0, 180, fill=color, width=width)


def app_icon(size=1024):
    scale = 4  # draw big, shrink for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    pad = int(s * 0.1)  # macOS icons sit inside a margin
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    top, bottom = (47, 109, 240), (24, 71, 184)
    for y in range(s):
        t = y / s
        gd.line([(0, y), (s, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, s - pad, s - pad], radius=int((s - 2 * pad) * 0.225), fill=255)
    img.paste(grad, (0, 0), mask)
    inset = int(s * 0.23)
    stack(ImageDraw.Draw(img), (inset, inset, s - inset, s - inset), (255, 255, 255, 255), int(s * 0.04))
    return img.resize((size, size), Image.LANCZOS)


def menu_icon(size=36):
    """Black on clear: macOS tints a template image for light and dark menu bars."""
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    stack(ImageDraw.Draw(img), (int(s * 0.04), int(s * 0.04), int(s * 0.96), int(s * 0.96)), (0, 0, 0, 255), int(s * 0.075))
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
icon = app_icon()
icon.save(os.path.join(OUT, "icon-1024.png"))
icon.save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
menu_icon(36).save(os.path.join(OUT, "menubar@2x.png"))
menu_icon(18).save(os.path.join(OUT, "menubar.png"))

if sys.platform == "darwin":
    iconset = os.path.join(OUT, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for pts in (16, 32, 128, 256, 512):
        icon.resize((pts, pts), Image.LANCZOS).save(os.path.join(iconset, f"icon_{pts}x{pts}.png"))
        icon.resize((pts * 2, pts * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{pts}x{pts}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "icon.icns")], check=True)
    subprocess.run(["rm", "-rf", iconset], check=True)
print("icons written to", OUT)
