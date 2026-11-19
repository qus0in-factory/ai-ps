import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOPIC_MAX, validateTopic } from '../../../src/domain/research/topic.ts';

describe('Given a user submits a research topic', () => {
  it('When the topic has surrounding whitespace Then validation trims it and returns the topic', () => {
    assert.deepEqual(validateTopic('  엣지 컴퓨팅 동향  '), { ok: true, value: '엣지 컴퓨팅 동향' });
  });

  it('When the topic is blank Then validation fails with a length guide', () => {
    for (const blank of ['', '   ', '\t\n']) {
      const result = validateTopic(blank);
      assert.equal(result.ok, false);
      assert.match((result as { reason: string }).reason, /1~200자/);
    }
  });

  it('When the topic is exactly 200 characters Then validation accepts it', () => {
    assert.deepEqual(validateTopic('주'.repeat(TOPIC_MAX)), { ok: true, value: '주'.repeat(TOPIC_MAX) });
  });

  it('When the topic exceeds 200 characters Then validation fails', () => {
    const result = validateTopic(`  ${'주'.repeat(TOPIC_MAX + 1)}  `);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /1~200자/);
  });
});
