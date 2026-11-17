# 공용 자산 출처

## 파비콘 (2026-11-17)
- 산출물은 RealFaviconGenerator의 현재 기본 구성에 맞췄다(사이트 및 2026 상태 보고서 확인): `favicon.ico`(16·32·48 프레임), `favicon-96x96.png`, `apple-touch-icon.png`(180), `web-app-manifest-192x192.png`, `web-app-manifest-512x512.png`, `site.webmanifest`.
- 최종 아이콘은 API 재호출 없이 기존 `public/adventure/lighthouse-lit.png`에서 등실(빛나는 머리)과 윗부분 줄무늬를 정사각으로 잘라 만들었다. 배경은 불투명 남색 `#0B1026`이고, Pillow NEAREST로 캔버스 약 90%를 채우게 확대했다. 16·32 프레임은 빛줄기를 생략한 고대비 등실 그림이다.
- 앞서 `gpt-image-2.6-flare`로 만든 파비콘 전용 생성본은 몸체가 배경과 같은 계열이라 16px에서 읽히지 않아 폐기했다.
- SVG 파비콘은 생략했다. 원본이 래스터 픽셀아트라 벡터로 옮기면 16색 격자가 깨지거나 PNG를 품은 껍데기가 되기 때문이다.
- `site.webmanifest`의 name·short_name은 `ai-ps`, theme_color는 `index.html`의 `#1d2733`, background_color는 팔레트 남색 `#0B1026`이다.

## OG 이미지 (2026-11-17)
- `og-image.png`(1200×630)는 API 호출 없이 기존 에셋을 Pillow로 합성했다. 배경은 팔레트 남색, 중앙 630×630 안에 `public/adventure/lighthouse-lit.png`를 정수배(5배) 확대해 두고, 좌우에 `portrait-ok`와 부품 아이콘 3개를 3배로 배치했다. 모두 NEAREST 확대다.
- 카카오톡이 가운데 기준으로 자를 수 있어 핵심 등대는 중앙 영역에만 둔다. 글꼴 품질 문제로 텍스트는 넣지 않았다.
