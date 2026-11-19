import type { Result } from '../../../domain/chat.ts';
import type { ResearchEvaluation, ResearchResult, ResearchStep, ResearchTool } from '../../../domain/research/types.ts';

export type { ResearchEvaluation, ResearchResult, ResearchStep, ResearchTool };

export interface ResearchClient {
  run(topic: string, signal?: AbortSignal): Promise<Result<ResearchResult>>;
}

// 값 재export는 아키텍처 규칙(ui의 domain import는 타입 전용)상 불가하므로 domain TOPIC_MAX과 같은 값을 로컬 상수로 유지한다.
export const RESEARCH_TOPIC_MAX = 200;
