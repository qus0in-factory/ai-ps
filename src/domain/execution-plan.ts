import type { Result } from './chat.ts';

export const MAX_PLAN_STEPS = 4;

export interface PlanTask {
  id: number;
  title: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ExecutionPlan {
  type: 'plan';
  goal: string;
  steps: PlanTask[];
}

export function isExecutionPlan(value: unknown): value is ExecutionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<ExecutionPlan>;
  return plan.type === 'plan' && typeof plan.goal === 'string' && !!plan.goal.trim() &&
    Array.isArray(plan.steps) && plan.steps.length <= MAX_PLAN_STEPS &&
    plan.steps.every((step, index) => step && step.id === index + 1 &&
      typeof step.title === 'string' && !!step.title.trim() &&
      typeof step.name === 'string' && !!step.name.trim() &&
      step.arguments && typeof step.arguments === 'object' && !Array.isArray(step.arguments));
}

export function parseExecutionPlan(content: string): Result<ExecutionPlan> {
  let value: unknown;
  try {
    value = JSON.parse(content.trim());
  } catch {
    try {
      value = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    } catch {
      return { ok: false, reason: '계획 응답이 올바른 JSON이 아닙니다.' };
    }
  }
  return isExecutionPlan(value) ? { ok: true, value }
    : { ok: false, reason: `계획은 목표와 순서가 있는 최대 ${MAX_PLAN_STEPS}개의 도구 실행 단계여야 합니다.` };
}
