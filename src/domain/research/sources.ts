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
