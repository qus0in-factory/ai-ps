export interface ResearchRateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export type ResearchRateLimit = (key: string) => Promise<'allowed' | 'limited' | 'unavailable'>;
