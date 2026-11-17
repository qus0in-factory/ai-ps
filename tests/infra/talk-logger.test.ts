import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkLogger } from '../../src/infra/talk-logger.ts';

function capture() {
  const entries: { method: string; value: unknown }[] = [];
  const sink = Object.fromEntries(['info', 'warn', 'error'].map(method => [method,
    (value: unknown) => { entries.push({ method, value }); },
  ])) as Pick<Console, 'info' | 'warn' | 'error'>;
  return { entries, logger: { info: sink.info, warn: sink.warn, error: sink.error } };
}

describe('Given a Talk logger', () => {
  it('When a turn entry contains raw text Then logs only metadata', () => {
    const { entries, logger } = capture();
    createTalkLogger(logger)({ event: 'turn', ok: true, ms: 1, text: '秘密', reply: '秘密' } as never);
    assert.doesNotMatch(JSON.stringify(entries), /秘密|text|reply/);
    assert.deepEqual(entries.map(entry => entry.method), ['info']);
  });
  it('When an entry fails Then uses warn level', () => {
    const { entries, logger } = capture();
    createTalkLogger(logger)({ event: 'report', ok: false, ms: 2, reason: 'SECRET' } as never);
    assert.doesNotMatch(JSON.stringify(entries), /SECRET|reason/);
    assert.deepEqual(entries.map(entry => entry.method), ['warn']);
  });
});
