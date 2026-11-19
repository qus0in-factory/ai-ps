import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, type UsageEvent } from '../../src/domain/usage.ts';

describe('Given a usage cost event', () => {
  it('When a completion model matches a price prefix Then sums input and output token costs', () => {
    const event: UsageEvent = { service: 'openai', op: 'completion', model: 'gpt-6.1-terra', inputTokens: 1_000_000, outputTokens: 1_000_000, status: 200, ms: 100 };
    assert.equal(costUsd(event), 1 + 5);
  });

  it('When the model is a dated snapshot Then the longest prefix still matches', () => {
    const event: UsageEvent = { service: 'openai', op: 'completion', model: 'gpt-6.1-terra-2026-10-26', inputTokens: 500_000, outputTokens: 200_000, status: 200, ms: 1 };
    assert.ok(Math.abs(costUsd(event) - (0.5 + 1)) < 1e-9);
  });

  it('When several prefixes match Then the longest one wins', () => {
    // 'gpt-realtime-2.1-mini'는 'gpt-realtime'(32/64)과 'gpt-realtime-2.1-mini'(10/20) 둘에 걸린다.
    const event: UsageEvent = { service: 'openai', op: 'realtime', model: 'gpt-realtime-2.1-mini', inputTokens: 1_000_000, outputTokens: 1_000_000, status: 200, ms: 1 };
    assert.equal(costUsd(event), 10 + 20);
  });

  it('When the model is unknown or missing Then the cost is 0', () => {
    for (const model of ['gpt-9-nova', null, undefined]) {
      assert.equal(costUsd({ service: 'openai', op: 'completion', model, inputTokens: 123, outputTokens: 456, status: 200, ms: 1 }), 0);
    }
  });

  it('When tokens are missing Then they count as 0', () => {
    const event: UsageEvent = { service: 'openai', op: 'completion', model: 'gpt-6.1-terra', outputTokens: 1_000_000, status: 200, ms: 1 };
    assert.equal(costUsd(event), 5);
  });

  it('When op is search Then the per-call service price applies', () => {
    assert.equal(costUsd({ service: 'brave', op: 'search', status: 200, ms: 1 }), 0.005);
    assert.equal(costUsd({ service: 'ncp', op: 'search', status: 200, ms: 1 }), 0);
  });

  it('When transcribe has no per-token price Then the cost is 0', () => {
    assert.equal(costUsd({ service: 'openai', op: 'transcribe', model: 'gpt-transcribe', inputTokens: 1000, outputTokens: 1000, status: 200, ms: 1 }), 0);
  });
});
