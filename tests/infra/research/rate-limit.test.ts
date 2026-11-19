import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResearchRateLimit } from '../../../src/infra/research-rate-limit.ts';
describe('Given the research quota adapter', () => {
  it('When no binding exists locally Then allows without a provider call', async () => {
    assert.equal(await createResearchRateLimit()('anon'), 'allowed');
  });
  it('When production requires a missing binding Then refuses provider work', async () => {
    assert.equal(await createResearchRateLimit(undefined, { required: true })('anon'), 'unavailable');
  });
  it('When the binding accepts, rejects or throws Then maps to the gate result without diagnostics', async () => {
    for (const mode of ['allowed', 'limited', 'unavailable'] as const) {
      const keys: string[] = [];
      const limit = createResearchRateLimit({ limit: async ({ key }) => { keys.push(key); if (mode === 'unavailable') throw Error('private-key'); return { success: mode === 'allowed' }; } });
      assert.equal(await limit('192.0.2.1'), mode); assert.deepEqual(keys, ['192.0.2.1']);
    }
  });
});
