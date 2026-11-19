import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_BUDGET, budget } from '../../src/domain/token-budget.ts';

describe('Given the shared token budget table', () => {
  it('When read Then every call site has one fixed cap', () => {
    assert.deepEqual(TOKEN_BUDGET, {
      chatPlan: 500, chatStep: 400, chatAnswer: 1500,
      talkTurn: 800, talkReport: 2000,
      adventureTool: 400, adventureTurn: 1600,
      queensProposal: 1500,
      researchLoop: 2000, researchReport: 3000, researchEval: 400,
      summary: 300,
    });
  });

  it('When budget(name) is spread at a call site Then carries the cap and a per-call-site cache key', () => {
    assert.deepEqual(budget('talkTurn'), { max_completion_tokens: 800, prompt_cache_key: 'ai-ps:talkTurn' });
    assert.deepEqual(budget('summary'), { max_completion_tokens: 300, prompt_cache_key: 'ai-ps:summary' });
  });
});
