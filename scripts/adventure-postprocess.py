#!/usr/bin/env python3
"""adventure 에셋 후처리: 마젠타 키잉 → 16색 리맵 → NEAREST 축소.

`--palette-swap from=to,...` 는 기존 산출물의 팔레트 색만 치환하고 알파를 그대로 보존한다.
stdlib + Pillow 만 사용하며 `python3 -I scripts/adventure-postprocess.py ...` 로 실행한다.
"""
import argparse
from collections import deque
import os
import sys

from PIL import Image, ImageChops


# design.md §6 팔레트 계열: 남색 3 · 회색 3 · 호박 3 · 피부/모래 3 · 외투 노랑 2 · 검정 · 흰색
PALETTE = [
    "#0B1026", "#16264F", "#274A7A",
    "#4A5568", "#7A8799", "#B8C2CC",
    "#7A3E00", "#D97706", "#FBBF24",
    "#7A4A2B", "#C98A5E", "#EBC9A0",
    "#B8860B", "#F2C94C", "#000000", "#FFFFFF",
]


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def palette_image(path):
    image = Image.new("P", (16, 1))
    flat = [channel for color in PALETTE for channel in rgb(color)]
    image.putpalette(flat)
    if path:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        image.save(path)
    return Image.open(path) if path else image


def parse_swaps(spec):
    swaps = {}
    for item in spec.split(','):
        source, target = item.split('=')
        swaps[rgb(source)] = rgb(target)
    return swaps


def apply_swaps(image, swaps):
    output = image.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue = pixels[x, y]
            if (red, green, blue) in swaps:
                pixels[x, y] = swaps[(red, green, blue)]
    return output


def key_magenta(image, tolerance):
    red, green, blue = image.convert("RGB").split()
    high = 255 - tolerance
    mask_r = red.point(lambda v: 255 if v >= high else 0)
    mask_g = green.point(lambda v: 255 if v <= tolerance else 0)
    mask_b = blue.point(lambda v: 255 if v >= high else 0)
    magenta = ImageChops.multiply(ImageChops.multiply(mask_r, mask_g), mask_b)
    alpha = ImageChops.invert(magenta)
    return alpha, magenta.getbbox() is not None


def corner_background_mask(image, tolerance, scale=4):
    """모서리 4곳에서 시작하는 연결 영역을 배경으로 고른다.

    배경이 그라데이션이어도 이웃 화소 간 차이가 허용 오차 이내면 따라간다.
    인물 윤곽은 급격한 색 차이로 끊기므로 안쪽(모자·외투)은 지워지지 않는다.
    마스크는 1/4 해상도에서 구한 뒤 NEAREST로 원래 크기에 되돌린다.
    """
    width, height = image.size
    small = image.convert("RGB").resize((max(1, width // scale), max(1, height // scale)),
                                        Image.Resampling.BILINEAR)
    sw, sh = small.size
    pixels = small.load()
    seen = bytearray(sw * sh)
    queue = deque()
    for x, y in ((0, 0), (sw - 1, 0), (0, sh - 1), (sw - 1, sh - 1)):
        index = y * sw + x
        if not seen[index]:
            seen[index] = 1
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        current = pixels[x, y]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= nx < sw and 0 <= ny < sh):
                continue
            index = ny * sw + nx
            if seen[index]:
                continue
            neighbor = pixels[nx, ny]
            if max(abs(neighbor[i] - current[i]) for i in range(3)) <= tolerance:
                seen[index] = 1
                queue.append((nx, ny))
    mask = Image.frombytes("L", (sw, sh), bytes(255 if flag else 0 for flag in seen))
    return mask.resize((width, height), Image.Resampling.NEAREST)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("size", type=int, choices=(16, 32, 48, 64, 96, 180, 192, 512))
    parser.add_argument("--palette", default=None, help="palette.png 경로(주면 갱신한다)")
    parser.add_argument("--tolerance", type=int, default=48)
    parser.add_argument("--flood-fill", action="store_true", help="모서리 4곳에서 연결된 배경 제거")
    parser.add_argument("--flood-tolerance", type=int, default=30)
    parser.add_argument("--palette-swap", default=None, help="from=to hex 쌍을 쉼표로 구분(알파 보존)")
    parser.add_argument("--opaque", action="store_true", help="배경을 투명하게 키잉하지 않고 불투명하게 유지(파비콘용)")
    args = parser.parse_args(argv)

    source = Image.open(args.source).convert("RGBA")
    palette = palette_image(args.palette)
    if args.opaque:
        mapped = source.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
        mapped.putalpha(Image.new("L", source.size, 255))
        result = mapped.resize((args.size, args.size), Image.Resampling.NEAREST)
        mode = "opaque palette=16 colors dither=none"
    elif args.palette_swap:
        alpha = source.getchannel("A")
        mapped = apply_swaps(source.convert("RGB"), parse_swaps(args.palette_swap)).convert("RGBA")
        mapped.putalpha(alpha)
        result = mapped if mapped.size == (args.size, args.size) else \
            mapped.resize((args.size, args.size), Image.Resampling.NEAREST)
        mode = f"palette-swap={args.palette_swap} alpha=preserved"
    else:
        alpha, keyed = key_magenta(source, args.tolerance)
        flooded = False
        if args.flood_fill:
            background = corner_background_mask(source, args.flood_tolerance)
            if background.getbbox():
                alpha = ImageChops.darker(alpha, ImageChops.invert(background))
                flooded = True
        mapped = source.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
        mapped.putalpha(alpha)
        result = mapped.resize((args.size, args.size), Image.Resampling.NEAREST)
        mode = f"keyed={'yes' if keyed else 'no'} flood-fill={'yes' if flooded else 'no'} palette=16 colors dither=none"
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    result.save(args.output)
    print(f"POSTPROCESS {os.path.basename(args.source)} -> {os.path.basename(args.output)} "
          f"({args.size}x{args.size}) {mode} resize=NEAREST")
    return 0


if __name__ == "__main__":
    sys.exit(main())
