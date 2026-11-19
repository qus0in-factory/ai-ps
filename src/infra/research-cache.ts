import type { ResearchSearchProvider } from './research-merged-search.ts';
import type { ResearchSearchResult } from './research-brave-search.ts';
import type { ResearchAdapterResult } from './research-http.ts';
import type { ResearchWebpage } from './research-web-reader.ts';
import type { KvJsonCache } from './kv-cache.ts';

interface CachedSearch { hits: ResearchSearchResult[] }
interface CachedPage { url: string; title: string; content: string }

const SHORT_TTL_SECONDS = 5 * 60;

function isSearchCache(value: unknown): value is CachedSearch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hits = (value as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return false;
  return hits.every(hit =>
    !!hit && typeof hit === 'object' && !Array.isArray(hit)
    && typeof (hit as { title?: unknown }).title === 'string'
    && typeof (hit as { url?: unknown }).url === 'string'
    && typeof (hit as { description?: unknown }).description === 'string');
}

function isPageCache(value: unknown): value is CachedPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { url?: unknown; title?: unknown; content?: unknown };
  return typeof candidate.url === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.content === 'string';
}

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
      const cached = await cache.get<unknown>(key);
      if (isSearchCache(cached) && cached.hits.length >= 1) {
        return { ok: true, value: cached.hits };
      }
      const result = await provider.search(query, count, external);
      if (result.ok && result.value.length >= 1) {
        const full = result.value.length >= count;
        await cache.put(key, { hits: result.value }, full ? undefined : SHORT_TTL_SECONDS);
      }
      return result;
    },
  };
}

export interface CachedReaderOptions {
  allowedHosts?: ReadonlySet<string>;
}

function sameHostPolicy(snapshot: readonly string[], allowedHosts?: ReadonlySet<string>): boolean {
  return !allowedHosts || (allowedHosts.size === snapshot.length && snapshot.every(host => allowedHosts.has(host)));
}

export function createCachedReader(
  reader: { read(input: string, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchWebpage>> },
  cache: KvJsonCache,
  { allowedHosts }: CachedReaderOptions = {},
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
      // The reader checks every redirect hop against this policy and returns only the final URL.
      // Partition by the complete policy so a hit preserves the checks on intermediate hosts.
      const hosts = allowedHosts ? [...allowedHosts].sort() : [];
      const key = await sha256Hex(JSON.stringify([normalized, allowedHosts ? hosts : null]));
      const cached = await cache.get<unknown>(key);
      if (isPageCache(cached) && sameHostPolicy(hosts, allowedHosts)) {
        let allowed = true;
        if (allowedHosts) {
          try {
            allowed = allowedHosts.has(new URL(cached.url).hostname.replace(/\.$/, ''));
          } catch {
            allowed = false;
          }
        }
        if (allowed) {
          return { ok: true, value: { url: cached.url, title: cached.title, content: cached.content } };
        }
      }
      const result = await reader.read(input, external);
      if (result.ok && sameHostPolicy(hosts, allowedHosts)) {
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
