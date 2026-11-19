import type { Result } from '../../domain/chat.ts';
import type { CompletionMessage, FunctionToolCall } from '../../domain/completion.ts';
import type { ToolDefinition } from '../../domain/tools.ts';
import { DEFAULT_MAX_RESULTS, MAX_ITERATIONS } from '../../domain/research/constants.ts';
import {
  formatSearchResults,
  formatToolError,
  formatUnknownTool,
  READ_WEBPAGE_TOOL,
  SEARCH_WEB_TOOL,
  truncateWebpage,
  type SearchHit,
} from '../../domain/research/tools.ts';
import {
  buildEvaluationMessages,
  buildReportMessages,
  EVALUATOR_FORMAT,
  parseEvaluation,
  RESEARCH_SYSTEM_PROMPT,
  WRAP_UP_MESSAGE,
} from '../../domain/research/prompt.ts';
import { validateTopic } from '../../domain/research/topic.ts';
import { extractSources } from '../../domain/research/sources.ts';
import type { ResearchEvaluation, ResearchResult, ResearchStep } from '../../domain/research/types.ts';
import type { ResearchAgentPorts } from './ports.ts';
import { budget } from '../../domain/token-budget.ts';

export const RESEARCH_TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_WEB_TOOL, READ_WEBPAGE_TOOL];

interface LoopOutcome {
  notes: string;
  steps: ResearchStep[];
  iterations: number;
  capped: boolean;
  hits?: SearchHit[];
}

/** 조사 루프 + 보고서 작성을 주입받은 포트로 수행하는 리서치 에이전트(싱글턴: 주제 1회 → 보고서). */
export function createResearchAgent(ports: ResearchAgentPorts) {
  return {
    async run(topic: string): Promise<Result<ResearchResult>> {
      const checked = validateTopic(topic);
      if (!checked.ok) return checked;
      const loop = await runResearch(ports, checked.value);
      if (!loop.ok) return loop;
      const hits = loop.value.hits ?? [];
      const fallbackSources = () => {
        const sources = extractSources(loop.value.steps);
        return sources.length ? sources : [...new Set(hits.map((hit) => hit.url).filter(Boolean))];
      };
      if (!loop.value.notes && hits.length > 0) {
        return { ok: true, value: {
          report: formatSearchResults(hits),
          steps: loop.value.steps,
          sources: fallbackSources(),
          iterations: loop.value.iterations,
          capped: loop.value.capped,
        } };
      }
      let report = await writeReport(ports, checked.value, loop.value.notes);
      if (!report.ok) {
        return hits.length > 0
          ? { ok: true, value: {
            report: formatSearchResults(hits),
            steps: loop.value.steps,
            sources: fallbackSources(),
            iterations: loop.value.iterations,
            capped: loop.value.capped,
          } }
          : report;
      }
      let evaluation = await evaluateReport(ports, loop.value.notes, report.value);
      if (evaluation.ok && !evaluation.value.passed) {
        const rewritten = await writeReport(ports, checked.value, loop.value.notes, evaluation.value.problems);
        if (rewritten.ok) {
          report = rewritten;
          const reevaluated = await evaluateReport(ports, loop.value.notes, report.value);
          if (reevaluated.ok) evaluation = reevaluated;
        }
      }
      return { ok: true, value: {
        report: report.value,
        steps: loop.value.steps,
        sources: extractSources(loop.value.steps),
        iterations: loop.value.iterations,
        capped: loop.value.capped,
        ...(evaluation.ok ? { evaluation: evaluation.value } : {}),
      } };
    },
  };
}

/** 조사 루프: 에이전트 주도(도구 호출이 없으면 종료), 최대 MAX_ITERATIONS회. */
export async function runResearch(ports: ResearchAgentPorts, topic: string): Promise<Result<LoopOutcome>> {
  const conversation: CompletionMessage[] = [
    { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
    { role: 'user', content: `주제 ${JSON.stringify(topic)}에 대해 조사를 시작하세요.` },
  ];
  const steps: ResearchStep[] = [];
  const hits: SearchHit[] = [];
  for (let turn = 1; turn <= MAX_ITERATIONS; turn++) {
    ports.log?.({ event: 'model_request', turn, tools: true });
    const result = await ports.model.complete(conversation, RESEARCH_TOOL_DEFINITIONS, { temperature: 0.2, reasoning_effort: 'none', ...budget('researchLoop') });
    if (!result.ok) {
      return hits.length > 0 ? { ok: true, value: { notes: '', steps, iterations: turn, capped: false, hits } } : result;
    }
    const message = result.value;
    ports.log?.({ event: 'model_response', turn, toolCalls: message.tool_calls?.length ?? 0 });
    if (!message.tool_calls?.length) {
      const notes = (message.content ?? message.refusal ?? '').trim();
      return notes ? { ok: true, value: { notes, steps, iterations: turn, capped: false, hits } }
        : { ok: false, reason: '조사 응답이 비어 있습니다. 다시 시도해주세요.' };
    }
    conversation.push(message);
    for (const toolCall of message.tool_calls) {
      const outcome = await executeToolCall(ports, toolCall, turn);
      if (outcome.step) steps.push(outcome.step);
      for (const hit of outcome.hits ?? []) {
        if (!hits.some((existing) => existing.url === hit.url)) hits.push(hit);
      }
      conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: outcome.content });
    }
  }
  // 상한 도달: tools 없이 마무리 요청 1회로 반드시 정리 응답을 받아낸다.
  ports.log?.({ event: 'wrap_up' });
  conversation.push({ role: 'user', content: WRAP_UP_MESSAGE });
  const wrapUp = await ports.model.complete(conversation, [], { temperature: 0.2, reasoning_effort: 'none', ...budget('researchLoop') });
  if (!wrapUp.ok) {
    return hits.length > 0 ? { ok: true, value: { notes: '', steps, iterations: MAX_ITERATIONS, capped: true, hits } } : wrapUp;
  }
  const notes = (wrapUp.value.content ?? wrapUp.value.refusal ?? '').trim();
  return notes ? { ok: true, value: { notes, steps, iterations: MAX_ITERATIONS, capped: true, hits } }
    : { ok: false, reason: '조사 마무리 응답이 비어 있습니다. 다시 시도해주세요.' };
}

/** 보고서 작성: 조사 노트만 근거로, tools 없이 온도 0.3으로 호출한다(조사와 작성 분리). */
export async function writeReport(ports: ResearchAgentPorts, topic: string, notes: string, problems?: readonly string[]): Promise<Result<string>> {
  ports.log?.({ event: 'report' });
  const result = await ports.model.complete(buildReportMessages(topic, notes, problems), [], { temperature: 0.3, reasoning_effort: 'none', ...budget('researchReport') });
  if (!result.ok) return result;
  const content = (result.value.content ?? result.value.refusal ?? '').trim();
  return content ? { ok: true, value: content } : { ok: false, reason: '보고서 생성에 실패했습니다. 다시 시도해주세요.' };
}

/** 보고서 평가: 조사 노트 대비 보고서 충실도를 온도 0·json_schema(strict)로 판정한다(책 8.5). */
export async function evaluateReport(ports: ResearchAgentPorts, notes: string, report: string): Promise<Result<ResearchEvaluation>> {
  ports.log?.({ event: 'evaluate' });
  const result = await ports.model.complete(buildEvaluationMessages(notes, report), [], {
    temperature: 0,
    reasoning_effort: 'none',
    response_format: EVALUATOR_FORMAT,
    ...budget('researchEval'),
  });
  if (!result.ok) return result;
  return parseEvaluation(result.value.content ?? '');
}

interface ToolCallOutcome {
  content: string;
  ok: boolean;
  step?: ResearchStep;
  hits?: SearchHit[];
}

async function executeToolCall(ports: ResearchAgentPorts, toolCall: FunctionToolCall, turn: number): Promise<ToolCallOutcome> {
  const name = toolCall.function.name;
  if (name !== 'search_web' && name !== 'read_webpage') {
    return { content: formatUnknownTool(name), ok: false };
  }
  ports.log?.({ event: 'tool_call', turn, name });
  const args = parseArguments(toolCall.function.arguments);
  const outcome = name === 'search_web' ? await runSearch(ports, args) : await runRead(ports, args);
  ports.log?.({ event: 'tool_result', turn, name, ok: outcome.ok });
  return outcome;
}

async function runSearch(ports: ResearchAgentPorts, args: Record<string, unknown>): Promise<ToolCallOutcome> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return { ok: false, step: { tool: 'search_web', args, ok: false },
      content: formatToolError('search_web', '검색어를 1자 이상 입력해야 합니다.') };
  }
  const maxResults = typeof args.max_results === 'number' && Number.isFinite(args.max_results) && args.max_results >= 1
    ? Math.floor(args.max_results) : DEFAULT_MAX_RESULTS;
  try {
    const result = await ports.search(query, maxResults);
    return { ok: result.ok, step: { tool: 'search_web', args, ok: result.ok },
      ...(result.ok ? { hits: result.value } : {}),
      content: result.ok ? formatSearchResults(result.value) : formatToolError('search_web', result.reason) };
  } catch {
    return { ok: false, step: { tool: 'search_web', args, ok: false },
      content: formatToolError('search_web', '실행 중 오류가 발생했습니다.') };
  }
}

async function runRead(ports: ResearchAgentPorts, args: Record<string, unknown>): Promise<ToolCallOutcome> {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (!url) {
    return { ok: false, step: { tool: 'read_webpage', args, ok: false },
      content: formatToolError('read_webpage', 'URL을 1자 이상 입력해야 합니다.') };
  }
  try {
    const result = await ports.read(url);
    return { ok: result.ok, step: { tool: 'read_webpage', args, ok: result.ok },
      content: result.ok ? truncateWebpage(result.value) : formatToolError('read_webpage', result.reason) };
  } catch {
    return { ok: false, step: { tool: 'read_webpage', args, ok: false },
      content: formatToolError('read_webpage', '실행 중 오류가 발생했습니다.') };
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
