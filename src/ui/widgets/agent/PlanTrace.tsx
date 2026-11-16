import { For, Show } from 'solid-js';
import type { AgentStep } from '../../../domain/agent-step.ts';

import { ReActTrace } from './ReActTrace.tsx';
import './PlanTrace.css';

type PlanEvent = Extract<AgentStep, { kind: 'plan' }>;
type ExecutionEvent = Extract<AgentStep, { kind: 'execution' }>;

export function PlanTrace(props: { steps: AgentStep[]; pending?: boolean }) {
  const plan = () => props.steps.find((step): step is PlanEvent => step.kind === 'plan')?.plan;
  const execution = (id: number) => props.steps.findLast((step): step is ExecutionEvent => step.kind === 'execution' && step.id === id);
  const status = (id: number) => {
    const step = execution(id);
    if (!step) return '대기';
    if (step.status === 'running') return props.pending ? '실행 중' : '중단';
    return step.status === 'completed' ? '완료' : '실패';
  };
  return (
    <section class="plan-trace" aria-label="계획과 실행 단계">
      <section class="plan-section">
        <h3>계획</h3>
        <Show when={plan()} fallback={<p>{props.pending ? '실행 계획을 작성하고 있어요…' : '계획을 생성하지 못했습니다.'}</p>}>
          <p>{plan()!.goal}</p>
          <ol><For each={plan()!.steps}>{(step) => <li>{step.title}</li>}</For></ol>
        </Show>
      </section>
      <Show when={plan()}>
        <section class="execution-section">
          <h3>실행 단계</h3>
          <Show when={plan()!.steps.length} fallback={<p>도구 실행 없이 답변을 구성합니다.</p>}>
            <ol>
              <For each={plan()!.steps}>{(step) => (
                <li>
                  <span class="step-status">{status(step.id)}</span><span>{step.title}</span>
                  <ReActTrace steps={props.steps.filter((event) => event.stepId === step.id)} />
                  <Show when={execution(step.id)?.result}>
                    <details>
                      <summary>실행 결과 보기</summary>
                      <pre>{JSON.stringify(execution(step.id)!.result, null, 2)}</pre>
                    </details>
                  </Show>
                </li>
              )}</For>
            </ol>
          </Show>
        </section>
      </Show>
      <Show when={props.pending && props.steps.some((step) => step.kind === 'answer')}>
        <section class="answer-section"><h3>최종 답변</h3><p>실행 결과를 모아 답변을 작성하고 있어요…</p></section>
      </Show>
      <For each={props.steps.filter((step): step is Extract<AgentStep, { kind: 'stopped' }> => step.kind === 'stopped' && !step.stepId)}>{(step) => <p>{step.reason}</p>}</For>
    </section>
  );
}
