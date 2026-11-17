#!/usr/bin/env python3
"""OG 이미지 합성: og.json 기반으로 public/og-image.png를 생성한다."""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("output")
    args = parser.parse_args(argv)

    with open(args.manifest, encoding="utf-8") as handle:
        config = json.load(handle)

    width = int(config["image"]["width"])
    height = int(config["image"]["height"])
    background = config.get("background", "#0B1026")
    root = os.path.dirname(os.path.dirname(os.path.abspath(args.manifest)))

    canvas = Image.new("RGBA", (width, height), background)
    features = sorted(config.get("features", []), key=lambda item: (-int(item.get("weight", 0)), item.get("route", "")))

    tile = 340
    gap = 32
    total = len(features) * tile + max(0, len(features) - 1) * gap
    x = (width - total) // 2
    y = (height - tile) // 2

    for feature in features:
        image_path = feature.get("image")
        if image_path:
            full_path = os.path.join(root, "public", str(image_path).lstrip("/"))
            if not os.path.exists(full_path):
                print(f"Missing OG source image: {image_path}", file=sys.stderr)
                return 1
            image = Image.open(full_path).convert("RGBA")
            image = image.resize((tile, tile), Image.Resampling.NEAREST)
        else:
            image = make_queens_tile(tile)
        canvas.alpha_composite(image, (x, y))
        x += tile + gap

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    canvas.convert("RGB").save(args.output, format="PNG")
    print(f"OG_IMAGE {args.output} ({width}x{height}) features={len(features)}")
    return 0


def make_queens_tile(size):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    cells = 8
    cell = size // cells
    region_colors = [
        (60, 80, 110, 255), (40, 55, 75, 255), (80, 100, 130, 255),
        (30, 40, 60, 255), (70, 90, 120, 255),
    ]
    for row in range(cells):
        for col in range(cells):
            color = (24, 30, 46, 255) if (row + col) % 2 == 0 else (32, 40, 58, 255)
            draw.rectangle((col * cell, row * cell, (col + 1) * cell - 1, (row + 1) * cell - 1), fill=color)
    # color regions
    for row in range(2, 5):
        for col in range(1, 4):
            draw.rectangle((col * cell, row * cell, (col + 1) * cell - 1, (row + 1) * cell - 1), fill=region_colors[0])
    for row in range(4, 7):
        for col in range(4, 7):
            draw.rectangle((col * cell, row * cell, (col + 1) * cell - 1, (row + 1) * cell - 1), fill=region_colors[2])
    # queens
    for row, col in ((0, 0), (1, 3), (2, 5), (3, 1), (4, 6), (5, 2), (6, 4), (7, 7)):
        cx = col * cell + cell // 2
        cy = row * cell + cell // 2
        r = cell // 3
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(251, 191, 36, 255))
    return tile


if __name__ == "__main__":
    sys.exit(main())
