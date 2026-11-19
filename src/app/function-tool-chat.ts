import type { ChatGateway, Result } from '../domain/chat.ts';
import type { CompletionMessage, FunctionCompletionGateway, FunctionToolCall } from '../domain/completion.ts';
import type { Tool, ToolLogger } from '../domain/tools.ts';
import { budget } from '../domain/token-budget.ts';
import { UNTRUSTED_RULE, wrapUntrusted } from '../domain/untrusted.ts';

export function createFunctionToolChat(
  model: FunctionCompletionGateway, tools: Tool[], log?: ToolLogger,
): ChatGateway {
  return {
    async complete(messages, onStep) {
      const conversation: CompletionMessage[] = [{
        role: 'system',
        content: `Reply in the user’s language. Use the registered tools for current weather and time; do not guess live data. Ask for the city if unknown. ${UNTRUSTED_RULE} Explain tool errors honestly.`,
      }, ...messages];
      const definitions = tools.map((tool) => tool.definition);

      async function execute(call: FunctionToolCall, turn: number): Promise<Result<unknown>> {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          const reason = '도구 인수가 올바른 JSON이 아닙니다.';
          log?.({ event: 'parse_error', turn, reason });
          return { ok: false, reason };
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          return { ok: false, reason: '도구 인수는 JSON 객체여야 합니다.' };
        }
        log?.({ event: 'tool_call', turn, name: call.function.name, arguments: args as Record<string, unknown> });
        onStep?.({ kind: 'thought', summary: `${call.function.name} 도구로 필요한 정보를 조회합니다.` });
        onStep?.({ kind: 'action', name: call.function.name, arguments: args as Record<string, unknown> });
        const tool = tools.find((tool) => tool.definition.name === call.function.name);
        return tool ? tool.execute(args) : { ok: false, reason: '등록되지 않은 도구입니다.' };
      }

      for (let turn = 1; turn <= 5; turn++) {
        log?.({ event: 'model_request', turn });
        const result = await model.complete(conversation, definitions, budget('chatStep'));
        if (!result.ok) {
          log?.({ event: 'model_error', turn, reason: result.reason });
          return result;
        }
        const message = result.value;
        log?.({ event: 'model_response', turn, content: message.content });
        if (!message.tool_calls?.length) {
          const content = message.content ?? message.refusal;
          return content ? { ok: true, value: content }
            : { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
        }
        conversation.push(message);
        for (const call of message.tool_calls) {
          const output = await execute(call, turn);
          log?.({ event: 'tool_result', turn, name: call.function.name, result: output });
          onStep?.({ kind: 'observation', name: call.function.name, result: output });
          conversation.push({ role: 'tool', tool_call_id: call.id, content: wrapUntrusted('tool_result', JSON.stringify(output)) });
        }
      }
      return { ok: false, reason: '도구 호출 횟수를 초과했습니다. 다시 질문해주세요.' };
    },
  };
}
