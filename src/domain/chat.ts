export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export interface ChatGateway {
  complete(messages: ChatMessage[]): Promise<Result<string>>;
}
export interface ChatState {
  messages: ChatMessage[];
  draft: string;
  pending: boolean;
  error: string;
}
export function isConversation(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.length > 0 && value.every((message) =>
    message && ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.trim());
}
