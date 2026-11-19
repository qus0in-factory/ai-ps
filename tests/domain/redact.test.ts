import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactDiagnostic, redactFields, redactText } from '../../src/domain/redact.ts';

describe('Given text that may contain identifiable data', () => {
  it('When an email, phone, IP or key appears Then each category gets its own marker', () => {
    const redacted = redactText([
      'ada@example.com',
      '010-1234-5678',
      '01012345678',
      '+82 10-1234-5678',
      '203.0.113.10',
      '2001:db8::1',
      'sk-private-secret',
      'Bearer bearer-private-value',
      'Basic basic-private-value',
      'api_key=another-private-value',
      'opaque-token-0123456789abcdef0123456789abcdef',
    ].join(' '));
    for (const secret of ['ada@example.com', '010-1234-5678', '01012345678', '+82 10-1234-5678',
      '203.0.113.10', '2001:db8::1', 'sk-private-secret', 'bearer-private-value', 'basic-private-value',
      'another-private-value', 'opaque-token-0123456789abcdef0123456789abcdef']) {
      assert.equal(redacted.includes(secret), false, secret);
    }
    assert.match(redacted, /\[EMAIL\]/);
    assert.match(redacted, /\[PHONE\]/);
    assert.match(redacted, /\[IP\]/);
    assert.match(redacted, /\[KEY\]/);
  });

  it('When a URL appears Then only the query string is hidden and credentials are dropped', () => {
    const redacted = redactText('먼저 https://user:password@gateway.example/v1?token=private-query 를 본다');
    assert.equal(redacted, '먼저 https://gateway.example/v1?[REDACTED] 를 본다');
    assert.doesNotMatch(redacted, /password|private-query/);
  });

  it('When the text is an ordinary log field Then counts, dates and versions stay', () => {
    const input = '모델 연결 실패 Seoul,KR timeout 42 2026-11-19 12:34:56 1.2.3';
    assert.equal(redactText(input), input);
  });

  it('When a string is longer than 2,000 characters Then only the head is processed and the rest is summarized', () => {
    const redacted = redactText(`ada@example.com ${'ab '.repeat(1_700)}`);
    assert.ok(redacted.startsWith('[EMAIL] ab'));
    assert.match(redacted, /\(\+\d{4}자\)$/);
    assert.equal(redacted.includes('ada@example.com'), false);
  });

  it('When 100KB of adversarial input arrives Then finishes well within 50ms', () => {
    const hostile = ('sk-' + 'a'.repeat(200) + ' ' + 'https://h.example/a?b=' + 'c'.repeat(200) + ' ').repeat(250);
    const started = process.hrtime.bigint();
    redactText(hostile);
    redactFields({ deep: hostile.split(' ') });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 50, `${ms}ms`);
  });

  it('When a provider diagnostic includes the caller key Then the key is removed and the message stays within 512 characters', () => {
    const phrase = 'private user phrase';
    const key = 'short-custom-key';
    const redacted = redactDiagnostic(`${phrase} ${key} ${'x'.repeat(2000)}`, key);
    assert.match(redacted, new RegExp(phrase));
    assert.equal(redacted.includes(key), false);
    assert.ok(redacted.length <= 512);
  });
});

describe('Given a structured log value', () => {
  it('When nested strings contain identifiable data Then the copy is masked and the input is unchanged', () => {
    const input = { event: 'note', turn: 1, nested: { email: 'ada@example.com' }, tags: ['203.0.113.10'] };
    const redacted = redactFields(input) as typeof input;
    assert.equal(redacted.nested.email, '[EMAIL]');
    assert.equal(redacted.tags[0], '[IP]');
    assert.equal(redacted.turn, 1);
    assert.equal(input.nested.email, 'ada@example.com');
  });

  it('When nesting is deeper than six levels Then the value is left as-is', () => {
    let deep: Record<string, unknown> = { text: 'ada@example.com' };
    for (let i = 0; i < 7; i++) deep = { child: deep };
    const redacted = redactFields(deep) as typeof deep;
    let walked: unknown = redacted;
    for (let i = 0; i < 7; i++) walked = (walked as { child: unknown }).child;
    assert.equal((walked as { text: string }).text, 'ada@example.com');
  });

  it('When the value is a number, null, or a cycle Then it is returned without throwing', () => {
    assert.equal(redactFields(7), 7);
    assert.equal(redactFields(null), null);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    assert.equal((redactFields(cycle) as { self: unknown }).self, '[Circular]');
  });
});
