import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, createReply } from '../../src/app/chat.ts';

describe('Given a chat with an injected gateway', () => {
  it('When sending consecutive messages Then sends only the current message', async () => {
    const calls: unknown[] = [];
    const chat = createChat({ complete: async (messages) => {
      calls.push(messages);
      return { ok: true, value: '답변' };
    } });
    await chat.send('안녕');
    await chat.send('다음 질문');
    assert.equal(chat.getState().messages.length, 4);
    assert.deepEqual(calls, [
      [{ role: 'user', content: '안녕' }],
      [{ role: 'user', content: '다음 질문' }],
    ]);
    assert.equal(chat.getState().pending, false);
  });

  it('When a request fails Then restores the draft without leaving an unanswered message', async () => {
    const chat = createChat({ complete: async () => ({ ok: false, reason: '연결 오류' }) });
    await chat.send('질문');
    assert.deepEqual(chat.getState(), {
      messages: [], draft: '질문', pending: false, error: '연결 오류',
    });
  });

  it('When the request is invalid Then rejects it before calling the gateway', async () => {
    const reply = createReply({ complete: async () => { throw new Error('Must not be called'); } });
    assert.deepEqual(await reply({ messages: [{ role: 'system', content: 'x' }] }), {
      ok: false, reason: '메시지를 확인해주세요.', status: 400,
    });
  });
});
