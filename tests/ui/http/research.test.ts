import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpResearch } from '../../../src/infra/http-research.ts';
import type { ResearchClient as UiResearchClient } from '../../../src/ui/widgets/research/types.ts';

const report = {
  report: '## 개요\n\n태양광 발전량이 늘고 있다. [출처](https://example.com/a)',
  steps: [
    { tool: 'search_web' as const, args: { query: '태양광 발전' }, ok: true },
    { tool: 'read_webpage' as const, args: { url: 'https://example.com/a' }, ok: false },
  ],
  sources: ['https://example.com/a'],
  iterations: 2,
  capped: false,
};

describe('Given the research HTTP client', () => {
  it('When a topic is submitted Then posts only the contract JSON and returns the validated report', async () => {
    const requests: { path: string; init?: RequestInit }[] = [];
    const client = createHttpResearch(async (path, init) => {
      requests.push({ path: String(path), init });
      return Response.json(report);
    });
    const outcome = await client.run('  태양광 발전 전망  ');
    assert.deepEqual(outcome, { ok: true, value: report });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.path, '/api/research');
    assert.equal(requests[0]!.init?.method, 'POST');
    assert.equal(JSON.parse(String(requests[0]!.init?.body)).topic, '태양광 발전 전망');
    const headers = requests[0]!.init?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers.Authorization, undefined);
    assert.ok(requests[0]!.init?.signal);
  });

  it('When the topic is blank or over 200 characters Then rejects before any network call', async () => {
    let called = 0;
    const client = createHttpResearch(async () => { called++; return Response.json(report); });
    for (const topic of ['', '   ', 'x'.repeat(201)]) {
      const outcome = await client.run(topic);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.match(outcome.reason, /1~200/);
    }
    assert.equal(called, 0);
  });

  it('When the endpoint returns problem JSON, a malformed report or a transport failure Then returns a safe failure', async () => {
    const problem = await createHttpResearch(async () => Response.json({ error: '조사 한도를 넘었습니다.' }, { status: 502 })).run('주제');
    assert.deepEqual(problem, { ok: false, reason: '조사 한도를 넘었습니다.' });
    const raw = await createHttpResearch(async () => new Response('SECRET raw body', { status: 500 })).run('주제');
    assert.equal(raw.ok, false);
    if (!raw.ok) assert.doesNotMatch(raw.reason, /SECRET/);
    assert.equal((await createHttpResearch(async () => Response.json({ detail: '다른 오류' }, { status: 500 })).run('주제')).ok, false);

    const malformed: unknown[] = [
      {},
      { ...report, report: '' },
      { ...report, extra: true },
      { ...report, steps: [{ tool: 'browse', args: {}, ok: true }] },
      { ...report, steps: [{ tool: 'search_web', args: null, ok: true }] },
      { ...report, steps: 'search_web' },
      { ...report, sources: [42] },
      { ...report, iterations: 1.5 },
      { ...report, capped: 'no' },
    ];
    for (const body of malformed) {
      assert.equal((await createHttpResearch(async () => Response.json(body)).run('주제')).ok, false);
    }
    const brokenJson = await createHttpResearch(async () => new Response('{oops')).run('주제');
    assert.equal(brokenJson.ok, false);
  });

  it('When the caller cancels Then returns a cancellation failure without leaking the raw error', async () => {
    const caller = new AbortController();
    const client = createHttpResearch(async () => {
      caller.abort();
      return await new Promise<Response>(() => {});
    });
    const outcome = await client.run('주제', caller.signal);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.reason, /중단|시간/);
  });

  it('When wiring the UI contract Then the implementation satisfies the UI client type', () => {
    const client: UiResearchClient = createHttpResearch(async () => Response.json(report));
    assert.equal(typeof client.run, 'function');
  });
});
