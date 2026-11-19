// 책 10.5의 코드 채점(외부 의존 없음). 궤적은 ResearchStep, 보고서 인용은 본문 URL 집합으로 비교한다.
import { MIN_READS, MIN_SEARCHES } from './constants.ts';
import type { ResearchStep } from './types.ts';

/** 끝 문장부호·해시·끝 슬래시 차이를 없애(agent.ts comparableUrl 규칙과 같은 방향). */
export function normalizeCitationUrl(url: string): string {
  const trimmed = url.trim().replace(/[.,;:)\]"'*]+$/, '');
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    // 끝 슬래시는 경로에서만 제거한다. 쿼리 값 끝의 슬래시는 다른 URL이다.
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href;
  } catch {
    const hashless = trimmed.split('#')[0]!;
    const queryAt = hashless.indexOf('?');
    const path = queryAt === -1 ? hashless : hashless.slice(0, queryAt);
    return path.replace(/\/+$/, '') + (queryAt === -1 ? '' : hashless.slice(queryAt));
  }
}

export interface CitationCheck {
  passed: boolean;
  unread: string[];
}

/** 성공한 read_webpage의 URL만 허용 집합으로 삼고, 보고서의 모든 URL이 그 안에 있는지 확인한다. */
export function checkCitations(report: string, steps: ResearchStep[]): CitationCheck {
  const read = new Set(steps
    .filter(step => step.tool === 'read_webpage' && step.ok && typeof step.args.url === 'string' && step.args.url.trim())
    .map(step => normalizeCitationUrl(step.args.url as string)));
  const cited = new Set((report.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? []).map(normalizeCitationUrl));
  const unread = [...cited].filter(url => !read.has(url)).sort();
  return { passed: unread.length === 0, unread };
}

export interface EffortCheck {
  passed: boolean;
  searches: number;
  reads: number;
}

/** 호출 수는 성공 여부와 무관하게 센다(책 10.5 check_effort). */
export function checkEffort(steps: ResearchStep[], options: { minSearches?: number; minReads?: number } = {}): EffortCheck {
  const searches = steps.filter(step => step.tool === 'search_web').length;
  const reads = steps.filter(step => step.tool === 'read_webpage').length;
  return {
    passed: searches >= (options.minSearches ?? MIN_SEARCHES) && reads >= (options.minReads ?? MIN_READS),
    searches, reads,
  };
}
