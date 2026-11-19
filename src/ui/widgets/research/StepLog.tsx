import { Check, FileText, Search, X } from 'lucide-solid';
import { For, Show } from 'solid-js';
import type { ResearchStep } from './types.ts';
import { stepDetail, stepOutcome, stepTitle } from './research-view.ts';

export function StepLog(props: { steps: readonly ResearchStep[] }) {
  return <Show when={props.steps.length > 0}>
    <section class="research-steps" aria-label="도구 호출 기록">
      <h2>도구 호출 기록</h2>
      <ol>
        <For each={props.steps}>{(step, index) => (
          <li classList={{ 'research-step--failed': !step.ok }}>
            <span class="research-step-index" aria-hidden="true">{index() + 1}</span>
            <span class="research-step-icon" aria-hidden="true">
              <Show when={step.tool === 'search_web'} fallback={<FileText size={16} />}><Search size={16} /></Show>
            </span>
            <span class="research-step-body">
              <strong>{stepTitle(step)}</strong>
              <Show when={stepDetail(step)}><span class="research-step-detail">{stepDetail(step)}</span></Show>
            </span>
            <span class="research-step-outcome">
              <Show when={step.ok} fallback={<X size={14} aria-hidden="true" />}><Check size={14} aria-hidden="true" /></Show>
              {stepOutcome(step)}
            </span>
          </li>
        )}</For>
      </ol>
    </section>
  </Show>;
}
