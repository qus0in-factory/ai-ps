import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationController } from '../../../src/app/queens/generation-store.ts';

describe('Given the Queens generation UI controller', () => {
  it('When generating Then exposes each event and clears pending on failure', async () => {
    const controller = createGenerationController({ generate: async (size, onEvent) => {
      assert.equal(size, 7);
      onEvent?.({ kind: 'attempt', attempt: 1, retry: 0 });
      assert.equal(controller.getState().pending, true);
      assert.equal(controller.getState().events.length, 1);
      return { ok: false, reason: '재시도 한도' };
    } });
    controller.setSize(7);
    await controller.generate();
    assert.equal(controller.getState().pending, false);
    assert.equal(controller.getState().error, '재시도 한도');
  });
  it('When the generator throws Then still unlocks the UI', async () => {
    const controller = createGenerationController({ generate: async () => { throw new Error('Unexpected'); } });
    await controller.generate();
    assert.equal(controller.getState().pending, false);
    assert.ok(controller.getState().error);
  });
});
