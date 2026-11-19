import type { ResearchSearchResult } from './research-brave-search.ts';
import type { ResearchAdapterResult } from './research-http.ts';

export interface ResearchSearchProvider {
  search(query: string, max?: number, signal?: AbortSignal): Promise<ResearchAdapterResult<ResearchSearchResult[]>>;
}

/** Interleave ranked lists so one provider cannot crowd out the others. */
export function mergeResearchSearchResults(groups: ResearchSearchResult[][], max: number): ResearchSearchResult[] {
  const result: ResearchSearchResult[] = [];
  const seen = new Set<string>();
  const rows = Math.max(0, ...groups.map(group => group.length));
  for (let row = 0; row < rows && result.length < max; row++) {
    for (const group of groups) {
      const hit = group[row];
      if (!hit) continue;
      let url: URL;
      try { url = new URL(hit.url); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      if (seen.has(url.href)) continue;
      seen.add(url.href); result.push(hit);
      if (result.length === max) break;
    }
  }
  return result;
}

export function createMergedResearchSearch(providers: ResearchSearchProvider[]): ResearchSearchProvider {
  return {
    async search(query, max = 5, signal) {
      if (signal?.aborted || !providers.length) return { ok: false, reason: '웹 검색을 사용할 수 없습니다. 다른 검색어를 시도해보세요.' };
      const count = Number.isFinite(max) ? Math.max(1, Math.min(20, Math.floor(max))) : 5;
      const outcomes = await Promise.allSettled(providers.map(provider => Promise.resolve().then(() => provider.search(query, count, signal))));
      if (signal?.aborted) return { ok: false, reason: '웹 검색 요청이 중단되었습니다.' };
      const groups = outcomes.flatMap(outcome => outcome.status === 'fulfilled' && outcome.value.ok ? [outcome.value.value] : []);
      if (!groups.length) return { ok: false, reason: '웹 검색에 실패했습니다. 다른 검색어를 시도해보세요.' };
      return { ok: true, value: mergeResearchSearchResults(groups, count) };
    },
  };
}
