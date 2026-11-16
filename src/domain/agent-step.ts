import type { Result } from './chat.ts';
import { isExecutionPlan, type ExecutionPlan } from './execution-plan.ts';

export type AgentStep =
  | { kind: 'planning' }
  | { kind: 'plan'; plan: ExecutionPlan }
  | { kind: 'execution'; id: number; title: string; status: 'running' | 'completed' | 'failed'; result?: Result<unknown> }
  | { kind: 'answer' }
  | { kind: 'thought'; summary: string }
  | { kind: 'action'; name: string; arguments: Record<string, unknown> }
  | { kind: 'observation'; name: string; result: Result<unknown> }
  | { kind: 'stopped'; reason: string };

export type StepListener = (step: AgentStep) => void;

export function isAgentStep(value: unknown): value is AgentStep {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  if (value.kind === 'planning' || value.kind === 'answer') return true;
  if (value.kind === 'plan') return 'plan' in value && isExecutionPlan(value.plan);
  if (value.kind === 'execution') return 'id' in value && Number.isInteger(value.id) &&
    'title' in value && typeof value.title === 'string' && 'status' in value &&
    ['running', 'completed', 'failed'].includes(String(value.status)) &&
    (!('result' in value) || isResult(value.result));
  if (value.kind === 'thought') return 'summary' in value && typeof value.summary === 'string';
  if (value.kind === 'stopped') return 'reason' in value && typeof value.reason === 'string';
  if (!('name' in value) || typeof value.name !== 'string') return false;
  if (value.kind === 'action') return 'arguments' in value && !!value.arguments &&
    typeof value.arguments === 'object' && !Array.isArray(value.arguments);
  if (value.kind === 'observation' && 'result' in value && value.result && typeof value.result === 'object') {
    const result = value.result;
    return 'ok' in result && (result.ok === true ? 'value' in result :
      result.ok === false && 'reason' in result && typeof result.reason === 'string');
  }
  return false;
}

function isResult(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'ok' in result &&
    (result.ok === true ? 'value' in result : result.ok === false && 'reason' in result && typeof result.reason === 'string');
}
