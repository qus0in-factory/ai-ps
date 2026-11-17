# /talk 튜터 초상 크레딧

- 생성일: 2026-11-17
- 모델: gpt-image-2.6-flare (`OPENAI_IMAGE_BASE_URL` 기본값, API 호출 2회: 여성·남성 시트 각 1회)
- 방식: 성별마다 3x2 표정 스프라이트 시트 1장을 생성한 뒤 6칸으로 분할. 표정 6종 순서: neutral, smile, think, surprised, encourage, confused.
- 프롬프트 요지: 8-bit pixel art sprite sheet, 16색, 마젠타(#FF00FF) 배경, 같은 인물·의상·조명·외곽선, 6개 동일 크기 칸, 텍스트 라벨 없음. 여성: 어깨 길이 검은 머리, 밝은 카디건+흰 블라우스. 남성: 짧은 검은 머리, 셔츠+밝은 카디건.
- 후처리: `scripts/adventure-postprocess.py`로 마젠타 키잉 → `public/talk/palette.png`(밝은 교실 톤 16색) 리맵 → NEAREST 축소(64x64). `python3 -I` 실행.
- 원본 시트: `/tmp/talk-assets/raw/` (커밋 대상 아님).
- 파이프라인: `scripts/generate-adventure-assets.mjs --manifest scripts/talk-assets.json` (기존 adventure 생성 경로와 동일; `--dry-run` 정상).
