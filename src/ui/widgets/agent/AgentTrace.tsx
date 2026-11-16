import { Show } from 'solid-js';
import type { AgentStep } from '../../../domain/agent-step.ts';
import { PlanTrace } from './PlanTrace.tsx';
import { ReActTrace } from './ReActTrace.tsx';

export function AgentTrace(props: { steps: AgentStep[]; pending?: boolean }) {
  return (
    <Show when={props.steps.length}>
      <Show
        when={props.steps.some((step) => ['planning', 'plan', 'execution', 'answer'].includes(step.kind))}
        fallback={<ReActTrace steps={props.steps} />}
      >
        <PlanTrace steps={props.steps} pending={props.pending} />
      </Show>
    </Show>
  );
}
