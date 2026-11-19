import type { ToolDefinition } from '../tools.ts';
import { DEFAULT_MAX_RESULTS, WEBPAGE_CHAR_LIMIT } from './constants.ts';
import type { ResearchTool } from './types.ts';

export type { ResearchResult, ResearchStep, ResearchTool } from './types.ts';

/** 검색 결과 한 건. infra가 Brave Search 응답에서 이 형태로 변환해 전달한다. */
export interface SearchHit {
  title: string;
  url: string;
  summary: string;
}

export const SEARCH_WEB_TOOL: ToolDefinition = {
  name: 'search_web',
  description: '웹에서 주제와 관련된 문서를 검색해 제목·주소·요약 목록을 반환한다. 현재 지식만으로는 답이 부족하거나 더 많은 출처가 필요할 때 호출하고, 결과에서 자세히 읽을 페이지를 골라 read_webpage로 읽는다.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '검색어. 주제에 맞게 구체적으로 쓴다.' },
      max_results: { type: 'integer', description: `반환할 검색 결과 개수. 기본값 ${DEFAULT_MAX_RESULTS}.` },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const READ_WEBPAGE_TOOL: ToolDefinition = {
  name: 'read_webpage',
  description: `주어진 URL의 웹 페이지 본문을 정돈된 텍스트로 반환한다. 본문이 길면 처음 ${WEBPAGE_CHAR_LIMIT}자까지만 전달한다. search_web 결과에서 얻은 주소를 자세히 확인할 때 호출하고, 확인한 내용은 조사 노트에 출처 URL과 함께 기록한다.`,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '읽을 웹 페이지 주소.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

/** 검색 결과를 LLM이 읽을 수 있는 정돈된 텍스트(제목/주소/요약)로 변환한다. */
export function formatSearchResults(hits: SearchHit[]): string {
  if (!hits.length) return '검색 결과가 없습니다. 다른 검색어로 다시 시도해보세요.';
  return hits.map((hit, index) =>
    `${index + 1}. ${hit.title || hit.url}\n   주소: ${hit.url}\n   요약: ${hit.summary || '요약이 없습니다.'}`).join('\n');
}

/** 페이지 본문이 길면 WEBPAGE_CHAR_LIMIT에서 자르고 생략 안내를 붙인다. */
export function truncateWebpage(body: string): string {
  if (body.length <= WEBPAGE_CHAR_LIMIT) return body;
  return `${body.slice(0, WEBPAGE_CHAR_LIMIT)}\n…(본문이 길어 이후 내용은 생략되었습니다.)`;
}

/** 도구 실패를 예외 대신 모델용 안내 문자열로 변환한다. */
export function formatToolError(tool: ResearchTool, reason: string): string {
  const detail = reason.trim() ? `(${reason.trim()})` : '';
  return tool === 'search_web'
    ? `웹 검색에 실패했습니다${detail}. 검색어를 바꿔 다시 시도해보세요.`
    : `웹 페이지를 읽지 못했습니다${detail}. 다른 페이지를 시도해보세요.`;
}

/** 모델이 등록되지 않은 도구를 호출했을 때 루프를 유지하기 위한 안내 문자열. */
export function formatUnknownTool(name: string): string {
  return `등록되지 않은 도구 ${JSON.stringify(name)}입니다. search_web 또는 read_webpage만 호출할 수 있습니다.`;
}
