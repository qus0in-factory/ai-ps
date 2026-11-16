import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatMemory } from '../../src/infra/local-chat-memory.ts';

describe('Given localStorage chat memory', () => {
  it('When saving and loading Then preserves messages', () => {
    let stored: string | null = null;
    const memory = createLocalChatMemory(() => ({
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; },
    }));
    assert.deepEqual(memory.load(), { ok: true, value: [] });
    const messages = [{ role: 'user' as const, content: '안녕하세요' }];
    assert.equal(memory.save(messages).ok, true);
    assert.deepEqual(memory.load(), { ok: true, value: messages });
  });

  it('When stored data is corrupt Then returns a recoverable error', () => {
    for (const stored of ['{invalid', '[{"role":"system","content":"x"}]', '{}']) {
      const memory = createLocalChatMemory(() => ({ getItem: () => stored, setItem: () => {} }));
      assert.equal(memory.load().ok, false);
    }
  });

  it('When storage is unavailable Then returns failures without throwing', () => {
    const memory = createLocalChatMemory(() => { throw new Error('Storage blocked'); });
    assert.equal(memory.load().ok, false);
    assert.equal(memory.save([]).ok, false);
  });
});
