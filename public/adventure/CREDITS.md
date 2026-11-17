# /adventure 에셋 출처

- 모델: `gpt-image-2.6-flare` (2026-11-17 비교에서 `sunburst` 대비 선택)
- 생성일: 2026-11-17
- 프롬프트: 공통 접두어와 각 파일별 subject는 [`scripts/adventure-assets.json`](../../scripts/adventure-assets.json)에 있다. 공통 접두어는 "8-bit pixel art sprite, strict 16-color palette, hard pixel edges, no anti-aliasing, no gradients, no text, no watermark, centered subject filling 80% of the frame, plain solid #FF00FF background."
- `portrait-ok`: 비교본 `/tmp/adventure-assets/compare/flare.png` 원본을 재사용(재생성 없음).
- `portrait-hurt`: `compare/flare.png`를 참조 이미지로 `/v1/images/edits`로 1회 재생성했다. 프롬프트에 "keep the exact same character, outfit and framing as the reference; background must be flat solid magenta #FF00FF, no vignette, no scenery"를 명시했고 마젠타 배경이 나와 키잉됐다.
- `portrait-cold`: API 재호출 없이 `portrait-ok`의 팔레트 스왑으로 만들었다. 피부·볼 색 `#C98A5E`→`#7A8799`, `#EBC9A0`→`#B8C2CC`만 치환하고 모자·외투·머리카락·윤곽선은 유지했다. 실패했던 edits 원본(`/tmp/adventure-assets/raw/portrait-cold.png`)은 폐기했다.
- 후처리: Python Pillow 13(`python3 -I scripts/adventure-postprocess.py`). 마젠타(#FF00FF 근처, 허용 오차 48)를 투명으로 키잉 → 16색 팔레트로 리맵(`Image.quantize`, dither 없음) → NEAREST 축소(초상 64, 아이콘 32, 등대 96). sips 축소본은 쓰지 않았다.
- `--flood-fill` 옵션은 모자까지 지워져 폐기했다. 스크립트에는 남아 있지만 기본값은 꺼져 있으며 이번 산출물에는 쓰지 않았다.
- `portrait-cold`의 알파 채널은 `portrait-ok`와 픽셀 단위로 동일하다(차이 0/4096). 모자 영역(상단 1/3 중앙, 16≤x<48) 불투명 비율도 `ok` 77.1%(518/672), `cold` 77.1%(518/672)로 같다. `hurt`는 76.8%(516/672).
- 원본 1024×1024는 `/tmp/adventure-assets/raw/`에만 보관하며 커밋하지 않는다.
