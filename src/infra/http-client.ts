const MAX_RETRIES = 3;

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createHttpClient(options: {
  fetcher?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
} = {}): typeof fetch {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;
  return async (input, init) => {
    const signal = init?.signal;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await (options.fetcher ?? fetch)(input, init);
        if (!isRetryableStatus(response.status) || attempt === maxRetries || signal?.aborted) {
          return response;
        }
        void response.body?.cancel().catch(() => {});
      } catch (error) {
        if (attempt === maxRetries || signal?.aborted) throw error;
      }
      const jitter = Math.min(1, Math.max(0, random()));
      await wait((2 ** attempt + (Number.isFinite(jitter) ? jitter : 0)) * 1000, signal);
    }
    throw new Error('Retry budget exhausted');
  };
}

export const fetchWithRetry: typeof fetch = createHttpClient();
