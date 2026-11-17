# /talk 튜터 초상 크레딧

- 재생성일: 2026-11-17 (v2)
- 모델: `gpt-image-2.6-flare`. 이번 재생성 API 호출 총 4회(여성·남성 각 2회, 기존 시트를 참조한 images/edits). 각각 두 번째 결과를 채택.
- 방식: 1536×1024의 3×2 시트를 성별마다 생성해 64×64 PNG 6장으로 분할. 기존 파일명 유지. 순서: neutral, smile, think, surprised, encourage, confused.
- 인물·색감: 여성은 어깨 길이 갈색 단발, 크림색 카디건과 흰 블라우스. 남성은 짧은 갈색 머리, 크림색 카디건과 연한 파란 셔츠.
- 프롬프트: 처음부터 64×64 격자로 설계하고 NEAREST 8배 확대한 도트, 큰 단색 면, 어두운 1픽셀 외곽선, 2단계 음영, 둥근 어깨와 닫힌 가슴 윤곽. 머리카락·니트 질감, 디더링, 노이즈, 손동작, 효과선·문장부호·반짝이 금지. 표정은 눈·눈썹·입으로 표현. 배경은 #FF00FF로 요청.
- 후처리: 마젠타 키잉과 원본 알파 반영 → 블록 최빈색으로 64 격자 축소(유사 RGB는 4비트 버킷으로 집계) → 따뜻한 18색 팔레트 리맵 → 고립된 저대비 점 정리. 눈·입 등 대비·색차가 큰 1픽셀은 보존. 생성본의 반투명 배경도 이진 알파로 정리하며 디더링하지 않는다. `public/talk/palette.png`에 팔레트 저장.
- 원본: `/tmp/talk-portraits-v2/raw/f-v2-2.png`, `m-v2-2.png`. 기존 참조 시트: `/tmp/talk-assets/raw/`. 임시 파일이며 커밋 대상 아님.
- 육안 검수: `/tmp/talk-portraits-v2-preview.png` — 기존/신규 12장 위아래 비교, 4배 NEAREST.

재현은 두 단계다. 기존 생성기로 임시 디렉터리에 시트를 생성한 다음, 원본 시트의 각 셀에 새 후처리 옵션을 명시한다. 생성기 자체는 새 옵션을 자동 적용하지 않는다.

```sh
node --env-file=.env scripts/generate-adventure-assets.mjs \
  --manifest "$PWD/scripts/talk-assets.json" --only tutor-f-sheet \
  --reference /tmp/talk-assets/raw/tutor-f-sheet.png \
  --final-out /tmp/talk-generated --raw-out /tmp/talk-generated/raw --attempts 1

# PALETTE는 scripts/talk-assets.json의 paletteColors 값.
# 셀 0~5를 위 표정 순서에 맞춰 반복하고 남성 시트에도 동일하게 적용한다.
python3 -I scripts/adventure-postprocess.py \
  /tmp/talk-generated/raw/tutor-f-sheet.png \
  /tmp/talk-generated/tutor-f-neutral.png 64 \
  --palette-colors "$PALETTE" --grid 3x2 --cell 0 \
  --pixel-grid 64 --clean-isolated
```
