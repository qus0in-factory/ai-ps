# 운영 절차

## Discord 완료 보고
- 사용자가 요청한 작업 묶음이 끝나면 총괄(`ps-opus`)이 한 번 보낸다. 워커는 보내지 않는다. 메시지 구조는 `discord-notify` 스킬을 따른다.
- 스크립트: `scripts/notify-discord.sh "<제목>" "<본문>" [--image <경로>]... [--dry-run]` (본문 `-`는 stdin). 프로젝트 루트에서 실행한다.
- 웹훅은 `.env`의 `DISCORD_WEBHOOK_URL`에서 읽는다(`.env`는 커밋 금지, 키 이름만 `.env.example`에 둔다). 값을 `echo`·`cat`으로 출력하지 않는다.
- 순서: `--dry-run`으로 payload 확인 → 전송 → `전송 완료`(HTTP 204/200) 확인.
- 제목은 `[ai-ps <버전·작업명>] <한 줄 결과>`, 본문은 바뀐 것·검증·판정해 주세요·다음 순서로 쓴다.
