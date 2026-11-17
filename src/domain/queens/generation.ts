import type { Result } from '../chat.ts';
import type { GeneratedPuzzle } from './types.ts';

export type GenerationPath = 'model' | 'model-seed' | 'algorithm';

export type GenerationEvent =
  | { kind: 'placement'; attempt: number }
  | { kind: 'model'; attempt: number; path: GenerationPath; reason?: string }
  | { kind: 'repair'; attempt: number; message: string }
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

export function isGenerationEvent(value: unknown): value is GenerationEvent {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('attempt' in value) || value.attempt !== 1) return false;
  if (value.kind === 'model') return 'path' in value && typeof value.path === 'string' && ['model', 'model-seed', 'algorithm'].includes(value.path) &&
    (value.path !== 'algorithm' || ('reason' in value && typeof value.reason === 'string'));
  if (value.kind === 'repair') return 'message' in value && typeof value.message === 'string';
  if (value.kind === 'stopped') return 'reason' in value && typeof value.reason === 'string';
  return value.kind === 'placement' || value.kind === 'complete';
}
