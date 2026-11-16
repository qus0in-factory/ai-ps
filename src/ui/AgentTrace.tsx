import { For, Show } from 'solid-js';
import type { AgentStep } from '../domain/agent-step.ts';
import { PlanTrace } from './PlanTrace.tsx';

function observation(step: Extract<AgentStep, { kind: 'observation' }>): string {
  if (!step.result.ok) return step.result.reason;
  const value = step.result.value;
  if (value && typeof value === 'object') {
    if ('temperature_c' in value) {
      const city = 'city' in value && typeof value.city === 'string' ? value.city : '';
      return `${city} ${value.temperature_c}°C`;
    }
    if ('datetime' in value && typeof value.datetime === 'string') return value.datetime;
  }
  return '도구 실행 완료';
}

export function AgentTrace(props: { steps: AgentStep[]; pending?: boolean }) {
  return (
    <Show when={props.steps.length}>
      <Show
        when={props.steps.some((step) => ['planning', 'plan', 'execution', 'answer'].includes(step.kind))}
        fallback={(
      <section class="agent-trace" aria-label="판단 요약과 도구 실행 과정">
        <ol>
          <For each={props.steps}>{(step) => (
            <li>
              <Show when={step.kind === 'thought'}>
                <span class="trace-label">판단 요약</span>
                <span>{step.kind === 'thought' && step.summary}</span>
              </Show>
              <Show when={step.kind === 'action'}>
                <span class="trace-label">도구 호출</span>
                <code>{step.kind === 'action' && `${step.name} ${JSON.stringify(step.arguments)}`}</code>
              </Show>
              <Show when={step.kind === 'observation'}>
                <details>
                  <summary><span class="trace-label">관찰</span>{step.kind === 'observation' && observation(step)}</summary>
                  <pre>{step.kind === 'observation' && JSON.stringify(step.result, null, 2)}</pre>
                </details>
              </Show>
              <Show when={step.kind === 'stopped'}>
                <span class="trace-label">중단</span><span>{step.kind === 'stopped' && step.reason}</span>
              </Show>
            </li>
          )}</For>
        </ol>
      </section>
        )}
      >
        <PlanTrace steps={props.steps} pending={props.pending} />
      </Show>
    </Show>
  );
}
