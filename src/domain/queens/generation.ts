import type { Result } from '../chat.ts';
import type { GeneratedPuzzle, PuzzleValidation } from './types.ts';

export const MAX_QUEENS_RETRIES = 10;
export type GenerationEvent =
  | { kind: 'attempt'; attempt: number; retry: number }
  | { kind: 'tool_call'; attempt: number; arguments: unknown }
  | { kind: 'validation'; attempt: number; report: PuzzleValidation }
  | { kind: 'feedback'; attempt: number; message: string }
  | { kind: 'complete'; attempt: number }
  | { kind: 'stopped'; attempt: number; reason: string };
export type GenerationListener = (event: GenerationEvent) => void;
export interface QueensGenerator {
  generate(size: number, onEvent?: GenerationListener, signal?: AbortSignal): Promise<Result<GeneratedPuzzle>>;
}
export interface GenerationState {
  size: number;
  pending: boolean;
  events: GenerationEvent[];
  generated?: GeneratedPuzzle;
  error: string;
}

export function isPuzzleValidation(value: unknown): value is PuzzleValidation {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<PuzzleValidation>;
  return typeof report.valid === 'boolean' && Array.isArray(report.issues) &&
    report.issues.every(issue => issue && typeof issue.code === 'string' && typeof issue.message === 'string') &&
    ['invalid','none','unique','multiple','inconclusive'].includes(report.solutionStatus ?? '') &&
    Array.isArray(report.solutions) && typeof report.nodesVisited === 'number';
}
export function isGenerationEvent(value: unknown): value is GenerationEvent {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('attempt' in value) ||
      !Number.isInteger(value.attempt) || Number(value.attempt) < 1 || Number(value.attempt) > MAX_QUEENS_RETRIES + 1) return false;
  if (value.kind === 'attempt') return 'retry' in value && value.retry === Number(value.attempt) - 1;
  if (value.kind === 'tool_call') return 'arguments' in value;
  if (value.kind === 'validation') return 'report' in value && isPuzzleValidation(value.report);
  if (value.kind === 'feedback') return 'message' in value && typeof value.message === 'string';
  if (value.kind === 'stopped') return 'reason' in value && typeof value.reason === 'string';
  return value.kind === 'complete';
}
