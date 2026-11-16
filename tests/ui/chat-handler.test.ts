import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createChatHandler } from '../../src/ui/chat-handler.ts';
import { createReply, type Reply } from '../../src/app/chat.ts';

async function request(method: string, body: string, reply: Reply) {
  const req = Readable.from([Buffer.from(body)]) as IncomingMessage;
  req.method = method;
  req.url = '/api/chat';
  const headers: Record<string, string> = {};
  let payload = '';
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(value: string) { payload = value; },
  };
  await createChatHandler(reply)(req, res as unknown as ServerResponse, () => assert.fail('Unexpected next'));
  return { status: res.statusCode, headers, body: JSON.parse(payload) };
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
});
