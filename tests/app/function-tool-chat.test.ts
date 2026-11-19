import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFunctionToolChat } from '../../src/app/function-tool-chat.ts';
import type { ToolLogEvent } from '../../src/domain/tools.ts';

const definition = { name: 'get_current_time', description: 'Current time', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } };

describe('Given native function calling', () => {
  it('When the model requests functions Then executes all calls and sends tool results with matching IDs', async () => {
    let turn = 0;
    const logs: ToolLogEvent[] = [];
    const chat = createFunctionToolChat({ complete: async (messages, tools) => {
      assert.deepEqual(tools, [definition]);
      if (turn++ === 0) return { ok: true, value: { role: 'assistant', content: null, tool_calls: [
        { id: 'time-1', type: 'function', function: { name: 'get_current_time', arguments: '{}' } },
        { id: 'time-2', type: 'function', function: { name: 'get_current_time', arguments: '{}' } },
      ] } };
      assert.deepEqual(messages.slice(-2), [
        { role: 'tool', tool_call_id: 'time-1', content: '{"ok":true,"value":{"time":"20:00"}}' },
        { role: 'tool', tool_call_id: 'time-2', content: '{"ok":true,"value":{"time":"20:00"}}' },
      ]);
      return { ok: true, value: { role: 'assistant', content: '현재 20시입니다.' } };
    } }, [{ definition, effect: 'read' as const, execute: async () => ({ ok: true, value: { time: '20:00' } }) }], (entry) => logs.push(entry));
    assert.deepEqual(await chat.complete([{ role: 'user', content: '지금 시간' }]), { ok: true, value: '현재 20시입니다.' });
    assert.equal(logs.filter((entry) => entry.event === 'tool_call').length, 2);
    assert.equal(logs.filter((entry) => entry.event === 'tool_result').length, 2);
  });

  it('When arguments are invalid Then returns an error to the model without executing the tool', async () => {
    let turn = 0;
    const chat = createFunctionToolChat({ complete: async (messages) => {
      if (turn++ === 0) return { ok: true, value: { role: 'assistant', content: null, tool_calls: [
        { id: 'bad', type: 'function', function: { name: 'get_current_time', arguments: '{invalid' } },
      ] } };
      assert.equal(JSON.parse(messages.at(-1)!.content!).ok, false);
      return { ok: true, value: { role: 'assistant', content: '다시 시도해주세요.' } };
    } }, [{ definition, effect: 'read' as const, execute: async () => { throw new Error('Must not execute'); } }]);
    assert.equal((await chat.complete([{ role: 'user', content: '시간' }])).ok, true);
  });
});
