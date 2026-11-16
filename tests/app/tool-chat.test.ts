import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createToolChat } from '../../src/app/tool-chat.ts';
import type { Tool, ToolLogEvent } from '../../src/domain/tools.ts';

const definition = {
  name: 'get_current_weather', description: 'Current weather',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
};
const answer = (content: string) => ({ ok: true as const, value: { role: 'assistant' as const, content } });

describe('Given a chat using prompted JSON tool calls', () => {
  it('When the model requests a tool Then parses JSON and sends the result back as a message', async () => {
    let turn = 0;
    const logs: ToolLogEvent[] = [];
    const tools: Tool[] = [{ definition, execute: async (args) => {
      assert.deepEqual(args, { city: 'Seoul,KR' });
      return { ok: true, value: { temperature: 10 } };
    } }];
    const chat = createToolChat({ complete: async (messages) => {
      assert.equal(messages[0]?.role, 'system');
      assert.ok(messages[0]!.content.includes('get_current_weather'));
      if (turn++ === 0) return answer('{"type":"tool_call","name":"get_current_weather","arguments":{"city":"Seoul,KR"}}');
      assert.deepEqual(JSON.parse(messages.at(-1)!.content), {
        type: 'tool_result', name: 'get_current_weather', result: { ok: true, value: { temperature: 10 } },
      });
      assert.equal(messages.at(-1)!.role, 'user');
      return answer('{"type":"message","content":"서울은 10도입니다."}');
    } }, tools, (entry) => logs.push(entry));
    assert.deepEqual(await chat.complete([{ role: 'user', content: '서울 날씨' }]), { ok: true, value: '서울은 10도입니다.' });
    assert.deepEqual(logs.map((entry) => entry.event), [
      'model_request', 'model_response', 'tool_call', 'tool_result', 'model_request', 'model_response',
    ]);
    assert.deepEqual(logs.find((entry) => entry.event === 'tool_result'), {
      event: 'tool_result', turn: 1, name: 'get_current_weather', result: { ok: true, value: { temperature: 10 } },
    });
  });

  it('When model JSON is malformed or invalid Then returns a failure without executing tools', async () => {
    for (const content of ['{invalid', 'null', '[]', '{}', '{"type":"message","content":3}',
      '{"type":"tool_call","name":"get_current_weather","arguments":"bad"}']) {
      const chat = createToolChat({ complete: async () => answer(content) }, [{
        definition, execute: async () => { throw new Error('Must not execute'); },
      }]);
      assert.equal((await chat.complete([{ role: 'user', content: '날씨' }])).ok, false);
    }
  });

  it('When the first response is not JSON Then requests one correction and returns the valid answer', async () => {
    let calls = 0;
    const logs: ToolLogEvent[] = [];
    const chat = createToolChat({ complete: async (messages) => {
      if (calls++ === 0) return answer('현재 시간을 조회하겠습니다.');
      assert.match(messages.at(-1)!.content, /JSON/);
      assert.equal(messages.at(-2)!.content, '현재 시간을 조회하겠습니다.');
      return answer('{"type":"message","content":"다시 작성한 답변입니다."}');
    } }, [], (entry) => logs.push(entry));
    assert.deepEqual(await chat.complete([{ role: 'user', content: '안녕' }]), { ok: true, value: '다시 작성한 답변입니다.' });
    assert.equal(calls, 2);
    assert.equal(logs.filter((entry) => entry.event === 'parse_error').length, 1);
  });

  it('When conversation history has plain assistant replies Then wraps them in the expected JSON format', async () => {
    const chat = createToolChat({ complete: async (messages) => {
      assert.deepEqual(JSON.parse(messages[2]!.content), { type: 'message', content: '이전 답변' });
      return answer('{"type":"message","content":"다음 답변"}');
    } }, []);
    await chat.complete([
      { role: 'user', content: '이전 질문' }, { role: 'assistant', content: '이전 답변' },
      { role: 'user', content: '다음 질문' },
    ]);
  });

  it('When a tool returns a failure Then the model receives the failure and can explain it', async () => {
    let turn = 0;
    const chat = createToolChat({ complete: async (messages) => {
      if (turn++ === 0) return answer('{"type":"tool_call","name":"get_current_weather","arguments":{"city":"Seoul"}}');
      assert.equal(JSON.parse(messages.at(-1)!.content).result.reason, '날씨 서비스 연결 실패');
      return answer('{"type":"message","content":"날씨 서비스에 연결하지 못했습니다."}');
    } }, [{ definition, execute: async () => ({ ok: false, reason: '날씨 서비스 연결 실패' }) }]);
    assert.deepEqual(await chat.complete([{ role: 'user', content: '날씨' }]), {
      ok: true, value: '날씨 서비스에 연결하지 못했습니다.',
    });
  });

  it('When the model repeatedly requests unknown tools Then stops at the call limit', async () => {
    let count = 0;
    const chat = createToolChat({ complete: async () => {
      count++;
      return answer('{"type":"tool_call","name":"unknown","arguments":{}}');
    } }, []);
    assert.equal((await chat.complete([{ role: 'user', content: '날씨' }])).ok, false);
    assert.equal(count, 5);
  });
});
