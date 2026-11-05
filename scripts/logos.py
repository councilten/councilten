"""Prepare the uploaded logo files for the site: clear white backgrounds (flood fill from the edges, so
white inside a logo stays), trim, centre on a square canvas, and write a dark-theme variant where the
logo is black. Output: public/logos/<key>.png and <key>-dark.png.
Usage: python3 scripts/logos.py <attachments dir>"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public" / "logos"
OUT.mkdir(parents=True, exist_ok=True)

# key: (light file, dark file or "recolor" or None, square?)
FILES = {
    "venice": ("335c55d9-image.png", "f65dfaee-image.png", True),
    "claude": ("4a3d8b3f-image.png", None, True),
    "gpt": ("4d5d35e9-image.png", "ca0be514-image.png", True),
    "grok": ("bd7347bc-image.png", "f7e844b6-image.png", True),
    "gemini": ("24cd8882-image.webp", None, True),
    "deepseek": ("7d53fdd6-image.png", None, True),
    "kimi": ("5e39a717-image.png", "fcc829cb-image.png", True),
    "qwen": ("d7d480d1-image.png", None, True),
    "glm": ("4438753b-image.png", "recolor", True),
    "mistral": ("ee4cdef5-image.png", None, True),
    "solana": ("a46af5c0-image.jpg", None, True),
    "usdc": ("59b77728-image.png", None, True),
    "x402": ("0c0db5eb-image.png", "recolor", False),
}
CREAM = (243, 238, 229)


def white_to_alpha(im: Image.Image) -> Image.Image:
    """For pure black marks: every pixel's whiteness becomes transparency (also inside closed shapes)."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = px[x, y]
            al = 1 - min(r, g, b) / 255
            px[x, y] = (0, 0, 0, int(a * al))
    return im


def clear_white_edges(im: Image.Image, through_clear=False) -> Image.Image:
    """Make the white background transparent: flood fill near-white pixels connected to the border,
    then soften a one-pixel ring with colour-to-alpha so edges stay smooth."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    if not through_clear and all(px[x, y][3] < 250 for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]):
        return im  # already transparent
    # through_clear: a white tile sitting on a transparent canvas is background too (app-icon files)
    near = (lambda p: p[3] == 0 or min(p[:3]) >= 232) if through_clear else (lambda p: p[3] > 0 and min(p[:3]) >= 232)
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near(px[x, y]): q.append((x, y)); seen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if near(px[x, y]) and not seen[y * w + x]: q.append((x, y)); seen[y * w + x] = 1
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and near(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    ring = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x]:
                px[x, y] = (255, 255, 255, 0)
            elif any(0 <= x + dx < w and 0 <= y + dy < h and seen[(y + dy) * w + x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                ring.append((x, y))
    for x, y in ring:  # colour to alpha against white on the edge pixels only
        r, g, b, a = px[x, y]
        al = max(255 - r, 255 - g, 255 - b) / 255
        if al <= 0:
            px[x, y] = (255, 255, 255, 0)
            continue
        f = lambda c: int(max(0, min(255, (c - 255 * (1 - al)) / al)))
        px[x, y] = (f(r), f(g), f(b), int(a * al))
    return im


def recolor_dark(im: Image.Image) -> Image.Image:
    """Black or near-black, unsaturated pixels become cream; colour stays as it is."""
    im = im.copy()
    px = im.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = px[x, y]
            if a and max(r, g, b) < 110 and max(r, g, b) - min(r, g, b) < 30:
                px[x, y] = (*CREAM, a)
    return im


def fit(im: Image.Image, square: bool, size=96, margin=0.06) -> Image.Image:
    bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(bb)
    if not square:
        h = 48
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        return im
    inner = round(size * (1 - 2 * margin))
    s = inner / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


MONO = {"x402"}
TILE = {"deepseek"}
for key, (light, dark, square) in FILES.items():
    raw = Image.open(SRC / light)
    base = white_to_alpha(raw) if key in MONO else clear_white_edges(raw, through_clear=key in TILE)
    fit(base, square).save(OUT / f"{key}.png", optimize=True)
    if dark == "recolor":
        fit(recolor_dark(base), square).save(OUT / f"{key}-dark.png", optimize=True)
    elif dark:
        fit(clear_white_edges(Image.open(SRC / dark)), square).save(OUT / f"{key}-dark.png", optimize=True)
    print(key, "ok")
