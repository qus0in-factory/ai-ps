import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSources, type ResearchStep } from '../../../src/domain/research/sources.ts';

describe('Given the research steps recorded during the agent loop', () => {
  it('When extracting sources Then only successful read_webpage URLs survive, in order, without duplicates', () => {
    const steps: ResearchStep[] = [
      { tool: 'search_web', args: { query: '엣지' }, ok: true },
      { tool: 'read_webpage', args: { url: 'https://example.com/a' }, ok: true },
      { tool: 'read_webpage', args: { url: 'https://example.com/b' }, ok: false },
      { tool: 'read_webpage', args: { url: 'https://example.com/a' }, ok: true },
      { tool: 'read_webpage', args: { url: 'https://example.com/c' }, ok: true },
    ];
    assert.deepEqual(extractSources(steps), ['https://example.com/a', 'https://example.com/c']);
  });

  it('When a read_webpage step lacks a usable url Then it is skipped', () => {
    const steps: ResearchStep[] = [
      { tool: 'read_webpage', args: {}, ok: true },
      { tool: 'read_webpage', args: { url: 123 }, ok: true },
      { tool: 'read_webpage', args: { url: '   ' }, ok: true },
      { tool: 'read_webpage', args: { url: 'https://example.com/ok' }, ok: true },
    ];
    assert.deepEqual(extractSources(steps), ['https://example.com/ok']);
  });

  it('When there are no steps or no successful reads Then sources are empty', () => {
    assert.deepEqual(extractSources([]), []);
    assert.deepEqual(extractSources([{ tool: 'search_web', args: { query: 'x' }, ok: true }]), []);
  });
});
