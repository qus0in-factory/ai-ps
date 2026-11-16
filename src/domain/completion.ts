import type { ChatMessage, Result } from './chat.ts';
import type { ToolDefinition } from './tools.ts';

export interface FunctionToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  refusal?: string | null;
  tool_calls?: FunctionToolCall[];
}

export type CompletionMessage = ChatMessage | AssistantMessage |
  { role: 'tool'; tool_call_id: string; content: string };

export interface FunctionCompletionGateway {
  complete(messages: CompletionMessage[], tools: ToolDefinition[]): Promise<Result<AssistantMessage>>;
}

export interface CompletionGateway {
  complete(messages: ChatMessage[]): Promise<Result<AssistantMessage>>;
}

export interface CompletionParams {
  model: string;
  messages: CompletionMessage[];
  tools?: { type: 'function'; function: ToolDefinition & { strict: true } }[];
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  temperature?: number;
  max_completion_tokens?: number;
}

export interface CompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: AssistantMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
