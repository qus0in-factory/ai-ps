import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completion, createOpenAICompletion } from '../../src/infra/openai.ts';
import { createToolChat } from '../../src/app/tool-chat.ts';
import { createTools } from '../../src/infra/tools.ts';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/openweather.json', import.meta.url), 'utf8'));

describe('Given OpenAI completion wired to OpenWeather tools', () => {
  it('When a weather question triggers a tool Then completes the full fetch sequence', async () => {
    let completions = 0;
    let weatherCalls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).startsWith('https://api.openweathermap.org/')) {
        weatherCalls++;
        return Response.json(weatherCalls === 1 ? [fixture.location] : fixture.weather);
      }
      const body = JSON.parse(init!.body as string);
      assert.equal(body.model, 'test-model');
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.messages[0].role, 'system');
      assert.ok(body.messages[0].content.includes('get_current_weather'));
      assert.equal(body.stream, false);
      if (++completions === 1) return Response.json({ choices: [{ message: {
        role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } }),
      } }] });
      assert.equal(body.messages.at(-1).role, 'user');
      const weather = JSON.parse(body.messages.at(-1).content).result.value;
      assert.equal(weather.temperature_c, fixture.weather.main.temp);
      assert.ok(!JSON.stringify(body).includes('owm-secret'));
      return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ type: 'message', content: '날씨 조회 결과입니다.' }) } }] });
    };
    const chat = createToolChat(
      createOpenAICompletion({ model: 'test-model', apiKey: 'openai-test', fetcher }),
      createTools({ apiKey: 'owm-secret', fetcher }),
    );
    assert.deepEqual(await chat.complete([{ role: 'user', content: '서울 날씨' }]), {
      ok: true, value: '날씨 조회 결과입니다.',
    });
    assert.equal(completions, 2);
    assert.equal(weatherCalls, 2);
  });
});

describe('Given OpenAI native function calling', () => {
  it('When tools are provided Then sends the native schema and reasoning_effort none', async () => {
    const model = createOpenAICompletion({ model: 'test-model', apiKey: 'test', fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.response_format, undefined);
      assert.equal(body.tools[0].type, 'function');
      assert.equal(body.tools[0].function.name, 'get_current_time');
      assert.equal(body.tools[0].function.strict, true);
      assert.equal(body.reasoning_effort, 'none');
      return Response.json({ choices: [{ message: { role: 'assistant', content: '현재 시간입니다.' } }] });
    } });
    const result = await model.complete([{ role: 'user', content: '시간' }], [{
      name: 'get_current_time', description: 'Current time',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    }]);
    assert.equal(result.ok, true);
  });
});

describe('Given a tool-forced chat function completion', () => {
  it('When forcing a tool with temperature and signal Then forwards the options and cancellation without serializing the signal', async () => {
    const controller = new AbortController();
    const model = createOpenAICompletion({ model: 'test-model', apiKey: 'test', fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.equal(body.temperature, 0.8);
      assert.equal(body.reasoning_effort, 'none');
      assert.equal(body.parallel_tool_calls, false);
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'verify_puzzle' } });
      assert.equal(body.signal, undefined);
      assert.notEqual(init!.signal, controller.signal);
      controller.abort();
      assert.equal(init!.signal!.aborted, true);
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [] } }] });
    } });
    const result = await model.complete([{ role: 'user', content: '퍼즐 검증' }], [{ name: 'verify_puzzle', description: 'Verify puzzle', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } }], {
      temperature: 0.8, parallel_tool_calls: false, tool_choice: { type: 'function', function: { name: 'verify_puzzle' } }, signal: controller.signal,
    });
    assert.equal(result.ok, true);
  });
});

describe('Given an OpenAI-compatible completion endpoint', () => {
  it('When no base URL is configured Then posts to api.openai.com/v1/chat/completions by default', async () => {
    let requestedUrl: string | undefined;
    const model = createOpenAICompletion({ model: 'test-model', apiKey: 'test', fetcher: async (url) => {
      requestedUrl = String(url);
      return Response.json({ choices: [{ message: { role: 'assistant', content: '기본 엔드포인트입니다.' } }] });
    } });
    const result = await model.complete([{ role: 'user', content: '안녕' }]);
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, 'https://api.openai.com/v1/chat/completions');
  });

  it('When a base URL is configured Then posts to that endpoint instead', async () => {
    let requestedUrl: string | undefined;
    const model = createOpenAICompletion({ model: 'test-model', apiKey: 'test', baseUrl: 'https://gateway.example.com/openai/v1/', fetcher: async (url) => {
      requestedUrl = String(url);
      return Response.json({ choices: [{ message: { role: 'assistant', content: '게이트웨이 응답입니다.' } }] });
    } });
    const result = await model.complete([{ role: 'user', content: '안녕' }]);
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, 'https://gateway.example.com/openai/v1/chat/completions');
  });
});

describe('Given a JSON-mode completion without tools', () => {
  for (const reasoningEffort of ['medium', 'high'] as const) {
    it(`When a Queens-only gateway configures ${reasoningEffort} Then sends that reasoning effort without temperature or tool options`, async () => {
      let body: Record<string, unknown> = {};
      const model = createOpenAICompletion({ model: 'test', apiKey: 'test', reasoningEffort, fetcher: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { role: 'assistant', content: '{"regions":[]}' } }] });
      } });
      assert.equal((await model.complete([], { response_format: { type: 'json_object' } })).ok, true);
      assert.equal(body.reasoning_effort, reasoningEffort);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      for (const key of ['temperature', 'tools', 'tool_choice', 'parallel_tool_calls']) assert.equal(key in body, false);
    });
  }

  it('When only response_format json_object is passed Then omits temperature, reasoning_effort, tools, and tool_choice from the request body', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const model = createOpenAICompletion({ model: 'test-model', apiKey: 'test', fetcher: async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { role: 'assistant', content: '{"regions":[]}' } }] });
    } });
    const result = await model.complete(
      [{ role: 'user', content: '영역 디자인' }],
      { response_format: { type: 'json_object' } },
    );
    assert.equal(result.ok, true);
    assert.ok(capturedBody);
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
    assert.equal('temperature' in capturedBody, false);
    assert.equal('reasoning_effort' in capturedBody, false);
    assert.equal('tools' in capturedBody, false);
    assert.equal('tool_choice' in capturedBody, false);
  });
});


describe('Given untrusted completion provider failures', () => {
  for (const kind of ['json', 'text', 'network'] as const) {
    it(`When a ${kind} failure contains credentials Then returns a generic reason and logs only bounded redacted diagnostics`, async t => {
      const apiKey = 'FAKE_REVIEW_KEY_DO_NOT_USE';
      const otherKey = 'sk-proj-otherProviderSecret123456789';
      const url = 'https://user:password@gateway.example/v1?token=private-query';
      const message = `provider diagnostic: ${apiKey} ${otherKey} Bearer bearer-private-value ${url} api_key=another-private-value ` + 'x'.repeat(2_000);
      const logs: unknown[] = [];
      t.mock.method(console, 'error', (entry: unknown) => logs.push(entry));
      const model = createOpenAICompletion({
        model: 'test-model', apiKey,
        fetcher: async () => {
          if (kind === 'network') throw new Error(message);
          return kind === 'json'
            ? Response.json({ error: { message } }, { status: 401 })
            : new Response(message, { status: 502, statusText: 'Bad Gateway' });
        },
      });
      const chat = createToolChat(model, [], entry => logs.push(entry));
      const result = await chat.complete([{ role: 'user', content: 'hello' }]);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, kind === 'network'
        ? '모델 공급자에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'
        : `모델 공급자 요청에 실패했습니다. (HTTP ${kind === 'json' ? 401 : 502})`);
      const serialized = JSON.stringify({ result, logs });
      for (const secret of [apiKey, otherKey, 'bearer-private-value', 'private-query', 'password', 'another-private-value']) {
        assert.ok(!serialized.includes(secret), `must redact ${secret}`);
      }
      const diagnostic = logs.find(entry => (entry as { event?: string }).event === 'completion_error') as { message: string; status?: number } | undefined;
      assert.ok(diagnostic, 'must record a sanitized provider diagnostic');
      assert.equal(diagnostic.message, undefined);
      assert.ok(!serialized.includes('provider diagnostic'));
      assert.equal(typeof (diagnostic as unknown as { code: unknown }).code, 'string');
      assert.ok(!result.reason.includes('provider diagnostic'));

    });
  }
});

describe('Given a completion caller cancellation signal', () => {
  for (const withCaller of [false, true]) {
    it(`When the default deadline expires ${withCaller ? 'with' : 'without'} a caller signal Then distinguishes it from a network failure`, async t => {
      const deadline = new AbortController();
      const logs: unknown[] = [];
      t.mock.method(console, 'error', (entry: unknown) => logs.push(entry));
      t.mock.method(AbortSignal, 'timeout', (ms: number) => {
        assert.equal(ms, 60_000);
        return deadline.signal;
      });
      const result = await completion({ model: 'test', messages: [] }, {
        apiKey: 'test', signal: withCaller ? new AbortController().signal : undefined,
        fetcher: async (_url, init) => {
          deadline.abort(new DOMException('deadline', 'TimeoutError'));
          init!.signal!.throwIfAborted();
          throw new Error('Must have aborted');
        },
      });
      assert.deepEqual(result, { ok: false, reason: '모델 응답 시간이 초과되었습니다.' });
      assert.equal((logs[0] as { code: string }).code, 'provider_timeout');
    });
  }

  for (const nativeSignature of [false, true]) {
    it(`When a longer timeout is supplied through ${nativeSignature ? 'native' : 'plain'} options Then applies it locally without sending it to the provider`, async t => {
      const durations: number[] = [];
      t.mock.method(AbortSignal, 'timeout', (ms: number) => {
        durations.push(ms);
        return new AbortController().signal;
      });
      const model = createOpenAICompletion({ model: 'test', apiKey: 'test', fetcher: async (_url, init) => {
        assert.equal('timeoutMs' in JSON.parse(String(init?.body)), false);
        return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
      } });
      const options = { timeoutMs: 180_000 };
      const result = nativeSignature ? await model.complete([], [], options) : await model.complete([], options);
      assert.equal(result.ok, true);
      assert.deepEqual(durations, [180_000]);
    });
  }

  it('When a caller signal is supplied Then also enforces the 60 second deadline', async t => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const durations: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (ms: number) => { durations.push(ms); return deadline.signal; });
    const result = await completion({ model: 'test', messages: [] }, {
      apiKey: 'test', signal: caller.signal,
      fetcher: async (_url, init) => {
        assert.notEqual(init!.signal, caller.signal);
        deadline.abort(new DOMException('deadline', 'TimeoutError'));
        assert.equal(init!.signal!.aborted, true);
        assert.equal(init!.signal!.reason.name, 'TimeoutError');
        assert.equal(caller.signal.aborted, false);
        return Response.json({ choices: [] });
      },
    });
    assert.deepEqual(durations, [60_000]);
    assert.equal(result.ok, true);
  });

  it('When the caller has already cancelled Then the composed signal remains aborted', async () => {
    const caller = new AbortController();
    caller.abort('cancelled');
    let observed: AbortSignal | null | undefined;
    await completion({ model: 'test', messages: [] }, {
      apiKey: 'test', signal: caller.signal,
      fetcher: async (_url, init) => { observed = init!.signal; return Response.json({ choices: [] }); },
    });
    assert.equal(observed?.aborted, true);
    assert.equal(observed?.reason, 'cancelled');
  });
});


describe('Given completion output and diagnostic budgets', () => {
  it('When an output token limit is requested Then forwards it to the provider', async () => {
    let limit: unknown;
    const model = createOpenAICompletion({ model: 'test', apiKey: 'test', fetcher: async (_url, init) => {
      limit = JSON.parse(String(init?.body)).max_completion_tokens;
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    } });
    await model.complete([], [], { max_completion_tokens: 1600 });
    assert.equal(limit, 1600);
  });
  it('When debug diagnostics are explicitly enabled Then only debug receives a redacted bounded message', async t => {
    const errors: unknown[] = [], debug: unknown[] = [];
    t.mock.method(console, 'error', (entry: unknown) => errors.push(entry));
    t.mock.method(console, 'debug', (entry: unknown) => debug.push(entry));
    const model = createOpenAICompletion({ model: 'test', apiKey: 'sk-private-secret', debugErrors: true, fetcher: async () => Response.json({ error: { message: 'private user phrase sk-private-secret ' + 'x'.repeat(2000) } }, { status: 400 }) });
    await model.complete([]);
    assert.ok(!JSON.stringify(errors).includes('private user phrase'));
    assert.ok(JSON.stringify(debug).includes('private user phrase'));
    assert.ok(!JSON.stringify(debug).includes('sk-private-secret'));
    assert.ok((debug[0] as { message: string }).message.length <= 512);
  });
});

describe('Given tool-specific completion options without tools', () => {
  for (const nativeSignature of [false, true]) {
    it(`When tool options are supplied using ${nativeSignature ? 'native' : 'plain'} options Then strips them from the request body`, async () => {
      let body: Record<string, unknown> = {};
      const model = createOpenAICompletion({ model: 'test', apiKey: 'test', fetcher: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
      } });
      const options = { response_format: { type: 'json_object' as const }, parallel_tool_calls: false, tool_choice: { type: 'function' as const, function: { name: 'roll_dice' } } };
      const result = nativeSignature ? await model.complete([], [], options) : await model.complete([], options);
      assert.equal(result.ok, true);
      for (const key of ['tools', 'tool_choice', 'parallel_tool_calls']) assert.equal(Object.hasOwn(body, key), false);
      assert.deepEqual(body.response_format, { type: 'json_object' });
    });
  }
});

describe('Given an explicit reasoning option for a tool-free summary', () => {
  it('When reasoning none is requested Then forwards it independently of tool-only options', async () => {
    let body: Record<string, unknown> = {};
    const model = createOpenAICompletion({ model: 'test', apiKey: 'test', fetcher: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      assert.ok(!('tools' in body)); assert.ok(!('parallel_tool_calls' in body)); assert.ok(!('tool_choice' in body));
      return Response.json({ choices: [{ message: { role: 'assistant', content: '당신은 렌즈를 찾았습니다.' } }] });
    } });
    const result = await model.complete([{ role: 'user', content: '이전 진행을 요약하라.' }], [], { reasoning_effort: 'none', max_completion_tokens: 400 });
    assert.equal(result.ok, true); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.max_completion_tokens, 400);
    assert.ok(!('temperature' in body));
  });
});
