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

## 3. 10.5 평가 하네스
- 궤적은 `ResearchResult.steps`(`{ tool, args, ok }[]`)가 책의 `(name, args, result)`에 대응한다. 본문을 저장하지 않는 현재 방식이 로그 개인정보 규칙(9.8)과 맞으므로 궤적 기록은 바꾸지 않는다.
- 코드 채점 둘: `checkCitations(report, steps)`는 읽은 페이지 URL 집합과 보고서 URL 집합을 정규화해 비교하고, `checkEffort(steps, { minSearches, minReads })`는 검색·읽기 횟수 하한을 본다. 출처 진실성은 코드가 더 정확히 판정하므로 루브릭에서 뺐다.
- 루브릭 평가자는 하네스 전용이다(`grounded`·`structured`·`clear` 1~5 + `reasons`). 운영 흐름의 LLM 평가자(8.5)는 그대로 둔다.
- 실행: `pnpm test:slow -- tests/eval/research-eval.slow.ts` (기본 1회). `RESEARCH_EVAL_RUNS=3`으로 반복 가능. `RESEARCH_EVAL_OUT=<경로>`로 주제별 결과를 JSON으로 저장한다.
- H3 실측(2026-11-19): 3주제 중 인용 검증 1건 통과·2건 실패(미읽 1·5건), 조사 성실성 3건 통과, 루브릭 5/5/5·5/5/5·5/5/4. 루브릭 점수는 높지만 미읽 인용이 있는 사례가 있어 결과 평가와 궤적 코드 채점이 서로 다른 것을 본다(책 10.5 교훈).

## 4. 10.7 회귀 관문
1. 변경 전 `RESEARCH_EVAL_OUT`으로 기준선을 만든다.
2. 변경 후 `RESEARCH_EVAL_BASELINE=tests/eval/baselines/research.json`으로 후보를 실행한다.
3. 회귀가 0이면 배포하고, 수용할 변경이면 기준선 파일을 갱신해 커밋한다.
- `score_drop` 기본값은 0.5이며, 비결정성이 있으므로 중요 변경은 `RESEARCH_EVAL_RUNS=3`으로 통과율을 본다.
- 리서치의 프롬프트·모델·도구 설명을 바꾸는 패치는 `pnpm test:slow -- tests/eval/research-eval.slow.ts`를 기준선과 함께 돌려 회귀 0을 확인한 뒤 릴리스한다.
