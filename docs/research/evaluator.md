# 8.5절 LLM 평가자(Evaluator) 요약 (p.186–187)

생성 LLM이 작성한 리서치 보고서가 조사 노트에 충실한지 사후 검증하기 위해 **생성과 평가를 분리한 LLM 평가자**를 둔다.

## 1. 검증 기준 및 구조화 출력 (`EVALUATOR_FORMAT`)
- **검증 기준 3가지**:
  1. 보고서의 모든 주장이 조사 노트에 근거하는가?
  2. 조사 노트에 없는 사실이 추가되지 않았는가?
  3. 출처 표기가 조사 노트의 출처와 일치하는가?
- **응답 스키마 (`json_schema`, `name: "evaluation"`, `strict: true`)**:
  - `passed` (`boolean`): 세 기준을 모두 만족하면 `true`, 하나라도 어긋나면 `false`
  - `problems` (`string[]`): 기준에 어긋난 문제점 목록 (통과 시 빈 배열)
- **호출 옵션**: 일관된 판정을 위해 `temperature: 0`, `reasoning_effort: "none"`으로 호출한다.

## 2. 평가 및 재작성 흐름
1. 조사 루프가 수집한 `research_notes`를 바탕으로 보고서 초안을 작성한다.
2. `evaluate_report(research_notes, report)`로 초안을 검증한다.
3. `passed === false`이면 지적된 `problems`를 첨부해 보고서를 **1회 한도**로 다시 작성하고 재평가한다.
4. 최종 보고서와 함께 평가 결과(`passed`, `problems`)를 반환해 UI에서 사용자가 확인할 수 있게 표시한다.
