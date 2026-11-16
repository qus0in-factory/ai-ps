import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolResponse } from '../../src/domain/tool-response.ts';

describe('Given JSON responses from a prompted model', () => {
  it('When JSON is fenced or surrounded by prose Then extracts and validates the object', () => {
    const action = { type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } };
    const json = JSON.stringify(action);
    for (const content of [json, `\uFEFF${json}`, `\`\`\`json\n${json}\n\`\`\``, `날씨를 확인하겠습니다.\n${json}\n조회 요청입니다.`]) {
      assert.deepEqual(parseToolResponse(content), { ok: true, value: action });
    }
    const answer = { type: 'message', content: '중괄호 {와 } 및 "따옴표"가 있는 답변' };
    assert.deepEqual(parseToolResponse(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``), { ok: true, value: answer });
  });

  it('When JSON is broken or contains multiple actions Then does not guess an action', () => {
    for (const content of ['일반 텍스트 답변', '{"type":"tool_call",',
      '{"type":"tool_call","name":"get_current_time","arguments":{}}\n{"type":"message","content":"완료"}',
      '[{"type":"tool_call","name":"get_current_time","arguments":{}}]']) {
      assert.equal(parseToolResponse(content).ok, false);
    }
  });
});
