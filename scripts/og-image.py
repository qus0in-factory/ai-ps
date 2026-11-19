#!/usr/bin/env python3
"""OG 이미지 합성: og.json 기반으로 public/og-image.png를 생성한다."""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

BASE_TILE = 340
BASE_GAP = 32
MARGIN_X = 40
MARGIN_Y = 40

# image가 없는 라우트를 구분하기 위한 색상 팔레트(/queens는 체스보드 유지)
PLACEHOLDER_COLORS = [
    (46, 92, 130, 255),
    (110, 64, 132, 255),
    (46, 120, 92, 255),
    (140, 86, 52, 255),
    (52, 110, 120, 255),
    (128, 60, 78, 255),
]


def compute_layout(width, height, count):
    """타일 개수와 무관하게 여백을 두고 캔버스 안에 들어가는 배치를 계산한다."""
    if count <= 0:
        return 0, 0, 0, 0
    margin_x = min(MARGIN_X, max(0, width // 20))
    margin_y = min(MARGIN_Y, max(0, height // 20))
    available_w = max(count, width - 2 * margin_x)
    available_h = max(1, height - 2 * margin_y)
    # 간격을 먼저 줄이고, 남은 폭으로 정사각형 타일을 맞춘다.
    gap = min(BASE_GAP, max(0, available_w // (count * 4)))
    tile = min(BASE_TILE, available_h, max(1, (available_w - gap * (count - 1)) // count))
    total = tile * count + gap * (count - 1)
    return tile, gap, (width - total) // 2, (height - tile) // 2


def _load_font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # 오래된 Pillow 폴백
        return ImageFont.load_default()


def _fit_font(draw, label, size):
    desired = max(10, size // 7)
    limit = size - max(8, size // 10)
    while desired >= 8:
        font = _load_font(desired)
        box = draw.textbbox((0, 0), label, font=font)
        if box[2] - box[0] <= limit:
            return font, box
        desired -= 2
    font = _load_font(8)
    return font, draw.textbbox((0, 0), label, font=font)


def make_placeholder_tile(size, route):
    """image가 없는 항목용 라우트별 플레이스홀더. 외부 자산·의존성 없이 그린다."""
    label = route or "/?"
    if label == "/queens":
        return make_queens_tile(size)

    color = PLACEHOLDER_COLORS[sum(ord(char) for char in label) % len(PLACEHOLDER_COLORS)]
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.rectangle((0, 0, size - 1, size - 1), fill=color)

    stripe = tuple(channel // 2 for channel in color[:3]) + (255,)
    step = max(8, size // 8)
    for offset in range(-size, size * 2, step):
        draw.line((offset, 0, offset + size, size), fill=stripe, width=max(1, size // 96))
    draw.rectangle((0, 0, size - 1, size - 1), outline=(255, 255, 255, 90), width=max(1, size // 128))

    font, box = _fit_font(draw, label, size)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    pad = max(4, size // 24)
    left = (size - text_width) // 2 - box[0]
    top = (size - text_height) // 2 - box[1]
    draw.rectangle(
        (left - pad, top - pad, left + text_width + pad, top + text_height + pad),
        fill=(11, 16, 38, 235),
    )
    draw.text((left, top), label, font=font, fill=(255, 255, 255, 255))
    return tile


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
    tile_size, gap, x, y = compute_layout(width, height, len(features))

    for feature in features:
        image_path = feature.get("image")
        if image_path:
            full_path = os.path.join(root, "public", str(image_path).lstrip("/"))
            if not os.path.exists(full_path):
                print(f"Missing OG source image: {image_path}", file=sys.stderr)
                return 1
            image = Image.open(full_path).convert("RGBA")
            image = image.resize((tile_size, tile_size), Image.Resampling.NEAREST)
        else:
            image = make_placeholder_tile(tile_size, str(feature.get("route", "")))
        canvas.alpha_composite(image, (x, y))
        x += tile_size + gap

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    canvas.convert("RGB").save(args.output, format="PNG")
    print(f"OG_IMAGE {args.output} ({width}x{height}) features={len(features)} tile={tile_size} gap={gap}")
    return 0


def make_queens_tile(size):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    cells = 8
    cell = max(1, size // cells)
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
