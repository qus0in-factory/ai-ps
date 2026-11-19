import { cancelResearchBody, readResearchBody, researchFailure, withResearchDeadline } from './research-http.ts';
import type { ResearchAdapterResult } from './research-http.ts';
import type { ResearchSearchResult } from './research-brave-search.ts';
import { mergeResearchSearchResults } from './research-merged-search.ts';

function plainSearchText(input: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  const decoded = input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? entity;
    const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
  return decoded.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim();
}

function itemUrl(item: { link: string; originallink?: unknown }, category: string): string | undefined {
  const candidates = category === 'news' ? [item.originallink, item.link] : [item.link];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return candidate;
    } catch { /* Ignore unusable search URLs. */ }
  }
}

/** NAVER API HUB search, using web documents, news and blogs in that order. */
export function createNcpSearch(config: { apiKeyId?: string; apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number }) {
  return {
    async search(query: string, max = 5, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchSearchResult[]>> {
      if (!config.apiKeyId?.trim() || !config.apiKey?.trim()) return { ok: false, reason: 'NCP 검색 API 인증 정보가 설정되지 않았습니다.' };
      if (!query.trim() || query.length > 2000) return { ok: false, reason: '검색어를 1~2000자로 입력해 주세요.' };
      const count = Number.isFinite(max) ? Math.max(1, Math.min(20, Math.floor(max))) : 5;
      try {
        return await withResearchDeadline(config.timeoutMs, async signal => {
          const outcomes = await Promise.allSettled(['webkr', 'news', 'blog'].map(async category => {
            const url = new URL(`https://naverapihub.apigw.ntruss.com/search/v1/${category}`);
            url.searchParams.set('query', query.trim()); url.searchParams.set('display', String(count));
            url.searchParams.set('start', '1'); url.searchParams.set('format', 'json');
            const response = await (config.fetcher ?? fetch)(url.href, { redirect: 'error', signal, headers: {
              Accept: 'application/json', 'X-NCP-APIGW-API-KEY-ID': config.apiKeyId!, 'X-NCP-APIGW-API-KEY': config.apiKey!,
            } });
            // Error payloads can echo credentials; never read or log them.
            if (!response.ok) { cancelResearchBody(response); throw new Error('NCP search request failed'); }
            const data: unknown = JSON.parse(await readResearchBody(response, signal));
            if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) throw new Error('Invalid NCP search response');
            const hits: ResearchSearchResult[] = [];
            for (const item of data.items) {
              if (!item || typeof item.title !== 'string' || typeof item.link !== 'string'
                || item.description !== undefined && typeof item.description !== 'string') throw new Error('Invalid NCP search item');
              const target = itemUrl(item, category);
              if (!target) continue;
              hits.push({ title: plainSearchText(item.title).slice(0, 500), url: target,
                description: plainSearchText(item.description ?? '').slice(0, 2000) });
              if (hits.length === count) break;
            }
            return hits;
          }));
          const groups = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
          if (!groups.length) throw new Error('NCP search unavailable');
          return { ok: true, value: mergeResearchSearchResults(groups, count) };
        }, external);
      } catch (error) { return researchFailure(error, 'NCP 웹 검색'); }
    },
  };
}
