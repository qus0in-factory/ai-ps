import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanExecuteChat } from '../../src/app/plan-execute-chat.ts';
import type { AgentStep } from '../../src/domain/agent-step.ts';

const definition = { name: 'get_current_weather', description: 'Current weather', parameters: { type: 'object' } };
const plan = { type: 'plan', goal: '서울과 부산 온도 비교', steps: [
  { id: 1, title: '서울 기온 확인', instruction: '서울의 현재 기온을 조회한다.' },
  { id: 2, title: '부산 기온 확인', instruction: '부산의 현재 기온을 조회한다.' },
] };
const answer = (value: unknown) => ({ ok: true as const, value: { role: 'assistant' as const, content: JSON.stringify(value) } });

describe('Given Plan and Execute with a ReAct executor', () => {
  it('When all four executors use their full budgets Then remains bounded across the whole request', async () => {
    let calls = 0;
    let executions = 0;
    const chat = createPlanExecuteChat({ complete: async () => {
      calls++;
      if (calls === 1) return answer({ ...plan, steps: Array.from({ length: 4 }, (_, i) => ({
        id: i + 1, title: `단계 ${i + 1}`, instruction: `서로 다른 도시 그룹 ${i + 1}의 기온을 확인한다.`,
      })) });
      if (calls <= 13) {
        return (calls - 2) % 3 < 2
          ? answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: `City${calls}` } })
          : answer({ type: 'message', content: '단계 완료' });
      }
      return answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'unplanned' } });
    } }, [{ definition, execute: async () => { executions++; return { ok: true, value: {} }; } }]);
    assert.equal((await chat.complete([{ role: 'user', content: '기온 확인' }])).ok, false);
    assert.equal(executions, 8);
    assert.equal(calls, 15);
  });
  it('When comparing cities Then performs action and observation inside each plan step before synthesizing', async () => {
    const cities: string[] = [];
    const progress: AgentStep[] = [];
    let calls = 0;
    const chat = createPlanExecuteChat({ complete: async (messages, options) => {
      assert.equal(options?.response_format?.type, 'json_schema');
      assert.equal(options?.response_format?.json_schema.strict, true);
      calls++;
      if (calls === 1) return answer(plan);
      if (calls === 2 || calls === 4) {
        const city = calls === 2 ? 'Seoul,KR' : 'Busan,KR';
        return answer({ type: 'tool_call', thought: `${city} 기온을 조회합니다.`, name: 'get_current_weather', arguments: { city } });
      }
      if (calls === 3 || calls === 5) {
        assert.equal(JSON.parse(messages.at(-1)!.content).type, 'tool_result');
        return answer({ type: 'message', content: calls === 3 ? '서울은 10°C' : '부산은 15°C' });
      }
      const results = JSON.parse(messages.at(-1)!.content).results;
      assert.equal(results[0].observations[0].result.value.temperature_c, 10);
      assert.equal(results[1].observations[0].result.value.temperature_c, 15);
      return answer({ type: 'message', content: '부산이 5°C 높습니다.' });
    } }, [{ definition, execute: async (args) => {
      const city = (args as { city: string }).city;
      cities.push(city);
      return { ok: true, value: { temperature_c: city === 'Seoul,KR' ? 10 : 15 } };
    } }]);
    assert.deepEqual(await chat.complete([{ role: 'user', content: '서울 부산 비교' }], (step) => progress.push(step)), { ok: true, value: '부산이 5°C 높습니다.' });
    assert.deepEqual(cities, ['Seoul,KR', 'Busan,KR']);
    assert.equal(calls, 6);
    assert.deepEqual(progress.filter((step) => step.kind === 'action').map((step) => step.stepId), [1, 2]);
    assert.equal(progress.filter((step) => step.kind === 'observation').length, 2);
  });

  it('When a later step repeats a previous lookup Then reuses the observation without another external call', async () => {
    let calls = 0;
    let executions = 0;
    const chat = createPlanExecuteChat({ complete: async () => {
      calls++;
      if (calls === 1) return answer(plan);
      if (calls === 2 || calls === 4) return answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
      return answer({ type: 'message', content: '조회 완료' });
    } }, [{ definition, execute: async () => { executions++; return { ok: true, value: { temperature_c: 10 } }; } }]);
    assert.equal((await chat.complete([{ role: 'user', content: '온도 조회' }])).ok, true);
    assert.equal(executions, 1);
  });

  it('When an executor loops Then stops the step and never exceeds the request-wide budget', async () => {
    let calls = 0;
    let executions = 0;
    const chat = createPlanExecuteChat({ complete: async () => {
      calls++;
      if (calls === 1) return answer({ ...plan, steps: [plan.steps[0]] });
      return answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
    } }, [{ definition, execute: async () => { executions++; return { ok: true, value: {} }; } }]);
    const result = await chat.complete([{ role: 'user', content: '날씨' }]);
    assert.equal(result.ok, false);
    assert.ok(calls <= 16);
    assert.equal(executions, 1);
  });

  it('When a tool fails Then marks the step failed and supplies the failure to synthesis', async () => {
    let calls = 0;
    const progress: AgentStep[] = [];
    const chat = createPlanExecuteChat({ complete: async (messages) => {
      calls++;
      if (calls === 1) return answer({ ...plan, steps: [plan.steps[0]] });
      if (calls === 2) return answer({ type: 'tool_call', name: 'get_current_weather', arguments: { city: 'Seoul,KR' } });
      if (calls === 3) return answer({ type: 'message', content: '조회 실패' });
      assert.equal(JSON.parse(messages.at(-1)!.content).results[0].result.ok, false);
      return answer({ type: 'message', content: '날씨를 조회하지 못했습니다.' });
    } }, [{ definition, execute: async () => ({ ok: false, reason: '날씨 서비스 오류' }) }]);
    assert.equal((await chat.complete([{ role: 'user', content: '날씨' }], (step) => progress.push(step))).ok, true);
    assert.ok(progress.some((step) => step.kind === 'execution' && step.status === 'failed'));
  });
});
