import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUsageRecorder } from '../../src/infra/usage-recorder.ts';

type Row = { sql: string; values: unknown[] };

function fakeDb() {
  const rows: Row[] = [];
  let batches = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          rows.push({ sql, values });
          return this;
        },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
    },
    async batch(statements: unknown[]) {
      batches++;
      return statements.map(() => ({ success: true }));
    },
  };
  return { db, rows, batches: () => batches };
}

function formData(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

describe('Given a usage recorder inside the retrying fetch', () => {
  it('When an OpenAI completion succeeds Then records the response model, tokens and cost', async t => {
    const { db, rows, batches } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/chat', now: () => 1_000 });
    t.mock.method(globalThis, 'fetch', async () => Response.json({
      model: 'gpt-6.1-terra-2026-10-26',
      usage: { prompt_tokens: 1_000_000, completion_tokens: 200_000 },
    }));
    const response = await recorder.wrap('openai')('https://api.openai.com/v1/chat/completions', { method: 'POST' });
    assert.equal((await response.json() as { model: string }).model, 'gpt-6.1-terra-2026-10-26');
    await recorder.flush();
    assert.equal(batches(), 1);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.values, [
      1_000, '/api/chat', 'openai', 'completion', 'gpt-6.1-terra-2026-10-26', 200, 0, 1_000_000, 200_000, 2,
    ]);
  });

  it('When a transcription succeeds Then uses the request FormData model and leaves missing usage null', async t => {
    const { db, rows } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/talk/transcribe', now: () => 2_000 });
    t.mock.method(globalThis, 'fetch', async () => Response.json({ text: 'こんにちは。' }));
    await recorder.wrap('openai')('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', body: formData({ model: 'gpt-transcribe' }),
    });
    await recorder.flush();
    assert.deepEqual(rows[0]!.values, [
      2_000, '/api/talk/transcribe', 'openai', 'transcribe', 'gpt-transcribe', 200, 0, null, null, 0,
    ]);
  });

  it('When a search succeeds Then records the per-call service cost without reading the body', async t => {
    const { db, rows } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/research', now: () => 3_000 });
    t.mock.method(globalThis, 'fetch', async () => new Response('search body'));
    for (const service of ['brave', 'ncp'] as const) {
      const response = await recorder.wrap(service)(`https://search.example/${service}`);
      assert.equal(await response.text(), 'search body');
    }
    await recorder.flush();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.values.slice(2, 4)), [['brave', 'search'], ['ncp', 'search']]);
    assert.deepEqual(rows.map(row => row.values.at(-1)), [0.005, 0]);
  });

  it('When every retry attempt is recorded Then 429 and 200 both leave one row', async t => {
    const { db, rows } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/chat', now: () => 4_000 });
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? new Response('rate limit', { status: 429 })
      : Response.json({ model: 'gpt-6-luna', usage: { prompt_tokens: 1, completion_tokens: 2 } }));
    const wrapped = recorder.wrap('openai');
    await wrapped('https://api.openai.com/v1/chat/completions');
    await wrapped('https://api.openai.com/v1/chat/completions');
    await recorder.flush();
    assert.deepEqual(rows.map(row => row.values[5]), [429, 200]);
    assert.equal(rows[0]!.values[4], null);
  });

  it('When the provider throws Then records status 0 and rethrows', async t => {
    const { db, rows } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/chat', now: () => 5_000 });
    t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network'); });
    await assert.rejects(() => recorder.wrap('openai')('https://api.openai.com/v1/chat/completions'), TypeError);
    await recorder.flush();
    assert.equal(rows[0]!.values[5], 0);
    assert.equal(rows[0]!.values[9], 0);
  });

  it('When there is no D1 binding Then wrap is a plain fetch no-op and flush resolves', async () => {
    const recorder = createUsageRecorder({ route: '/api/chat' });
    assert.equal(recorder.wrap('openai'), globalThis.fetch);
    recorder.record({ service: 'openai', op: 'realtime', status: 200, ms: 1 });
    await recorder.flush();
  });

  it('When recording a realtime event directly Then stores the supplied usage and cost', async () => {
    const { db, rows } = fakeDb();
    const recorder = createUsageRecorder({ db, route: '/api/talk/speech', now: () => 6_000 });
    recorder.record({
      service: 'openai', op: 'realtime', model: 'gpt-realtime-2.1-mini',
      status: 200, ms: 250, inputTokens: 1_000_000, outputTokens: 1_000_000,
    });
    await recorder.flush();
    assert.deepEqual(rows[0]!.values, [
      6_000, '/api/talk/speech', 'openai', 'realtime', 'gpt-realtime-2.1-mini', 200, 250, 1_000_000, 1_000_000, 30,
    ]);
  });
});
