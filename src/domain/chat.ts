import type { AgentStep, StepListener } from './agent-step.ts';

export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export interface ChatGateway {
  complete(messages: ChatMessage[], onStep?: StepListener): Promise<Result<string>>;
}
export interface ChatEntry extends ChatMessage {
  steps?: AgentStep[];
}
export interface ChatMemory {
  load(): Result<ChatMessage[]>;
  save(messages: ChatMessage[]): Result<void>;
}
export interface ChatState {
  messages: ChatEntry[];
  steps: AgentStep[];
  draft: string;
  pending: boolean;
  error: string;
}
export function isConversation(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.length > 0 && value.every((message) =>
    message && ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.trim());
}
