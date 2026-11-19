/** Structural subset of the Workers KV binding; no SDK runtime is needed. */
export interface KVNamespace {
  get(key: string, type?: 'json' | 'text'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface KvJsonCache {
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
}

export function createKvJsonCache(
  kv: KVNamespace | undefined,
  options: { prefix?: string; ttlSeconds: number },
): KvJsonCache {
  const prefix = options.prefix ?? '';
  const ttl = options.ttlSeconds;
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      if (!kv) return null;
      try {
        const value = await kv.get(prefix + key, 'json');
        return (value ?? null) as T | null;
      } catch {
        return null;
      }
    },
    async put(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      if (!kv) return;
      const effectiveTtl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : ttl;
      try {
        await kv.put(prefix + key, JSON.stringify(value), effectiveTtl > 0 ? { expirationTtl: effectiveTtl } : undefined);
      } catch {
        // KV write failures are ignored; research is cheap.
      }
    },
    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      await this.put(key, value, ttlSeconds);
    },
  };
}