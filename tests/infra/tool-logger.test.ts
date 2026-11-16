import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/infra/logger.ts';
import { createToolLogger } from '../../src/infra/tool-logger.ts';

describe('Given the Pino tool logger', () => {
  it('When tool events occur Then emits structured fields at the appropriate severity', () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: false, destination: { write: (line) => { lines.push(line); } } });
    const log = createToolLogger(logger);
    log({ event: 'tool_call', turn: 1, name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
    log({ event: 'tool_result', turn: 1, name: 'get_current_weather', result: { ok: false, reason: '조회 실패' } });
    log({ event: 'model_error', turn: 2, reason: '모델 연결 실패' });
    const entries = lines.map((line) => JSON.parse(line));
    assert.deepEqual(entries.map((entry) => entry.level), [30, 40, 50]);
    assert.deepEqual(entries[0].arguments, { city: 'Seoul,KR' });
    assert.equal(entries[0].name, 'get_current_weather');
    assert.equal(entries[0].turn, 1);
    assert.equal(entries[0].event, 'tool_call');
    assert.ok(entries[0].msg);
    assert.ok(!Number.isNaN(Date.parse(entries[0].time)));
    assert.equal(entries[2].reason, '모델 연결 실패');
  });

  it('When the level is warn Then filters informational model events', () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: false, level: 'warn', destination: { write: (line) => { lines.push(line); } } });
    const log = createToolLogger(logger);
    log({ event: 'model_request', turn: 1 });
    log({ event: 'loop_stopped', turn: 2, reason: '반복 호출 중단' });
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).event, 'loop_stopped');
  });
});
