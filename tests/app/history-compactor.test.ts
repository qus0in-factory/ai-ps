import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryCompactor } from '../../src/app/history-compactor.ts';
import type { ChatMessage } from '../../src/domain/chat.ts';
import type { CompletionGateway } from '../../src/domain/completion.ts';

const talk = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: `m${i}` }));

const reply = (content: string) => ({ ok: true as const, value: { role: 'assistant' as const, content } });

describe('Given a history compactor with max 12 and keep 6', () => {
  it('When the history is within max Then returns it unchanged without a model call', async () => {
    const messages = talk(12);
    const compact = createHistoryCompactor({ complete: async () => { throw Error('must not call'); } });
    assert.equal(await compact(messages), messages);
  });

  it('When the history exceeds max Then summarizes the front once and keeps the recent six', async () => {
    const calls: { messages: ChatMessage[]; options: unknown }[] = [];
    const compact = createHistoryCompactor({ complete: async (messages, options) => {
      calls.push({ messages, options });
      return reply('사용자가 인사를 주고받았고 날씨를 물었다');
    } });
    const messages = talk(13);
    const out = await compact(messages);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.messages.length, 8); // 시스템 프롬프트 1 + 앞부분 7
    assert.equal(calls[0]!.messages[0]!.role, 'system');
    const options = calls[0]!.options as Record<string, unknown>;
    assert.equal(options.max_completion_tokens, 300);
    assert.equal(options.reasoning_effort, 'none');
    assert.equal(options.prompt_cache_key, 'ai-ps:summary');
    assert.deepEqual(out, [
      { role: 'user', content: '[이전 대화 요약]\n사용자가 인사를 주고받았고 날씨를 물었다' },
      ...messages.slice(-6),
    ]);
  });

  it('When the summary call fails or throws Then keeps only the recent six', async () => {
    for (const model of [
      { complete: async () => ({ ok: false as const, reason: 'provider down' }) },
      { complete: async () => { throw Error('network'); } },
    ] as CompletionGateway[]) {
      const out = await createHistoryCompactor(model)(talk(13));
      assert.deepEqual(out, talk(13).slice(-6));
    }
  });

  it('When an earlier summary message sits in the front Then it is re-summarized with the rest', async () => {
    const calls: { messages: ChatMessage[] }[] = [];
    const compact = createHistoryCompactor({ complete: async (messages) => {
      calls.push({ messages });
      return reply('통합 요약');
    } });
    const messages: ChatMessage[] = [{ role: 'user', content: '[이전 대화 요약]\n옛날 요약' }, ...talk(12)];
    await compact(messages);
    assert.ok(String(calls[0]!.messages[1]!.content).includes('[이전 대화 요약]'));
  });
});
