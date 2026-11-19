import type { ResearchSearchProvider } from './research-merged-search.ts';
import type { ResearchSearchResult } from './research-brave-search.ts';
import type { ResearchAdapterResult } from './research-http.ts';
import type { ResearchWebpage } from './research-web-reader.ts';
import type { KvJsonCache } from './kv-cache.ts';

interface CachedSearch { hits: ResearchSearchResult[] }
interface CachedPage { url: string; title: string; content: string }

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMax(max: number | undefined): number {
  return Number.isFinite(max) ? Math.max(1, Math.min(20, Math.floor(max as number))) : 5;
}

export function createCachedSearch(provider: ResearchSearchProvider, cache: KvJsonCache): ResearchSearchProvider {
  return {
    async search(query, max, external) {
      const count = normalizeMax(max);
      const key = await sha256Hex(`${normalizeQuery(query)}:${count}`);
      const cached = await cache.get<CachedSearch>(key);
      if (cached?.hits?.length) {
        return { ok: true, value: cached.hits };
      }
      const result = await provider.search(query, count, external);
      if (result.ok && result.value.length >= 1) {
        await cache.put(key, { hits: result.value });
      }
      return result;
    },
  };
}

export function createCachedReader(
  reader: { read(input: string, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchWebpage>> },
  cache: KvJsonCache,
): { read(input: string, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchWebpage>> } {
  return {
    async read(input, external) {
      let normalized = input;
      try {
        const url = new URL(input);
        url.hash = '';
        normalized = url.href;
      } catch {
        // Keep the original string as the cache key for invalid URLs.
      }
      const key = await sha256Hex(normalized);
      const cached = await cache.get<CachedPage>(key);
      if (cached) {
        return { ok: true, value: { url: cached.url, title: cached.title, content: cached.content } };
      }
      const result = await reader.read(input, external);
      if (result.ok) {
        await cache.put(key, {
          url: result.value.url,
          title: result.value.title,
          content: result.value.content.slice(0, 16_000),
        });
      }
      return result;
    },
  };
}