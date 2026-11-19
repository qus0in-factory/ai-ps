import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from 'pino';
import { createQueensLogger } from '../../src/infra/queens-logger.ts';

function capture() {
  const entries: Record<string, unknown>[] = [];
  const sink = {
    info: (value: object) => { entries.push(value as Record<string, unknown>); },
    warn: (value: object) => { entries.push(value as Record<string, unknown>); },
  } as unknown as Pick<Logger, 'info' | 'warn'>;
  return { entries, logger: sink };
}

describe('Given a Queens generation logger', () => {
  it('When a model event carries a free-text reason Then only the structured path is logged', () => {
    const { entries, logger } = capture();
    createQueensLogger(logger)({ kind: 'model', path: 'algorithm', reason: '모델 배치 형식 오류' });
    assert.deepEqual(entries[0], { component: 'queens', kind: 'model', path: 'algorithm' });
  });

  it('When a repair event carries a free-text message Then the message is not logged', () => {
    const { entries, logger } = capture();
    createQueensLogger(logger)({ kind: 'repair', message: '코드 보정 완료 · 모델 제안 검증' });
    assert.deepEqual(entries[0], { component: 'queens', kind: 'repair' });
  });

  it('When a stopped event carries a free-text reason Then only the kind is logged as a warning', () => {
    const { entries, logger } = capture();
    createQueensLogger(logger)({ kind: 'stopped', reason: '퍼즐 생성을 중단했습니다.' });
    assert.deepEqual(entries[0], { component: 'queens', kind: 'stopped' });
  });

  it('When events without free text arrive Then their structured fields are preserved', () => {
    const { entries, logger } = capture();
    const queens = createQueensLogger(logger);
    queens({ kind: 'placement' });
    queens({ kind: 'complete' });
    assert.deepEqual(entries, [
      { component: 'queens', kind: 'placement' },
      { component: 'queens', kind: 'complete' },
    ]);
  });
});
