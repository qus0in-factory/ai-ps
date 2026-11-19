import type { Result } from '../../domain/chat.ts';
import type { FunctionCompletionGateway } from '../../domain/completion.ts';
import type { SearchHit } from '../../domain/research/tools.ts';

/** 도구 호출이 가능한 채팅 모델 포트(domain의 Function Calling 게이트웨이를 그대로 재사용). */
export type ResearchModelPort = FunctionCompletionGateway;

/** 웹 검색 포트. 결과 배열은 domain의 SearchHit(제목/주소/요약) 형태로 전달한다. */
export type ResearchSearchPort = (query: string, maxResults: number) => Promise<Result<SearchHit[]>>;

/** 웹 페이지 본문 포트. 본문 문자열을 반환한다(실패는 Result로). */
export type ResearchPagePort = (url: string) => Promise<Result<string>>;

/** 운영 로그 이벤트. 검색어 원문·페이지 본문·보고서 본문은 남기지 않는다. */
export type ResearchLogEvent =
  | { event: 'model_request'; turn: number; tools: boolean }
  | { event: 'model_response'; turn: number; toolCalls: number }
  | { event: 'tool_call'; turn: number; name: string }
  | { event: 'tool_result'; turn: number; name: string; ok: boolean }
  | { event: 'wrap_up' }
  | { event: 'report' };

export type ResearchLogger = (entry: ResearchLogEvent) => void;

export interface ResearchAgentPorts {
  model: ResearchModelPort;
  search: ResearchSearchPort;
  read: ResearchPagePort;
  log?: ResearchLogger;
}
