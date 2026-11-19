import type { ResearchStep } from './types.ts';

export type { ResearchResult, ResearchStep, ResearchTool } from './types.ts';

/** 성공한 read_webpage 호출의 URL을 중복 없이, 호출 순서대로 추출한다. */
export function extractSources(steps: ResearchStep[]): string[] {
  const sources: string[] = [];
  for (const step of steps) {
    if (step.tool !== 'read_webpage' || !step.ok) continue;
    const url = step.args.url;
    if (typeof url !== 'string' || !url.trim() || sources.includes(url)) continue;
    sources.push(url);
  }
  return sources;
}

function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

/** 보고서의 링크 중 검색·읽기로 확인하지 않은 주소는 링크를 풀어 글자만 남긴다. */
export function stripForeignLinks(report: string, allowedUrls: readonly string[]): string {
  const allowed = new Set(allowedUrls.map(withoutFragment));
  return report.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (whole, label: string, url: string) =>
    allowed.has(withoutFragment(url)) ? whole : label);
}
