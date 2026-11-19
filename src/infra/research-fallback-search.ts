import type { ResearchSearchProvider } from './research-merged-search.ts';
import { mergeResearchSearchResults } from './research-merged-search.ts';

export interface PrimaryFallbackSearchOptions {
  minHits?: number;
}

function hasKorean(value: string): boolean {
  return /[가-힣]/.test(value);
}

function normalizeMax(max: number | undefined): number {
  return Number.isFinite(max) ? Math.max(1, Math.min(20, Math.floor(max as number))) : 5;
}

export function createPrimaryFallbackSearch(
  primary: ResearchSearchProvider,
  fallback: ResearchSearchProvider,
  options: PrimaryFallbackSearchOptions = {},
): ResearchSearchProvider {
  const minHits = options.minHits ?? 2;
  return {
    async search(query, max, external) {
      const count = normalizeMax(max);
      if (!hasKorean(query)) {
        return fallback.search(query, count, external);
      }
      const primaryResult = await primary.search(query, count, external);
      if (!primaryResult.ok) {
        return fallback.search(query, count, external);
      }
      if (primaryResult.value.length >= minHits) {
        return { ok: true, value: primaryResult.value.slice(0, count) };
      }
      const fallbackResult = await fallback.search(query, count, external);
      if (!fallbackResult.ok) {
        return primaryResult;
      }
      return { ok: true, value: mergeResearchSearchResults([primaryResult.value, fallbackResult.value], count) };
    },
  };
}

export const createFallbackSearch = createPrimaryFallbackSearch;