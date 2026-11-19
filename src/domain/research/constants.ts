/** 도구 호출 루프 상한(책 7.1의 max_iterations=10). 상한 도달 시 도구 없이 마무리 요청으로 전환한다. */
export const MAX_ITERATIONS = 10;
/** search_web max_results의 기본값. */
export const DEFAULT_MAX_RESULTS = 5;
/** read_webpage가 LLM에 넘겨주는 본문 글자 수 상한. */
export const WEBPAGE_CHAR_LIMIT = 4_000;
/** /research 주제 길이 상한. */
export const TOPIC_MAX = 200;
/** 평가 하네스의 조사 성실성 하한(책 10.5 check_effort). */
export const MIN_SEARCHES = 2;
export const MIN_READS = 2;
