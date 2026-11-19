import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/infra/logger.ts';
import { createToolLogger } from '../../src/infra/tool-logger.ts';

function capture(level?: string) {
  const lines: string[] = [];
  const logger = createLogger({ level, pretty: false, destination: { write: (line) => { lines.push(line); } } });
  return { lines, entries: () => lines.map((line) => JSON.parse(line)) };
}

describe('Given the Pino tool logger in default summary mode', () => {
  it('When tool events occur Then emits structured fields at the appropriate severity', () => {
    const { lines } = capture();
    const log = createToolLogger(createLogger({ pretty: false, destination: { write: (line) => { lines.push(line); } } }));
    log({ event: 'tool_call', turn: 1, name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
    log({ event: 'tool_result', turn: 1, name: 'get_current_weather', result: { ok: false, reason: '조회 실패' } });
    log({ event: 'model_error', turn: 2, reason: '모델 연결 실패' });
    const parsed = lines.map((line) => JSON.parse(line));
    assert.deepEqual(parsed.map((entry) => entry.level), [30, 40, 50]);
    assert.equal('arguments' in parsed[0], false);
    assert.equal(parsed[0].name, 'get_current_weather');
    assert.equal(parsed[0].turn, 1);
    assert.equal(parsed[0].event, 'tool_call');
    assert.ok(parsed[0].msg);
    assert.ok(!Number.isNaN(Date.parse(parsed[0].time)));
    assert.equal('result' in parsed[1], false);
    assert.equal(parsed[1].ok, false);
    assert.equal('reason' in parsed[2], false); // 자유 문장 reason은 기본 모드에서 빠진다
  });

  it('When a tool event carries raw text Then the log keeps only operational fields and masks identifiers', () => {
    const { lines } = capture();
    const log = createToolLogger(createLogger({ pretty: false, destination: { write: (line) => { lines.push(line); } } }));
    log({ event: 'model_response', turn: 1, content: 'mail ada@example.com' });
    log({ event: 'tool_call', turn: 2, name: 'search', phase: 'execution', stepId: 1, arguments: { q: 'secret query' } });
    log({ event: 'plan_created', turn: 3, plan: { type: 'plan', goal: 'secret goal', steps: [{ id: 1, title: 'secret step' }, { id: 2, title: 'secret step' }] } });
    log({ event: 'tool_result', turn: 4, name: 'search', result: { ok: true, value: { body: 'secret body' } } });
    log({ event: 'parse_error', turn: 5, reason: 'from 203.0.113.10' });
    const entries = lines.map((line) => JSON.parse(line));
    assert.equal(entries[0].contentChars, 'mail ada@example.com'.length);
    assert.equal('content' in entries[0], false);
    assert.equal(entries[1].phase, 'execution');
    assert.equal(entries[1].stepId, 1);
    assert.equal('arguments' in entries[1], false);
    assert.equal('plan' in entries[2], false);
    assert.equal(entries[2].steps, 2); // 계획 단계 수만
    assert.equal(entries[3].ok, true);
    assert.equal('result' in entries[3], false);
    assert.equal('reason' in entries[4], false); // 자유 문장 reason은 기본 모드에서 빠진다
    assert.doesNotMatch(JSON.stringify(entries), /ada@example.com|secret query|secret goal|secret step|secret body|203\.0\.113\.10/);
  });

  it('When the level is warn Then filters informational model events', () => {
    const { lines } = capture('warn');
    const log = createToolLogger(createLogger({ pretty: false, level: 'warn', destination: { write: (line) => { lines.push(line); } } }));
    log({ event: 'model_request', turn: 1 });
    log({ event: 'loop_stopped', turn: 2, reason: '반복 호출 중단' });
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).event, 'loop_stopped');
  });
});

describe('Given the tool logger in local full mode', () => {
  it('When full is set Then keeps raw fields but the logger still masks identifiers', () => {
    const lines: string[] = [];
    const log = createToolLogger(createLogger({ pretty: false, destination: { write: (line) => { lines.push(line); } } }), { full: true });
    log({ event: 'model_response', turn: 1, content: 'mail ada@example.com' });
    log({ event: 'tool_call', turn: 2, name: 'search', arguments: { q: 'secret query' } });
    log({ event: 'tool_result', turn: 3, name: 'search', result: { ok: false, reason: '연결 실패' } });
    const entries = lines.map((line) => JSON.parse(line));
    assert.equal(entries[0].content, 'mail [EMAIL]');
    assert.deepEqual(entries[1].arguments, { q: 'secret query' });
    assert.deepEqual(entries[2].result, { ok: false, reason: '연결 실패' });
    assert.doesNotMatch(lines.join('\n'), /ada@example\.com/);
  });
});
