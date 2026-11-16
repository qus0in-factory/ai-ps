import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueensService } from '../../src/app/queens/service.ts';
import { createTools } from '../../src/infra/tools.ts';
import { createToolChat } from '../../src/app/tool-chat.ts';

const puzzle = { size: 4, regions: Array.from({ length: 4 }, (_, row) => Array(4).fill(row)) };
const tools = () => createTools({ queens: createQueensService() });

describe('Given registered Queens agent tools', () => {
  it('When inspecting the registry Then exposes puzzle and placement validators', () => {
    const names = tools().map(tool => tool.definition.name);
    for (const name of ['verify_puzzle', 'validate_queens_placement']) assert.ok(names.includes(name));
  });
  it('When validating a non-unique puzzle Then returns both solutions in its validation errors', async () => {
    const result = await tools().find(tool => tool.definition.name === 'verify_puzzle')!.execute(puzzle);
    assert.equal(result.ok, true);
    if (result.ok) {
      const report = result.value as ReturnType<ReturnType<typeof createQueensService>['validatePuzzle']>;
      assert.equal(report.valid, false);
      assert.equal(report.issues[0]?.solutions?.length, 2);
    }
  });
  it('When an agent calls the validator Then the full result is sent back to the model', async () => {
    let turn = 0;
    const chat = createToolChat({ complete: async (messages) => {
      if (turn++ === 0) return { ok: true, value: { role: 'assistant', content: JSON.stringify({ type: 'tool_call', name: 'verify_puzzle', arguments: puzzle }) } };
      const observation = JSON.parse(messages.at(-1)!.content).result.value;
      assert.equal(observation.solutionStatus, 'multiple');
      assert.equal(observation.issues[0].solutions.length, 2);
      return { ok: true, value: { role: 'assistant', content: JSON.stringify({ type: 'message', content: observation.issues[0].message }) } };
    } }, tools());
    const result = await chat.complete([{ role: 'user', content: '이 퍼즐을 검증해줘' }]);
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.value, /두 정답/);
  });
  it('When validating a complete placement Then uses the algorithmic placement validator', async () => {
    const result = await tools().find(tool => tool.definition.name === 'validate_queens_placement')!.execute({
      size: 4, regions: [[0,0,0,0], [0,1,1,1], [2,2,2,2], [3,3,3,3]],
      queens: [1,3,0,2].map((column, row) => ({ row, column })),
    });
    assert.equal(result.ok && (result.value as { valid: boolean }).valid, true);
  });
});
