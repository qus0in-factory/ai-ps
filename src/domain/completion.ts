import type { ChatMessage } from './chat.ts';

export interface CompletionParams {
  model: string;
  messages: ChatMessage[];
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
    message: {
      role: 'assistant';
      content: string | null;
      refusal?: string | null;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
