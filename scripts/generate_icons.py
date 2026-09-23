"""Generate the app's simple monogram icons. Requires Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ASSETS = Path(__file__).resolve().parents[1] / "assets"
GEORGIA = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
BROWN = "#271B19"
PANEL = "#3A2925"
GOLD = "#C5A77A"
PINK = "#E4B9B4"
SAGE = "#B4C4A8"


def monogram(size: int, transparent: bool = False, monochrome: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else BROWN)
    draw = ImageDraw.Draw(image)
    inset = int(size * 0.10)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=int(size * 0.20),
        fill=(0, 0, 0, 0) if transparent else PANEL,
        outline="#FFFFFF" if monochrome else GOLD,
        width=max(2, int(size * 0.012)),
    )
    font = ImageFont.truetype(GEORGIA, int(size * 0.48))
    text = "N"
    bounds = draw.textbbox((0, 0), text, font=font)
    x = (size - (bounds[2] - bounds[0])) / 2 - bounds[0]
    y = (size - (bounds[3] - bounds[1])) / 2 - bounds[1] - size * 0.035
    draw.text((x, y), text, font=font, fill="#FFFFFF" if monochrome else PINK)
    dot_y = int(size * 0.74)
    dot_r = max(2, int(size * 0.023))
    draw.ellipse((size / 2 - dot_r, dot_y - dot_r, size / 2 + dot_r, dot_y + dot_r), fill="#FFFFFF" if monochrome else SAGE)
    return image


def adaptive_icon(monochrome: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    artwork = monogram(700, transparent=True, monochrome=monochrome)
    canvas.alpha_composite(artwork, (162, 162))
    return canvas


monogram(1024).convert("RGB").save(ASSETS / "icon.png")
adaptive_icon().save(ASSETS / "android-icon-foreground.png")
adaptive_icon(monochrome=True).save(ASSETS / "android-icon-monochrome.png")
Image.new("RGB", (1024, 1024), BROWN).save(ASSETS / "android-icon-background.png")
monogram(512, transparent=True).save(ASSETS / "splash-icon.png")
monogram(64).convert("RGB").save(ASSETS / "favicon.png")
