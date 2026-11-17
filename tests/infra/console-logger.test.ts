import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsoleLogger } from '../../src/infra/console-logger.ts';
import { createToolLogger } from '../../src/infra/tool-logger.ts';
import { createQueensLogger } from '../../src/infra/queens-logger.ts';

function capture(level?: string) {
  const entries: { method: string; value: unknown }[] = [];
  const sink = Object.fromEntries(['info', 'warn', 'error'].map(method => [method,
    (value: unknown) => { entries.push({ method, value }); },
  ])) as Pick<Console, 'info' | 'warn' | 'error'>;
  return { entries, logger: createConsoleLogger({ level, console: sink }) };
}

describe('Given a Workers console logger', () => {
  it('When Queens logs summaries Then excludes queen coordinates even from an obsolete payload', () => {
    const { logger, entries } = capture();
    createQueensLogger(logger)({ kind: 'placement', solution: [{ row: 0, column: 2 }] } as never);
    assert.doesNotMatch(JSON.stringify(entries), /"solution"|"row"|"column"/);
  });
  it('When tool and generation events arrive Then preserves structured fields and severity', () => {
    const { logger, entries } = capture();
    const tools = createToolLogger(logger);
    const queens = createQueensLogger(logger);
    tools({ event: 'model_request', turn: 1 });
    tools({ event: 'tool_result', turn: 1, name: 'weather', result: { ok: false, reason: 'offline' } });
    tools({ event: 'model_error', turn: 2, reason: 'timeout' });
    queens({ kind: 'complete' });
    queens({ kind: 'stopped', reason: 'cancelled' });
    assert.deepEqual(entries.map(entry => entry.method), ['info', 'warn', 'error', 'info', 'warn']);
    const values = entries.map(entry => entry.value as Record<string, unknown>);
    assert.equal(values[0]!.event, 'model_request');
    assert.equal(values[0]!.turn, 1);
    assert.equal(values[2]!.reason, 'timeout');
    assert.equal(values[3]!.component, 'queens');
    assert.equal(values[3]!.kind, 'complete');
    for (const value of values) {
      assert.equal(typeof value.msg, 'string');
      assert.ok(!Number.isNaN(Date.parse(String(value.time))));
    }
  });

  it('When LOG_LEVEL is warn or silent Then filters events at the configured threshold', () => {
    const { logger, entries } = capture('warn');
    const log = createToolLogger(logger);
    log({ event: 'model_request', turn: 1 });
    log({ event: 'parse_error', turn: 1, reason: 'invalid JSON' });
    log({ event: 'model_error', turn: 1, reason: 'offline' });
    assert.deepEqual(entries.map(entry => entry.method), ['warn', 'error']);
    const muted = capture('silent');
    createQueensLogger(muted.logger)({ kind: 'stopped', reason: 'cancelled' });
    assert.equal(muted.entries.length, 0);
  });

  it('When LOG_LEVEL is invalid Then defaults to info without breaking request setup', () => {
    const { logger, entries } = capture('invalid');
    createToolLogger(logger)({ event: 'model_request', turn: 1 });
    assert.equal(entries.length, 1);
  });
});
