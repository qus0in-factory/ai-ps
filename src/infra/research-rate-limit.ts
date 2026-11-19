import type { ResearchRateLimit, ResearchRateLimitBinding } from '../domain/research/rate-limit.ts';
export function createResearchRateLimit(binding?: ResearchRateLimitBinding, options: { required?: boolean } = {}): ResearchRateLimit {
  return async key => {
    // Local Vite has no binding; Workers must fail closed if deployment omits it.
    if (!binding) return options.required ? 'unavailable' : 'allowed';
    try { return (await binding.limit({ key })).success ? 'allowed' : 'limited'; }
    catch { return 'unavailable'; }
  };
}
