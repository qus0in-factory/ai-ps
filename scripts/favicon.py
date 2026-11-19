#!/usr/bin/env python3
"""16x16 전구(bulb) 픽셀아트 하나에서 public/ 의 favicon 계열 파일을 모두 만든다. 실행: python3 scripts/favicon.py"""
from pathlib import Path
from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
BG = "#0B1026"
PALETTE = {
    "o": "#FF9F1C",  # 유리 외곽선
    "y": "#FFD23F",  # 유리
    "h": "#FFF6C8",  # 하이라이트
    "f": "#FF9F1C",  # 필라멘트
    "r": "#C99A2E",  # 빛살
    "g": "#9AA5B1",  # 소켓
    "G": "#5C6773",  # 소켓 그늘
}
ART = [
    "................",
    ".......rr.......",
    "..r..oooooo..r..",
    "....oyyyyyyo....",
    "...oyhhyyyyyo...",
    "..oyhyyyyyyyyo..",
    "r.oyhyyyyyyyyo.r",
    "..oyyyyyyyyyyo..",
    "..oyyyyfyfyyyo..",
    "...oyyyyffyyo...",
    "....oyyyyyyo....",
    ".....oyyyyo.....",
    ".....oggggo.....",
    ".....oGGGGo.....",
    "......oooo......",
    "................",
]
assert len(ART) == 16 and all(len(row) == 16 for row in ART), "16x16 격자여야 한다"
assert all(c == "." or c in PALETTE for row in ART for c in row)


def hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def base_image():
    image = Image.new("RGB", (16, 16), hex_rgb(BG))
    for y, row in enumerate(ART):
        for x, c in enumerate(row):
            if c != ".":
                image.putpixel((x, y), hex_rgb(PALETTE[c]))
    return image


def scaled(base, size):
    return base.resize((size, size), Image.NEAREST)


def svg():
    rects = [f'<rect width="16" height="16" fill="{BG}"/>']
    for y, row in enumerate(ART):
        x = 0
        while x < 16:
            c = row[x]
            if c == ".":
                x += 1
                continue
            end = x
            while end < 16 and row[end] == c:
                end += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{end - x}" height="1" fill="{PALETTE[c]}"/>')
            x = end
    body = "".join(rects)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">{body}</svg>\n'


def main():
    base = base_image()
    (PUBLIC / "favicon.svg").write_text(svg())
    # 각 크기를 nearest 로 따로 만들어 넣는다(sizes= 만 쓰면 Pillow 가 보간해 흐려진다).
    ico = [scaled(base, size) for size in (48, 32, 16)]
    ico[0].save(PUBLIC / "favicon.ico", sizes=[(48, 48), (32, 32), (16, 16)], append_images=ico[1:])
    scaled(base, 96).save(PUBLIC / "favicon-96x96.png")
    scaled(base, 192).save(PUBLIC / "web-app-manifest-192x192.png")
    scaled(base, 512).save(PUBLIC / "web-app-manifest-512x512.png")
    # 180 은 16 의 정수배가 아니므로 160(10배)을 중앙에 두고 10px 여백을 배경색으로 채워 픽셀을 보존한다.
    touch = Image.new("RGB", (180, 180), hex_rgb(BG))
    touch.paste(scaled(base, 160), (10, 10))
    touch.save(PUBLIC / "apple-touch-icon.png")
    print("favicon files generated")


if __name__ == "__main__":
    main()
