import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../src/ui/http/api.ts';
import { createReply, type Reply } from '../../src/app/chat.ts';

async function request(method: string, body: string, reply: Reply, accept = '') {
  const api = createApi({ adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } }, reply, queens: { generate: async () => { throw new Error('Unexpected Queens request'); } }, talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } } });
  const response = await api.request('/api/chat', {
    method, headers: { 'Content-Type': 'application/json', Accept: accept },
    ...(method === 'GET' ? {} : { body }),
  });
  const payload = await response.text();
  const headers = Object.fromEntries(response.headers);
  return { status: response.status, headers, body: headers['content-type']?.startsWith('application/x-ndjson')
    ? payload.trim().split('\n').map((line) => JSON.parse(line)) : JSON.parse(payload) };
}

describe('Given the chat HTTP endpoint', () => {
  it('When a request fails Then responds with matching RFC 9457 status and media type', async () => {
    const reply = createReply({ complete: async () => ({ ok: false, reason: '모델 연결 실패' }) });
    const cases = [
      ['GET', '', 405, 'Method Not Allowed', 'POST 요청만 가능합니다.'],
      ['POST', '{invalid', 400, 'Bad Request', '올바른 JSON 요청이 필요합니다.'],
      ['POST', '{"messages":[]}', 400, 'Bad Request', '메시지를 확인해주세요.'],
      ['POST', 'x'.repeat(100_001), 413, 'Content Too Large', '메시지가 너무 깁니다.'],
      ['POST', '{"messages":[{"role":"user","content":"안녕"}]}', 502, 'Bad Gateway', '모델 연결 실패'],
    ] as const;
    for (const [method, body, status, title, detail] of cases) {
      const response = await request(method, body, reply);
      assert.equal(response.status, status);
      assert.equal(response.headers['content-type'], 'application/problem+json');
      assert.deepEqual(response.body, { type: 'about:blank', title, status, detail, instance: '/api/chat' });
      if (status === 405) assert.equal(response.headers.allow, 'POST');
    }
  });

  it('When an unexpected exception occurs Then returns a generic 500 problem without leaking details', async () => {
    const response = await request('POST', '{}', async () => { throw new Error('secret-internal-detail'); });
    assert.equal(response.status, 500);
    assert.equal(response.headers['content-type'], 'application/problem+json');
    assert.equal(response.body.title, 'Internal Server Error');
    assert.equal(response.body.status, 500);
    assert.ok(!JSON.stringify(response.body).includes('secret-internal-detail'));
  });

  it('When successful Then retains the JSON completion response', async () => {
    const reply = createReply({ complete: async () => ({ ok: true, value: '안녕하세요' }) });
    const response = await request('POST', '{"messages":[{"role":"user","content":"안녕"}]}', reply);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(response.body, { content: '안녕하세요' });
  });

  it('When progress streaming is requested Then sends steps before the final answer', async () => {
    const step = { kind: 'thought' as const, summary: '서울과 부산을 비교합니다.' };
    const reply = createReply({ complete: async (_messages, onStep) => {
      onStep?.(step);
      return { ok: true, value: '부산이 더 따뜻합니다.' };
    } });
    const response = await request('POST', '{"messages":[{"role":"user","content":"비교해줘"}]}', reply, 'application/x-ndjson');
    assert.equal(response.headers['content-type'], 'application/x-ndjson; charset=utf-8');
    assert.deepEqual(response.body, [{ type: 'step', step }, { type: 'result', content: '부산이 더 따뜻합니다.' }]);
  });

  it('When an error occurs after progress starts Then sends a Problem Details frame', async () => {
    const reply = createReply({ complete: async (_messages, onStep) => {
      onStep?.({ kind: 'thought', summary: '도구를 확인합니다.' });
      return { ok: false, reason: '같은 도구 요청이 반복되었습니다.' };
    } });
    const response = await request('POST', '{"messages":[{"role":"user","content":"질문"}]}', reply, 'application/x-ndjson');
    assert.deepEqual(response.body.at(-1), { type: 'problem', problem: {
      type: 'about:blank', title: 'Bad Gateway', status: 502, detail: '같은 도구 요청이 반복되었습니다.', instance: '/api/chat',
    } });
  });
});
