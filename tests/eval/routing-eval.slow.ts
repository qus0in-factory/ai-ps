import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createOpenAIClient, createOpenAICompletion } from '../../src/infra/openai.ts';
import { createPlanExecuteChat } from '../../src/app/plan-execute-chat.ts';
import type { Tool } from '../../src/domain/tools.ts';

if (existsSync('.env')) loadEnvFile('.env');
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());

const SIMPLE: string[] = [
  '안녕하세요.',
  '오늘 날짜가 뭐예요?',
  '서울의 인구는 얼마인가요?',
  '1 더하기 2는?',
  '고양이 울음소리는 뭐라고 하나요?',
  '지금 몇 시인가요?',
  '파이썬이란 무엇인가요?',
  '오늘 날씨 어때요?',
  '100의 제곱근은?',
  '감사합니다.',
];

const COMPLEX: string[] = [
  '서울과 부산의 기온을 비교해서 어느 쪽이 더 따뜻한지 설명해 주세요.',
  '다음 주 여행 계획을 세 단계로 나누어 제안해 주세요.',
  '이 글을 더 자연스럽고 짧게 다듬어 주세요: 인공지능은 우리 생활에 많은 변화를 가져왔습니다.',
  '여러 옵션의 장단점을 비교 분석해 주세요.',
  '프로젝트 일정을 마일스톤별로 계획해 주세요.',
  '두 제품의 사양을 비교하고 추천해 주세요.',
  '이 보고서를 요약하고 핵심 인사이트 세 가지를 뽑아 주세요.',
  '복잡한 문제를 단계별로 해결하는 방법을 설명해 주세요.',
  '여러 도시의 날씨를 비교하고 여행에 적합한 곳을 추천해 주세요.',
  '이 코드의 성능을 개선할 방법을 여러 관점에서 분석해 주세요.',
];

describe('Given a live model and routing', () => {
  it('When 20 sentences are routed Then simple stays luna and complex mostly terra', { skip: !live, timeout: 300_000 }, async (t) => {
    const results: { sentence: string; selected: string; ms: number; decisionHasModel: boolean; confidence: number | null }[] = [];
    for (const sentence of [...SIMPLE, ...COMPLEX]) {
      let selectedModel = 'unknown';
      let decisionHasModel = false;
      let confidence: number | null = null;
      const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/decisions')) {
          const response = await fetch(input, init);
          try {
            const data = (await response.clone().json()) as { model?: unknown; answers?: { confidence?: unknown }[] };
            decisionHasModel = Object.prototype.hasOwnProperty.call(data ?? {}, 'model');
            const reported = data?.answers?.[0]?.confidence;
            confidence = typeof reported === 'number' ? reported : null;
          } catch {
            decisionHasModel = false;
          }
          return response;
        }
        try {
          const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
          selectedModel = body.model ?? selectedModel;
        } catch {
          // ignore
        }
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const client = createOpenAIClient({
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
        fetcher: fetcher as typeof fetch,
      });
      const model = createOpenAICompletion({
        client,
        model: 'gpt-6-luna',
        routing: { complexModel: 'gpt-6.1-terra' },
      });
      const start = Date.now();
      const result = await model.complete([{ role: 'user', content: sentence }]);
      const ms = Date.now() - start;
      assert.equal(result.ok, true, result.ok ? '' : result.reason);
      results.push({ sentence, selected: selectedModel, ms, decisionHasModel, confidence });
      t.diagnostic(`routing-eval ${results.length <= SIMPLE.length ? 'simple' : 'complex'}: ${sentence} -> ${selectedModel} (${ms}ms) modelField=${decisionHasModel} confidence=${confidence}`);
    }
    const simpleResults = results.slice(0, SIMPLE.length);
    const complexResults = results.slice(SIMPLE.length);
    const simpleTerra = simpleResults.filter((r) => r.selected === 'gpt-6.1-terra').length;
    const complexTerra = complexResults.filter((r) => r.selected === 'gpt-6.1-terra').length;
    t.diagnostic(`routing-eval summary: simple terra=${simpleTerra}/10 complex terra=${complexTerra}/10`);
    t.diagnostic(`routing-eval decision has model field: ${results.some((r) => r.decisionHasModel)}`);
    assert.ok(simpleTerra <= 1, `simple terra count ${simpleTerra}`);
    assert.ok(complexTerra >= 7, `complex terra count ${complexTerra}`);
  });

  it('When Plan and Execute runs a city comparison Then terra handles strict json_schema and tools', { skip: !live, timeout: 180_000 }, async (t) => {
    const weatherTool: Tool = {
      definition: {
        name: 'get_current_weather',
        description: 'Current weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
      },
      effect: 'read',
      async execute(args) {
        const city = (args as { city: string }).city;
        return { ok: true, value: { temperature_c: city.includes('Seoul') ? 3 : 9 } };
      },
    };
    const client = createOpenAIClient({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
    const model = createOpenAICompletion({ client, model: 'gpt-6.1-terra' });
    const chat = createPlanExecuteChat(model, [weatherTool]);
    const result = await chat.complete([{ role: 'user', content: '서울과 부산 기온 비교' }]);
    t.diagnostic(`routing-eval plan-execute: ${result.ok ? 'ok' : result.reason}`);
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
  });
});