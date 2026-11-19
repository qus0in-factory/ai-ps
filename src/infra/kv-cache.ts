/** Structural subset of the Workers KV binding; no SDK runtime is needed. */
export interface KVNamespace {
  get(key: string, type?: 'json' | 'text'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface KvJsonCache {
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
  set(key: string, value: unknown): Promise<void>;
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
    async put(key: string, value: unknown): Promise<void> {
      if (!kv) return;
      try {
        await kv.put(prefix + key, JSON.stringify(value), ttl > 0 ? { expirationTtl: ttl } : undefined);
      } catch {
        // KV write failures are ignored; research is cheap.
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      await this.put(key, value);
    },
  };
}