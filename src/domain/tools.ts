import type { Result } from './chat.ts';
import type { ExecutionPlan } from './execution-plan.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: unknown): Promise<Result<unknown>>;
}

export type ToolResponse =
  | { type: 'message'; content: string; thought?: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown>; thought?: string };

export type ToolLogEvent =
  | { event: 'model_request'; turn: number; phase?: 'planning' | 'answer' }
  | { event: 'model_response'; turn: number; content: string | null; phase?: 'planning' | 'answer' }
  | { event: 'model_error' | 'parse_error' | 'loop_stopped'; turn: number; reason: string; phase?: 'planning' | 'answer' }
  | { event: 'plan_created'; turn: number; plan: ExecutionPlan }
  | { event: 'tool_call'; turn: number; name: string; arguments: Record<string, unknown> }
  | { event: 'tool_result'; turn: number; name: string; result: Result<unknown> };

export type ToolLogger = (entry: ToolLogEvent) => void;
