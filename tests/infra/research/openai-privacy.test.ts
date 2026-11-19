import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompletion } from '../../../src/infra/openai.ts';

describe('Given the research model adapter configuration', () => {
  it('When research has optional tool arguments Then can disable strict provider schemas while preserving app validation', async () => {
    let captured: Record<string, any> = {};
    const model = createOpenAICompletion({ model: 'research', apiKey: 'key', strictTools: false, fetcher: async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'notes' } }] });
    } });
    const result = await model.complete([], [{ name: 'search_web', description: 'Search', parameters: {
      type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'], additionalProperties: false,
    } }]);
    assert.equal(result.ok, true); assert.equal(captured.tools[0].function.strict, false);
    assert.deepEqual(captured.tools[0].function.parameters.required, ['query']);
  });
  it('When research disables provider logging Then errors remain safe and emit no provider diagnostics', async t => {
    const logs: unknown[] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
    t.mock.method(console, 'debug', (...args: unknown[]) => logs.push(args));
    const model = createOpenAICompletion({ model: 'research', apiKey: 'key', logErrors: false, debugErrors: true,
      fetcher: async () => Response.json({ error: { message: 'private-topic private-key' } }, { status: 401 }) });
    const result = await model.complete([{ role: 'user', content: 'private-topic' }]);
    assert.equal(result.ok, false); assert.deepEqual(logs, []);
    assert.doesNotMatch(JSON.stringify(result), /private-topic|private-key/);
  });
});
