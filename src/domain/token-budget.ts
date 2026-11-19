// 모든 호출부가 max_completion_tokens를 이 표로만 정한다(설계 /tmp/token-spec.md §2·§15).
// prompt_cache_key는 사용자별이 아니라 호출부별 고정 값이고, 파사드가 그대로 전달한다.

export const TOKEN_BUDGET = {
  chatPlan: 500,
  chatStep: 400,
  chatAnswer: 1500,
  talkTurn: 800,
  talkReport: 2000,
  adventureTool: 400,
  adventureTurn: 1600,
  queensProposal: 1500,
  researchLoop: 2000,
  researchReport: 3000,
  researchEval: 400,
  summary: 300,
} as const;

export type BudgetName = keyof typeof TOKEN_BUDGET;

/** 호출부는 이 객체를 펼쳐 넘긴다: `model.complete(messages, { ...budget('chatPlan'), ... })` */
export function budget(name: BudgetName): { max_completion_tokens: number; prompt_cache_key: string } {
  return { max_completion_tokens: TOKEN_BUDGET[name], prompt_cache_key: `ai-ps:${name}` };
}
