#!/usr/bin/env python3
"""Build every icon the site needs from one square source image.

    python3 tools/make-icons.py assets/brand-r.png

Three families come out of this, and they are deliberately not the same
image, because the platforms treat them differently:

  favicon        Rounded corners, transparent outside the radius. This is
                 the tab icon, drawn on whatever colour the browser
                 chrome happens to be, so transparency is correct here.

  apple-touch    Square, fully opaque, no rounding. iOS masks the icon to
                 its own squircle and paints any transparent pixel BLACK.
                 Rounding it ourselves would show black wedges in the
                 corners on the home screen, so we hand iOS a full bleed
                 square and let it do the cutting.

  android        Square and opaque as well, and the same file serves both
                 "any" and "maskable". Android crops to whatever shape the
                 launcher uses and only guarantees the middle 80 percent,
                 but the R already sits inside that, and inside the circle
                 a round launcher cuts, so it needs no insetting. Padding
                 it would only put a flat band around the leather.
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent

# Corner radius as a share of the icon's width. Subtle on purpose: enough
# to read as a rounded square, not so much it turns into a lozenge.
RADIUS_RATIO = 0.16

FAVICON_SIZES = [16, 32, 48, 64]
ICO_SIZES = [16, 32, 48]


def load_square(path: Path) -> Image.Image:
    """Open the source and centre crop it to a square."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w != h:
        side = min(w, h)
        im = im.crop(((w - side) // 2, (h - side) // 2,
                      (w - side) // 2 + side, (h - side) // 2 + side))
        print(f"  source was {w}x{h}, centre cropped to {side}x{side}")
    return im


def rounded(im: Image.Image, size: int, ratio: float) -> Image.Image:
    """Square image in, rounded square with transparent corners out.

    The mask is built at 8x and averaged down, so each edge pixel ends up
    with its true coverage and the curve reads smooth rather than stair
    stepped at 16 and 32 pixels.

    BOX, not LANCZOS: area averaging gives true coverage on a hard edge,
    where Lanczos can ring. Note the 16px corner still lands around alpha
    24 either way, and that is correct rather than a defect. A 16 percent
    radius on a 16 pixel icon is 2.5 pixels, so the curve really does cut
    through that first pixel and it earns about 9 percent coverage.
    """
    im = im.resize((size, size), Image.LANCZOS).convert("RGBA")
    scale = 8
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=round(size * scale * ratio), fill=255)
    im.putalpha(mask.resize((size, size), Image.BOX))
    return im


def square(im: Image.Image, size: int) -> Image.Image:
    """Opaque square, no rounding. For iOS and for maskable Android."""
    return im.resize((size, size), Image.LANCZOS).convert("RGB")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = REPO / src
    if not src.exists():
        print(f"Source not found: {src}")
        return 1

    out = REPO / "assets" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    im = load_square(src)
    try:
        shown = src.relative_to(REPO)
    except ValueError:
        shown = src
    print(f"  source {shown} {im.size[0]}x{im.size[1]}")

    written = []

    # Tab icon: rounded, transparent corners.
    for s in FAVICON_SIZES:
        p = out / f"favicon-{s}.png"
        rounded(im, s, RADIUS_RATIO).save(p)
        written.append(p)

    ico = out / "favicon.ico"
    rounded(im, 256, RADIUS_RATIO).save(
        ico, sizes=[(s, s) for s in ICO_SIZES])
    written.append(ico)

    # Browsers ask for /favicon.ico at the root whatever the link tags
    # say, so there is a copy there to answer them.
    root_ico = REPO / "favicon.ico"
    root_ico.write_bytes(ico.read_bytes())
    written.append(root_ico)

    # iOS home screen: square and opaque, iOS rounds it itself.
    p = out / "apple-touch-icon.png"
    square(im, 180).save(p, optimize=True)
    written.append(p)

    # Android / PWA. One file per size, declared as any and maskable both.
    for s in (192, 512):
        p = out / f"icon-{s}.png"
        square(im, s).save(p, optimize=True)
        written.append(p)

    for p in written:
        print(f"  {p.relative_to(REPO)}  {p.stat().st_size:,} bytes")
    print(f"\n{len(written)} files written to assets/icons/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
