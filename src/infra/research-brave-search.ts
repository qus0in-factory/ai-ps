import { cancelResearchBody, readResearchBody, researchFailure, withResearchDeadline } from './research-http.ts';
import type { ResearchAdapterResult } from './research-http.ts';

export interface ResearchSearchResult { title: string; url: string; description: string }

export function createBraveSearch(config: { apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number }) {
  return {
    async search(query: string, max = 5, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchSearchResult[]>> {
      if (!config.apiKey?.trim()) return { ok: false, reason: '검색 API 키가 설정되지 않았습니다.' };
      if (!query.trim() || query.length > 2000) return { ok: false, reason: '검색어를 1~2000자로 입력해 주세요.' };
      const count = Number.isFinite(max) ? Math.max(1, Math.min(20, Math.floor(max))) : 5;
      try {
        return await withResearchDeadline(config.timeoutMs, async signal => {
          const url = new URL('https://api.search.brave.com/res/v1/web/search');
          url.searchParams.set('q', query.trim());
          url.searchParams.set('count', String(count));
          url.searchParams.set('text_decorations', 'false');
          const response = await (config.fetcher ?? fetch)(url.href, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': config.apiKey! },
            // Workers supports follow/manual; reject 3xx below without forwarding keys.
            redirect: 'manual', signal,
          });
          // Provider diagnostics may contain secrets; do not consume or expose error bodies.
          if (!response.ok) {
            cancelResearchBody(response);
            return { ok: false, reason: `검색 요청에 실패했습니다. (HTTP ${response.status}) 다른 검색어를 시도해보세요.` };
          }
          const data: unknown = JSON.parse(await readResearchBody(response, signal));
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid search response');
          const web = (data as { web?: unknown }).web;
          if (web === undefined && (data as { type?: unknown }).type === 'search') return { ok: true, value: [] };
          if (!web || typeof web !== 'object' || !('results' in web) || !Array.isArray(web.results)) throw new Error('Invalid search results');
          const results: ResearchSearchResult[] = [];
          for (const item of web.results) {
            if (!item || typeof item.title !== 'string' || typeof item.url !== 'string'
              || (item.description !== undefined && typeof item.description !== 'string')) throw new Error('Invalid search result');
            const target = new URL(item.url);
            if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) continue;
            results.push({ title: item.title, url: item.url, description: item.description ?? '' });
            if (results.length >= count) break;
          }
          return { ok: true, value: results };
        }, external);
      } catch (error) { return researchFailure(error, '웹 검색'); }
    },
  };
}
