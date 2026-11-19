import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResearchAgent } from '../../../src/app/research/agent.ts';
import type { ResearchLogEvent, ResearchPagePort, ResearchSearchPort } from '../../../src/app/research/ports.ts';
import { EVALUATOR_FORMAT, RESEARCH_SYSTEM_PROMPT, WRAP_UP_MESSAGE } from '../../../src/domain/research/prompt.ts';
import type { AssistantMessage, CompletionMessage, CompletionOptions, FunctionCompletionGateway } from '../../../src/domain/completion.ts';
import type { ToolDefinition } from '../../../src/domain/tools.ts';
import type { Result } from '../../../src/domain/chat.ts';
import type { SearchHit } from '../../../src/domain/research/tools.ts';

interface ModelCall {
  messages: CompletionMessage[];
  tools: ToolDefinition[];
  options?: CompletionOptions;
}

function fakeModel(script: Array<Result<AssistantMessage>>) {
  const calls: ModelCall[] = [];
  let index = 0;
  const model: FunctionCompletionGateway = {
    async complete(messages, tools, options) {
      calls.push({ messages: [...messages], tools: [...tools], options });
      const outcome = script[index] ?? { ok: false as const, reason: '테스트 스크립트가 비었습니다.' };
      index += 1;
      return outcome;
    },
  };
  return { model, calls };
}

const text = (content: string): AssistantMessage => ({ role: 'assistant', content });
const call = (id: string, name: string, args: unknown): AssistantMessage => ({
  role: 'assistant', content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

function fakeTools(overrides: {
  search?: (query: string, maxResults: number) => Promise<Result<SearchHit[]>>;
  read?: (url: string) => Promise<Result<string>>;
} = {}) {
  const searchCalls: Array<{ query: string; maxResults: number }> = [];
  const readCalls: string[] = [];
  const search: ResearchSearchPort = overrides.search ?? (async (query: string, maxResults: number) => {
    searchCalls.push({ query, maxResults });
    return { ok: true, value: [{ title: '첫 결과', url: 'https://example.com/a', summary: '첫 요약' }] };
  });
  const read: ResearchPagePort = overrides.read ?? (async (url: string) => {
    readCalls.push(url);
    return { ok: true, value: '페이지 본문' };
  });
  return { search, read, searchCalls, readCalls };
}

const emptySearch: ResearchSearchPort = async () => ({ ok: true, value: [] });
const emptyRead: ResearchPagePort = async () => ({ ok: true, value: '본문' });

describe('Given the research agent with a scripted model and fake tools', () => {
  it('When the model answers without tool calls Then the run ends with notes, a report call, and an evaluation call', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: text('조사 노트: 확인한 사실 (https://example.com/a)') },
      { ok: true, value: text('## 개요\n보고서 본문') },
      { ok: true, value: text('{"passed":true,"problems":[]}') },
    ]);
    const tools = fakeTools();
    const outcome = await createResearchAgent({ model, search: tools.search, read: tools.read }).run('  엣지 컴퓨팅  ');
    assert.deepEqual(outcome, { ok: true, value: {
      report: '## 개요\n보고서 본문',
      steps: [],
      sources: [],
      iterations: 1,
      capped: false,
      evaluation: { passed: true, problems: [] },
    } });
    assert.equal(calls.length, 3);
    const research = calls[0]!;
    assert.deepEqual(research.tools.map((tool) => tool.name).sort(), ['read_webpage', 'search_web']);
    assert.deepEqual(research.options, { temperature: 0.2, reasoning_effort: 'none', max_completion_tokens: 2000, prompt_cache_key: 'ai-ps:researchLoop' });
    const system = research.messages[0];
    assert.equal(system?.role, 'system');
    assert.equal(system?.content, RESEARCH_SYSTEM_PROMPT);
    assert.ok(String(research.messages[1]?.content).includes('"엣지 컴퓨팅"'));
    const report = calls[1]!;
    assert.deepEqual(report.tools, []);
    assert.deepEqual(report.options, { temperature: 0.3, reasoning_effort: 'none', max_completion_tokens: 3000, prompt_cache_key: 'ai-ps:researchReport' });
    const reportContent = String(report.messages[0]?.content);
    assert.ok(reportContent.includes('조사 노트: 확인한 사실'));
    assert.ok(reportContent.includes('"엣지 컴퓨팅"'));
    const evaluation = calls[2]!;
    assert.deepEqual(evaluation.tools, []);
    assert.deepEqual(evaluation.options, { temperature: 0, reasoning_effort: 'none', response_format: EVALUATOR_FORMAT, max_completion_tokens: 400, prompt_cache_key: 'ai-ps:researchEval' });
  });

  it('When one response carries several tool calls Then they execute in order and each result becomes a tool message', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: { role: 'assistant', content: null, tool_calls: [
        { id: 's1', type: 'function', function: { name: 'search_web', arguments: '{"query":"엣지"}' } },
        { id: 'r1', type: 'function', function: { name: 'read_webpage', arguments: '{"url":"https://example.com/1"}' } },
        { id: 'r2', type: 'function', function: { name: 'read_webpage', arguments: '{"url":"https://example.com/2"}' } },
      ] } },
      { ok: true, value: text('노트 완성') },
      { ok: true, value: text('보고서') },
    ]);
    const tools = fakeTools();
    const outcome = await createResearchAgent({ model, search: tools.search, read: tools.read }).run('주제');
    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.deepEqual(outcome.value.steps, [
        { tool: 'search_web', args: { query: '엣지' }, ok: true },
        { tool: 'read_webpage', args: { url: 'https://example.com/1' }, ok: true },
        { tool: 'read_webpage', args: { url: 'https://example.com/2' }, ok: true },
      ]);
      assert.deepEqual(outcome.value.sources, ['https://example.com/1', 'https://example.com/2']);
    }
    assert.deepEqual(tools.searchCalls, [{ query: '엣지', maxResults: 5 }]);
    assert.deepEqual(tools.readCalls, ['https://example.com/1', 'https://example.com/2']);
    assert.deepEqual(calls[1]!.messages.slice(-3), [
      { role: 'tool', tool_call_id: 's1', content: '1. 첫 결과\n   주소: https://example.com/a\n   요약: 첫 요약' },
      { role: 'tool', tool_call_id: 'r1', content: '페이지 본문' },
      { role: 'tool', tool_call_id: 'r2', content: '페이지 본문' },
    ]);
  });

  it('When tools fail, throw, or are unknown Then the model receives guidance strings and the loop keeps running', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: { role: 'assistant', content: null, tool_calls: [
        { id: 's1', type: 'function', function: { name: 'search_web', arguments: '{"query":"q"}' } },
        { id: 'r1', type: 'function', function: { name: 'read_webpage', arguments: '{"url":"https://example.com/blocked"}' } },
        { id: 'u1', type: 'function', function: { name: 'browse', arguments: '{}' } },
        { id: 's2', type: 'function', function: { name: 'search_web', arguments: '{"query":"단어"}' } },
      ] } },
      { ok: true, value: text('노트') },
      { ok: true, value: text('보고서') },
      { ok: true, value: text('{"passed":true,"problems":[]}') },
    ]);
    const tools = fakeTools({
      search: async (query) => query === 'q' ? { ok: false, reason: 'HTTP 429' } : { ok: true, value: [] },
      read: async () => { throw new Error('port exploded'); },
    });
    const outcome = await createResearchAgent({ model, search: tools.search, read: tools.read }).run('주제');
    assert.ok(outcome.ok);
    const toolMessages = calls[1]!.messages.filter((message) => message.role === 'tool');
    assert.ok(toolMessages[0]!.content.includes('HTTP 429'));
    assert.match(toolMessages[0]!.content, /다시 시도해보세요/);
    assert.match(toolMessages[1]!.content, /다른 페이지를 시도해보세요/);
    assert.match(toolMessages[2]!.content, /read_webpage/);
    assert.equal(toolMessages[3]!.content, '검색 결과가 없습니다. 다른 검색어로 다시 시도해보세요.');
    if (outcome.ok) {
      assert.equal(outcome.value.steps.length, 3);
      assert.equal(outcome.value.steps.filter((step) => step.ok).length, 1);
    }
    assert.equal(calls.length, 4);
  });

  it('When the agent keeps calling tools until the cap Then a tools-free wrap-up call closes the research', async () => {
    const script: Array<Result<AssistantMessage>> = [];
    for (let index = 0; index < 10; index++) {
      script.push({ ok: true, value: call(`s${index}`, 'search_web', { query: `q${index}` }) });
    }
    script.push({ ok: true, value: text('마무리 노트') });
    script.push({ ok: true, value: text('최종 보고서') });
    script.push({ ok: true, value: text('{"passed":true,"problems":[]}') });
    const { model, calls } = fakeModel(script);
    const events: ResearchLogEvent[] = [];
    const outcome = await createResearchAgent({
      model, search: emptySearch, read: emptyRead, log: (entry) => events.push(entry),
    }).run('주제');
    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.capped, true);
      assert.equal(outcome.value.iterations, 10);
      assert.equal(outcome.value.steps.length, 10);
      assert.deepEqual(outcome.value.sources, []);
      assert.equal(outcome.value.report, '최종 보고서');
    }
    assert.equal(calls.length, 13);
    for (let index = 0; index < 10; index++) assert.equal(calls[index]!.tools.length, 2);
    const wrapUp = calls[10]!;
    assert.deepEqual(wrapUp.tools, []);
    assert.deepEqual(wrapUp.options, { temperature: 0.2, reasoning_effort: 'none', max_completion_tokens: 2000, prompt_cache_key: 'ai-ps:researchLoop' });
    const last = wrapUp.messages.at(-1);
    assert.equal(last?.role, 'user');
    assert.ok(String((last as { content: string } | undefined)?.content).includes(WRAP_UP_MESSAGE));
    assert.ok(events.some((entry) => entry.event === 'wrap_up'));
    assert.deepEqual(calls[11]!.tools, []);
    assert.equal(calls[11]!.options?.temperature, 0.3);
  });

  it('When a page body is longer than 4000 characters Then the tool message is truncated', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: call('r1', 'read_webpage', { url: 'https://example.com/long' }) },
      { ok: true, value: text('노트') },
      { ok: true, value: text('보고서') },
    ]);
    const read: ResearchPagePort = async () => ({ ok: true as const, value: '긴'.repeat(5000) });
    await createResearchAgent({ model, search: emptySearch, read }).run('주제');
    const toolMessage = calls[1]!.messages.at(-1);
    assert.equal(toolMessage?.role, 'tool');
    const content = String((toolMessage as { content: string } | undefined)?.content);
    assert.ok(content.startsWith('긴'.repeat(4000)));
    assert.ok(content.length < 4100);
  });

  it('When the model fails or answers with empty content Then the run fails safely', async () => {
    const { model, calls } = fakeModel([{ ok: false, reason: '모델 응답 시간이 초과되었습니다.' }]);
    const outcome = await createResearchAgent({ model, search: emptySearch, read: emptyRead }).run('주제');
    assert.deepEqual(outcome, { ok: false, reason: '모델 응답 시간이 초과되었습니다.' });
    assert.equal(calls.length, 1);

    const empty = fakeModel([{ ok: true, value: text('   ') }]);
    const emptyOutcome = await createResearchAgent({ model: empty.model, search: emptySearch, read: emptyRead }).run('주제');
    assert.equal(emptyOutcome.ok, false);
    if (!emptyOutcome.ok) assert.match(emptyOutcome.reason, /비어/);
  });

  it('When the topic is invalid Then validation fails before any model call', async () => {
    const { model, calls } = fakeModel([]);
    const agent = createResearchAgent({ model, search: emptySearch, read: emptyRead });
    for (const topic of ['', '   ', 'x'.repeat(201)]) {
      const outcome = await agent.run(topic);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.match(outcome.reason, /1~200자/);
    }
    assert.equal(calls.length, 0);
  });

  it('When the evaluator fails the first draft Then rewrites the report at most once with the problems and re-evaluates', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: text('조사 노트: 사실 A (https://example.com/a)') },
      { ok: true, value: text('## 개요\n초안 보고서 (출처 누락)') },
      { ok: true, value: text('{"passed":false,"problems":["출처 표기가 누락되었습니다."]}') },
      { ok: true, value: text('## 개요\n수정된 보고서 (https://example.com/a)') },
      { ok: true, value: text('{"passed":true,"problems":[]}') },
    ]);
    const outcome = await createResearchAgent({ model, search: emptySearch, read: emptyRead }).run('엣지 컴퓨팅');
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.report, '## 개요\n수정된 보고서 (https://example.com/a)');
      assert.deepEqual(outcome.value.evaluation, { passed: true, problems: [] });
    }
    assert.equal(calls.length, 5);
    assert.ok(String(calls[3]!.messages[0]?.content).includes('출처 표기가 누락되었습니다.'));
  });

  it('When the rewritten report still fails evaluation Then stops after one rewrite and returns the remaining problems', async () => {
    const { model, calls } = fakeModel([
      { ok: true, value: text('조사 노트: 사실 A (https://example.com/a)') },
      { ok: true, value: text('초안 보고서') },
      { ok: true, value: text('{"passed":false,"problems":["첫 번째 문제"]}') },
      { ok: true, value: text('재작성 보고서') },
      { ok: true, value: text('{"passed":false,"problems":["여전히 남은 문제"]}') },
    ]);
    const outcome = await createResearchAgent({ model, search: emptySearch, read: emptyRead }).run('엣지 컴퓨팅');
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.report, '재작성 보고서');
      assert.deepEqual(outcome.value.evaluation, { passed: false, problems: ['여전히 남은 문제'] });
    }
    assert.equal(calls.length, 5);
  });
});
