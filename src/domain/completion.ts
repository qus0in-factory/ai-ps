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
  complete(messages: CompletionMessage[], tools: ToolDefinition[], options?: CompletionOptions): Promise<Result<AssistantMessage>>;
}

export interface CompletionGateway {
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<Result<AssistantMessage>>;
}

export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

export interface CompletionOptions {
  reasoning_effort?: 'none';
  max_completion_tokens?: number;
  prompt_cache_key?: string;
  response_format?: JsonSchemaResponseFormat;
  temperature?: number;
  tool_choice?: { type: 'function'; function: { name: string } };
  parallel_tool_calls?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CompletionParams {
  model: string;
  messages: CompletionMessage[];
  response_format?: CompletionOptions['response_format'];
  tools?: { type: 'function'; function: ToolDefinition & { strict: true } }[];
  tool_choice?: CompletionOptions['tool_choice'];
  parallel_tool_calls?: boolean;
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  temperature?: number;
  max_completion_tokens?: number;
  prompt_cache_key?: string;
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
