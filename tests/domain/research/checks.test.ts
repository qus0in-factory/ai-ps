import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkCitations, checkEffort } from '../../../src/domain/research/checks.ts';
import type { ResearchStep } from '../../../src/domain/research/types.ts';

describe('Given code-only checks over the research trajectory', () => {
  it('When citations differ only in trailing punctuation, slash or fragment Then they match a read page', () => {
    const steps: ResearchStep[] = [
      { tool: 'read_webpage', args: { url: 'https://example.com/a' }, ok: true },
      { tool: 'read_webpage', args: { url: 'https://example.org/b/' }, ok: true },
    ];
    const report = '근거: https://example.com/a. 및 [문서](https://example.org/b/#section), https://example.com/a#more';
    assert.deepEqual(checkCitations(report, steps), { passed: true, unread: [] });
  });

  it('When a read failed Then its URL is not an allowed citation', () => {
    const steps: ResearchStep[] = [
      { tool: 'read_webpage', args: { url: 'https://example.com/failed' }, ok: false },
      { tool: 'read_webpage', args: { url: 'https://example.com/ok' }, ok: true },
    ];
    assert.deepEqual(checkCitations('https://example.com/failed', steps), {
      passed: false, unread: ['https://example.com/failed'],
    });
  });

  it('When unread citations exist Then they are returned sorted and the check fails', () => {
    const steps: ResearchStep[] = [{ tool: 'read_webpage', args: { url: 'https://example.com/read' }, ok: true }];
    const report = 'https://example.org/z, https://example.net/a 및 https://example.com/read';
    assert.deepEqual(checkCitations(report, steps), {
      passed: false, unread: ['https://example.net/a', 'https://example.org/z'],
    });
  });

  it('When search and read counts are compared Then two of each are required regardless of success', () => {
    const steps: ResearchStep[] = [
      { tool: 'search_web', args: { query: 'a' }, ok: true },
      { tool: 'search_web', args: { query: 'b' }, ok: false },
      { tool: 'read_webpage', args: { url: 'https://example.com/a' }, ok: true },
    ];
    assert.deepEqual(checkEffort(steps), { passed: false, searches: 2, reads: 1 });
    steps.push({ tool: 'read_webpage', args: { url: 'https://example.com/b' }, ok: false });
    assert.deepEqual(checkEffort(steps), { passed: true, searches: 2, reads: 2 });
  });

  it('When steps are empty Then citations pass only without URLs and effort fails', () => {
    assert.deepEqual(checkCitations('근거가 없는 문장입니다.', []), { passed: true, unread: [] });
    assert.deepEqual(checkCitations('https://example.com/a', []), {
      passed: false, unread: ['https://example.com/a'],
    });
    assert.deepEqual(checkEffort([]), { passed: false, searches: 0, reads: 0 });
  });
});
