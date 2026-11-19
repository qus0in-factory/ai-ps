# 공급자 (LLM provider)

현재는 OpenAI API를 직접 호출합니다. 향후 Groq·Cloudflare Workers AI·Ollama 등 저렴하거나 무료 티어 모델로 바꿀 예정입니다(잠정).

## 바꾸는 방법

secret 세 개만 교체하면 됩니다.

- `OPENAI_BASE_URL` — 공급자의 OpenAI 호환 base URL
- `OPENAI_MODEL` — 공급자에서 쓸 모델 이름
- `OPENAI_API_KEY` — 공급자 API 키

Ollama 로컬 서버는 빈 키를 거절하므로 `OPENAI_API_KEY=ollama` 같은 dummy 값을 넣습니다. Workers 배포 시에는 `pnpm run deploy`가 허용된 키를 동기화합니다. 자세한 절차는 [운영 절차](harness/operations.md) 참고. OpenAI 직접 호출로 되돌릴 때는 `wrangler secret delete OPENAI_BASE_URL`로 남은 base URL을 지워야 합니다.

## OpenAI 호환 base URL 예시

공식 문서에서 확인한 값입니다.

| 공급자 | base URL | 확인 출처 |
| --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | [Groq 문서](https://console.groq.com/docs/openai) |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` | [Cloudflare 문서](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) |
| Ollama (로컬) | `http://localhost:11434/v1` | [Ollama 문서](https://docs.ollama.com/api/openai-compatibility) |

`http://localhost:11434/v1`은 로컬 실행 전용입니다. 배포된 Worker의 localhost는 개발자 컴퓨터가 아니므로 이 주소에 접근할 수 없습니다. 배포 시에는 Worker가 접근 가능한 공개 endpoint가 필요합니다.

## 미결

- function calling·JSON mode 지원 여부는 모델마다 다릅니다. 바꾸기 전에 대상 모델이 채팅·도구 호출을 지원하는지 확인해야 합니다.
- function 모드(`OPENAI_TOOL_MODE=function`)는 `strict: true`·`reasoning_effort: "none"`을 고정 전송하므로 일부 모델(예: Groq gpt-oss)과 호환되지 않을 수 있습니다. 기본 plan-execute/JSON 모드는 영향 없습니다.

## Workers fetch 호환 표

기준은 Node 24(undici)와 호환 날짜 `2026-11-17`의 workerd입니다.

| `RequestInit` 옵션 | Node 24 | workerd | 저장소 규칙 |
| --- | --- | --- | --- |
| `redirect: 'follow'`, `'manual'` | 지원 | 지원. `manual`은 3xx와 Location을 반환 | 인증 헤더를 보내는 고정 엔드포인트는 `manual`과 `response.ok` 검사 사용 |
| `redirect: 'error'` | 지원 | 요청 전 TypeError | 금지 |
| `signal` | 지원 | 지원 | 취소와 시간 제한에 사용 |
| `credentials` | 브라우저 쿠키 저장소 없음 | 옵션 효과 미확인 | 기존 `'omit'`은 유지하고 새 요청에서는 이 옵션의 효과에 의존하지 않음 |
| `cache` | 일부 값 지원 | 공식 문서는 `'no-store'`, `'no-cache'`를 지원한다고 명시 | 현재 프로젝트에서는 직접 지정하지 않음 |
| `integrity`·`mode`·`keepalive`·`priority` | 옵션에 따라 다름 | 이 저장소에서 미확인 | 지원 확인과 정책 갱신 전까지 사용하지 않음 |

`redirect: 'error'`의 실패는 2026-11-19 실제 workerd에서 확인했습니다. 빠른 검사는 `src/infra`의 옵션 리터럴을 검사합니다. 변수·동적 옵션의 런타임 동작은 대상 어댑터를 workerd에서 실행해 확인합니다. 표의 금지 정책을 바꾸면 아키텍처 테스트도 함께 갱신합니다. [Cloudflare Request 문서](https://developers.cloudflare.com/workers/runtime-apis/request/) · [아키텍처 테스트](../tests/arch/workers-fetch-options.test.ts)
