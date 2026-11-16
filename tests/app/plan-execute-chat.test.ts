import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanExecuteChat } from '../../src/app/plan-execute-chat.ts';
import type { AgentStep } from '../../src/domain/agent-step.ts';

const definition = { name: 'get_current_weather', description: 'Current weather', parameters: { type: 'object' } };
const plan = {
  type: 'plan', goal: '서울과 부산의 현재 온도를 비교한다.', steps: [
    { id: 1, title: '서울 온도 조회', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } },
    { id: 2, title: '부산 온도 조회', name: 'get_current_weather', arguments: { city: 'Busan,KR' } },
  ],
};
const answer = (value: unknown) => ({ ok: true as const, value: { role: 'assistant' as const, content: JSON.stringify(value) } });

describe('Given Plan and Execute', () => {
  it('When comparing cities Then plans first, executes each step once and synthesizes the observations', async () => {
    let calls = 0;
    const cities: string[] = [];
    const progress: AgentStep[] = [];
    const chat = createPlanExecuteChat({ complete: async (messages) => {
      if (calls++ === 0) {
        assert.equal(cities.length, 0);
        return answer(plan);
      }
      assert.deepEqual(cities, ['Seoul,KR', 'Busan,KR']);
      const results = JSON.parse(messages.at(-1)!.content).results;
      assert.equal(results[0].result.value.temperature_c, 10);
      assert.equal(results[1].result.value.temperature_c, 15);
      return answer({ type: 'message', content: '부산이 서울보다 5°C 높습니다.' });
    } }, [{ definition, execute: async (args) => {
      const city = (args as { city: string }).city;
      cities.push(city);
      return { ok: true, value: { temperature_c: city === 'Seoul,KR' ? 10 : 15 } };
    } }]);
    assert.deepEqual(await chat.complete([{ role: 'user', content: '서울 부산 온도 비교' }], (step) => progress.push(step)), {
      ok: true, value: '부산이 서울보다 5°C 높습니다.',
    });
    assert.deepEqual(progress.map((step) => step.kind), ['planning', 'plan', 'execution', 'execution', 'execution', 'execution', 'answer']);
    assert.equal(calls, 2);
  });

  it('When a tool fails Then marks the step failed and includes the failure in the final context', async () => {
    let calls = 0;
    const progress: AgentStep[] = [];
    const chat = createPlanExecuteChat({ complete: async (messages) => {
      if (calls++ === 0) return answer({ ...plan, steps: [plan.steps[0]] });
      assert.equal(JSON.parse(messages.at(-1)!.content).results[0].result.ok, false);
      return answer({ type: 'message', content: '날씨를 조회하지 못해 비교할 수 없습니다.' });
    } }, [{ definition, execute: async () => ({ ok: false, reason: '날씨 서비스 오류' }) }]);
    const result = await chat.complete([{ role: 'user', content: '날씨 비교' }], (step) => progress.push(step));
    assert.equal(result.ok, true);
    assert.ok(progress.some((step) => step.kind === 'execution' && step.status === 'failed'));
  });

  it('When a plan repeats the same call Then rejects it before executing any tools', async () => {
    let calls = 0;
    let executions = 0;
    const chat = createPlanExecuteChat({ complete: async () => {
      calls++;
      return answer({ ...plan, steps: [plan.steps[0], { ...plan.steps[0], id: 2 }] });
    } }, [{ definition, execute: async () => { executions++; return { ok: true, value: {} }; } }]);
    assert.equal((await chat.complete([{ role: 'user', content: '비교' }])).ok, false);
    assert.equal(calls, 2);
    assert.equal(executions, 0);
  });

  it('When final synthesis tries to call another tool Then retries once and stops without extending the plan', async () => {
    let calls = 0;
    const chat = createPlanExecuteChat({ complete: async () => {
      if (calls++ === 0) return answer({ ...plan, steps: [] });
      return answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
    } }, []);
    assert.equal((await chat.complete([{ role: 'user', content: '안녕' }])).ok, false);
    assert.equal(calls, 3);
  });
});
