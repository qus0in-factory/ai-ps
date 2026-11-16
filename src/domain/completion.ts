import type { ChatMessage, Result } from './chat.ts';

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  refusal?: string | null;
}

export interface CompletionGateway {
  complete(messages: ChatMessage[]): Promise<Result<AssistantMessage>>;
}

export interface CompletionParams {
  model: string;
  messages: ChatMessage[];
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
