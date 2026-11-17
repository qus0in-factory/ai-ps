# 공급자 (LLM provider)

현재는 OpenAI API를 직접 호출합니다. 향후 Groq·Cloudflare Workers AI·Ollama 등 저렴하거나 무료 티어 모델로 바꿀 예정입니다(잠정).

## 바꾸는 방법

secret 세 개만 교체하면 됩니다.

- `OPENAI_BASE_URL` — 공급자의 OpenAI 호환 base URL
- `OPENAI_MODEL` — 공급자에서 쓸 모델 이름
- `OPENAI_API_KEY` — 공급자 API 키

Ollama 로컬 서버는 빈 키를 거절하므로 `OPENAI_API_KEY=ollama` 같은 dummy 값을 넣습니다. Workers 배포 시에는 `wrangler secret bulk`로 같은 키를 다시 올립니다. 자세한 절차는 [운영 절차](harness/operations.md) 참고. OpenAI 직접 호출로 되돌릴 때는 `wrangler secret delete OPENAI_BASE_URL`로 남은 base URL을 지워야 합니다.

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
