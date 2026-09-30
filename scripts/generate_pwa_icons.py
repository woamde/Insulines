"""Rebuild the bundled PNG equivalents of the public GlycoSoin SVG logo.

Run only when changing the logo. Pillow is already in backend requirements;
normal frontend/Docker builds use the checked-in PNG files.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public"


def main():
    scale = 4
    image = Image.new("RGBA", (512 * scale, 512 * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 512 * scale - 1, 512 * scale - 1), radius=112 * scale, fill="#0284C7")
    points = [(96, 262), (174, 262), (212, 150), (277, 362), (316, 262), (416, 262)]
    draw.line([(x * scale, y * scale) for x, y in points], fill="white", width=28 * scale, joint="curve")
    for x, y in points:
        r = 14
        draw.ellipse(((x - r) * scale, (y - r) * scale, (x + r) * scale, (y + r) * scale), fill="white")
    for size in (192, 512):
        image.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f"pwa-icon-{size}.png", optimize=True)
        print(f"PNG {size}x{size} generated")


if __name__ == "__main__":
    main()