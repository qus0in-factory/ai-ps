import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, createReply } from '../../src/app/chat.ts';
import type { ChatMessage } from '../../src/domain/chat.ts';

describe('Given a chat with an injected gateway', () => {
  it('When sending consecutive messages Then includes previous messages', async () => {
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
      [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '답변' },
        { role: 'user', content: '다음 질문' },
      ],
    ]);
    assert.equal(chat.getState().pending, false);
  });

  it('When reloading Then restores saved messages and uses them as context', async () => {
    let saved: ChatMessage[] = [{ role: 'user', content: '이름은 민수' }, { role: 'assistant', content: '안녕하세요' }];
    const memory = {
      load: () => ({ ok: true as const, value: saved }),
      save: (messages: typeof saved) => {
        saved = messages;
        return { ok: true as const, value: undefined };
      },
    };
    const chat = createChat({ complete: async (messages) => {
      assert.equal(messages[0]?.content, '이름은 민수');
      assert.equal(messages.length, 3);
      return { ok: true, value: '민수님' };
    } }, memory);
    assert.equal(chat.getState().messages.length, 2);
    await chat.send('내 이름은?');
    assert.equal(saved.length, 4);
    const reloaded = createChat({ complete: async () => ({ ok: true, value: '' }) }, memory);
    assert.deepEqual(reloaded.getState().messages, saved);
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
