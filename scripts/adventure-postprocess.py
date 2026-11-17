#!/usr/bin/env python3
"""adventure 에셋 후처리: 마젠타 키잉 → 16색 리맵 → NEAREST 축소.

`--palette-swap from=to,...` 는 기존 산출물의 팔레트 색만 치환하고 알파를 그대로 보존한다.
stdlib + Pillow 만 사용하며 `python3 -I scripts/adventure-postprocess.py ...` 로 실행한다.
"""
import argparse
from collections import Counter, deque
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


def parse_palette_colors(spec):
    if not spec:
        return PALETTE
    colors = [item.strip() for item in spec.split(',') if item.strip()]
    if not 16 <= len(colors) <= 24:
        raise ValueError(f"palette must have 16..24 colors, got {len(colors)}")
    return colors


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def palette_image(path, colors=None):
    colors = colors or PALETTE
    image = Image.new("P", (len(colors), 1))
    flat = [channel for color in colors for channel in rgb(color)]
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


def reduce_by_mode(source, grid):
    """Choose a block's dominant color before palette remapping, never average edges.

    Bucket near-identical RGB values at 4-bit precision for counting only, so tiny
    generated-image variations cannot outvote a broad flat fill. The chosen color
    is still an actual source pixel from the winning bucket.
    """
    output = Image.new("RGBA", (grid, grid))
    pixels = source.load()
    for y in range(grid):
        top, bottom = y * source.height // grid, (y + 1) * source.height // grid
        for x in range(grid):
            left, right = x * source.width // grid, (x + 1) * source.width // grid
            block = [pixels[sx, sy] for sy in range(top, max(top + 1, bottom))
                     for sx in range(left, max(left + 1, right))]
            buckets = {}
            for pixel in block:
                key = tuple(c // 16 for c in pixel[:3]) if pixel[3] >= 128 else None
                buckets.setdefault(key, []).append(pixel)
            winner = max(buckets, key=lambda key: len(buckets[key]))
            output.putpixel((x, y), (0, 0, 0, 0) if winner is None else
                            (*Counter(p[:3] for p in buckets[winner]).most_common(1)[0][0], 255))
    return output


def clean_isolated_pixels(source):
    """Remove detached dots and low-contrast singleton speckles in uniform fills.

    Keep high-contrast single-pixel eyes/highlights and outline corners intact.
    Work from the original grid so cleaning never cascades through a feature.
    """
    output = source.copy()
    for y in range(1, source.height - 1):
        for x in range(1, source.width - 1):
            center = source.getpixel((x, y))
            if not center[3]:
                continue
            neighbors = [source.getpixel((x + dx, y + dy))
                         for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]
            if center in neighbors:
                continue
            if all(not p[3] for p in neighbors):
                output.putpixel((x, y), (0, 0, 0, 0))
                continue
            replacement, count = Counter(neighbors).most_common(1)[0]
            deltas = [center[i] - replacement[i] for i in range(3)]
            if count >= 6 and replacement[3] == center[3] and \
                    max(deltas) - min(deltas) <= 24 and sum(d * d for d in deltas) <= 96 ** 2:
                output.putpixel((x, y), replacement)
    return output


def process_pixel_grid(source, args, palette):
    alpha, keyed = key_magenta(source, args.tolerance)
    alpha = ImageChops.darker(alpha, source.getchannel("A"))
    keyed_source = source.copy()
    keyed_source.putalpha(alpha)
    reduced = reduce_by_mode(keyed_source, args.pixel_grid)
    mapped = reduced.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    mapped.putalpha(reduced.getchannel("A"))
    if args.clean_isolated:
        mapped = clean_isolated_pixels(mapped)
    result = mapped.resize((args.size, args.size), Image.Resampling.NEAREST)
    return result, f"keyed={'yes' if keyed else 'no'} grid={args.pixel_grid} reduction=MODE palette={len(parse_palette_colors(args.palette_colors))} dither=none clean-isolated={args.clean_isolated}"


def process_image(source, args, palette):
    if args.pixel_grid:
        return process_pixel_grid(source, args, palette)
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
    return result, mode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("size", type=int, choices=(16, 32, 48, 64, 96, 180, 192, 512))
    parser.add_argument("--palette", default=None, help="palette.png 경로(주면 갱신한다)")
    parser.add_argument("--palette-colors", default=None, help="쉼표로 구분한 16~24개 hex 색(기본 16색)")
    parser.add_argument("--tolerance", type=int, default=48)
    parser.add_argument("--flood-fill", action="store_true", help="모서리 4곳에서 연결된 배경 제거")
    parser.add_argument("--flood-tolerance", type=int, default=30)
    parser.add_argument("--palette-swap", default=None, help="from=to hex 쌍을 쉼표로 구분(알파 보존)")
    parser.add_argument("--opaque", action="store_true", help="배경을 투명하게 키잉하지 않고 불투명하게 유지(파비콘용)")
    parser.add_argument("--grid", default=None, help="COLSxROWS (예: 3x2). source를 격자로 잘라 처리")
    parser.add_argument("--cell", type=int, default=None, help="--grid 사용 시 처리할 셀 인덱스(0부터)")
    parser.add_argument("--pixel-grid", type=int, choices=(32, 48, 64), default=None,
                        help="opt-in: mode-reduce to this grid before palette remapping")
    parser.add_argument("--clean-isolated", action="store_true", help="clean isolated grid speckles (requires --pixel-grid)")
    args = parser.parse_args(argv)
    if args.clean_isolated and not args.pixel_grid:
        parser.error("--clean-isolated requires --pixel-grid")
    if args.pixel_grid and (args.opaque or args.palette_swap or args.flood_fill):
        parser.error("--pixel-grid uses magenta keying; do not combine with opaque/palette-swap/flood-fill")

    colors = parse_palette_colors(args.palette_colors)
    source = Image.open(args.source).convert("RGBA")
    palette = palette_image(args.palette, colors)

    if args.grid:
        cols, rows = (int(part) for part in args.grid.lower().split('x'))
        cell_width = source.width // cols
        cell_height = source.height // rows
        cells = []
        for row in range(rows):
            for col in range(cols):
                left = col * cell_width
                top = row * cell_height
                right = left + cell_width if col < cols - 1 else source.width
                bottom = top + cell_height if row < rows - 1 else source.height
                cells.append(source.crop((left, top, right, bottom)))
        if args.cell is None:
            for index, cell in enumerate(cells):
                result, mode = process_image(cell, args, palette)
                output = args.output
                stem, ext = os.path.splitext(output)
                output = f"{stem}-{index}{ext}"
                os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
                result.save(output)
                print(f"POSTPROCESS {os.path.basename(args.source)} cell {index} -> {os.path.basename(output)} "
                      f"({args.size}x{args.size}) {mode} resize=NEAREST")
            return 0
        if args.cell < 0 or args.cell >= len(cells):
            raise ValueError(f"cell index out of range: {args.cell}")
        result, mode = process_image(cells[args.cell], args, palette)
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        result.save(args.output)
        print(f"POSTPROCESS {os.path.basename(args.source)} cell {args.cell} -> {os.path.basename(args.output)} "
              f"({args.size}x{args.size}) {mode} resize=NEAREST")
        return 0

    result, mode = process_image(source, args, palette)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    result.save(args.output)
    print(f"POSTPROCESS {os.path.basename(args.source)} -> {os.path.basename(args.output)} "
          f"({args.size}x{args.size}) {mode} resize=NEAREST")
    return 0


if __name__ == "__main__":
    sys.exit(main())
