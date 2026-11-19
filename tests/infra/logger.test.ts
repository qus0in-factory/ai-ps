import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/infra/logger.ts';

describe('Given the Pino logger', () => {
  it('When a field or message contains an email Then the written line is masked and the input is unchanged', () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: false, destination: { write: (line) => { lines.push(line); } } });
    const fields = { event: 'note', email: 'ada@example.com' };
    logger.info(fields, '연락처 ada@example.com 확인');
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.email, '[EMAIL]');
    assert.equal(parsed.msg, '연락처 [EMAIL] 확인');
    assert.equal(fields.email, 'ada@example.com');
  });
});
