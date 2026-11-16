import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompletion } from '../../src/infra/openai.ts';
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
      assert.equal(body.response_format, undefined);
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
