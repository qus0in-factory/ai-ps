import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../../src/infra/http-client.ts';
import { createOpenAICompletion } from '../../src/infra/openai.ts';
import { createResearchAgent } from '../../src/app/research/agent.ts';

describe('Given the common HTTP client with 8.2 retry policy', () => {
  it('When 429, 5xx or network errors occur Then retries up to 3 times with 2^n + jitter backoff', async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = createHttpClient({
      random: () => 0.25,
      sleep: async (ms) => { delays.push(ms); },
      fetcher: async () => {
        calls++;
        if (calls === 1) throw new TypeError('network error');
        if (calls === 2) return new Response('rate limit', { status: 429 });
        if (calls === 3) return new Response('server error', { status: 503 });
        return new Response('ok', { status: 200 });
      },
    });
    const response = await client('https://api.example.com/v1');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
    assert.equal(calls, 4);
    assert.deepEqual(delays, [1250, 2250, 4250]);
  });

  it('When non-retryable 4xx or 3xx responses occur Then returns immediately without retry', async () => {
    for (const status of [302, 400, 401, 403, 404]) {
      const delays: number[] = [];
      let calls = 0;
      const client = createHttpClient({
        sleep: async (ms) => { delays.push(ms); },
        fetcher: async () => { calls++; return new Response(null, { status }); },
      });
      const response = await client('https://api.example.com/v1');
      assert.equal(response.status, status);
      assert.equal(calls, 1);
      assert.deepEqual(delays, []);
    }
  });

  it('When the caller signal aborts Then stops immediately without further retries', async () => {
    const controller = new AbortController();
    let calls = 0;
    const client = createHttpClient({
      fetcher: async (_input, init) => {
        calls++;
        setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 5);
        init?.signal?.throwIfAborted();
        throw new Error('network error');
      },
    });
    await assert.rejects(
      () => client('https://api.example.com/v1', { signal: controller.signal }),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
    assert.equal(calls, 1);
  });

  it('When the primary OpenAI model fails after retries Then falls back once to gpt-6.1-terra', async () => {
    const models: string[] = [];
    const delays: number[] = [];
    const client = createHttpClient({
      random: () => 0,
      sleep: async (ms) => { delays.push(ms); },
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        models.push(body.model);
        if (models.length <= 4) return new Response('overloaded', { status: 503 });
        return Response.json({ choices: [{ message: { role: 'assistant', content: '폴백 응답' } }] });
      },
    });
    const gateway = createOpenAICompletion({
      model: 'gpt-6-luna',
      apiKey: 'test-key',
      logErrors: false,
      fetcher: client,
    });
    const result = await gateway.complete([{ role: 'user', content: '안녕' }]);
    assert.deepEqual(result, { ok: true, value: { role: 'assistant', content: '폴백 응답' } });
    assert.deepEqual(models, ['gpt-6-luna', 'gpt-6-luna', 'gpt-6-luna', 'gpt-6-luna', 'gpt-6.1-terra']);
    assert.deepEqual(delays, [1000, 2000, 4000]);
  });

  it('When research model fails after collecting search results Then returns the collected search list', async () => {
    let turn = 0;
    const agent = createResearchAgent({
      model: {
        complete: async () => {
          if (++turn === 1) {
            return {
              ok: true,
              value: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 's1', type: 'function', function: { name: 'search_web', arguments: '{"query":"도시 공원"}' } }],
              },
            };
          }
          return { ok: false, reason: '모델 오류' };
        },
      },
      search: async () => ({
        ok: true,
        value: [{ title: '공원 안내', url: 'https://example.com/park', summary: '도심 공원 요약' }],
      }),
      read: async () => ({ ok: true, value: '본문' }),
    });
    const result = await agent.run('도시 공원');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.value.report, /공원 안내/);
      assert.match(result.value.report, /https:\/\/example\.com\/park/);
      assert.deepEqual(result.value.sources, ['https://example.com/park']);
    }
  });
});
