import { A } from '@solidjs/router';
import { LoaderCircle } from 'lucide-solid';
import { Show, createSignal, onCleanup } from 'solid-js';
import type { ResearchClient, ResearchResult } from './types.ts';
import { RESEARCH_TOPIC_MAX } from './types.ts';
import { elapsedLabel, topicProblem } from './research-view.ts';
import { StepLog } from './StepLog.tsx';
import { ResearchReport } from './ResearchReport.tsx';
import './Research.css';

type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export function ResearchWidget(props: { client: ResearchClient }) {
  const [topic, setTopic] = createSignal('');
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [message, setMessage] = createSignal('');
  const [result, setResult] = createSignal<ResearchResult>();
  const [elapsed, setElapsed] = createSignal(0);
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  };
  const running = () => phase() === 'running';
  const submitDisabled = () => running() || topicProblem(topic()) !== null;
  onCleanup(() => { controller?.abort(); stopTimer(); });

  const submit = async (event: Event) => {
    event.preventDefault();
    if (running()) return;
    const problem = topicProblem(topic());
    if (problem) { setPhase('error'); setMessage(problem); return; }
    const own = new AbortController();
    controller = own;
    setPhase('running');
    setMessage('');
    setResult(undefined);
    setElapsed(0);
    const startedAt = Date.now();
    timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    const outcome = await props.client.run(topic().trim(), own.signal);
    stopTimer();
    if (!outcome.ok) {
      setPhase(own.signal.aborted ? 'cancelled' : 'error');
      setMessage(own.signal.aborted ? '조사를 중단했어요. 주제를 바꿔 다시 시작할 수 있어요.' : outcome.reason);
      return;
    }
    setResult(outcome.value);
    setPhase('done');
  };

  return <main class="research-page">
    <header class="research-header">
      <A href="/" class="research-home">← 홈</A>
      <div><span class="research-eyebrow">RESEARCH</span><h1>자동 리서치</h1></div>
    </header>
    <p class="research-lead">주제를 하나 적으면 에이전트가 웹 검색과 페이지 읽기를 스스로 반복하며 근거 있는 보고서를 씁니다.</p>

    <form class="research-form" onSubmit={submit}>
      <label for="research-topic">조사할 주제</label>
      <div class="research-input-row">
        <input id="research-topic" name="topic" type="text" maxLength={RESEARCH_TOPIC_MAX}
          aria-describedby="research-topic-hint" placeholder="예: 2026년 국내 전기차 보조금 변화"
          value={topic()} disabled={running()}
          onInput={(event) => setTopic(event.currentTarget.value)} />
        <button type="submit" class="research-button research-primary" disabled={submitDisabled()}>
          {running() ? '조사 중…' : '조사 시작'}
        </button>
      </div>
      <div class="research-form-meta">
        <small id="research-topic-hint">한 번에 하나의 주제를 조사합니다. 1~{RESEARCH_TOPIC_MAX}자.</small>
        <span>{topic().trim().length}/{RESEARCH_TOPIC_MAX}</span>
      </div>
    </form>

    <Show when={running()}>
      <section class="research-progress" aria-label="조사 진행 상황">
        <p class="research-status" role="status" aria-live="polite">
          <LoaderCircle class="research-spin" size={18} aria-hidden="true" />
          {elapsedLabel(elapsed())}
        </p>
        <p class="research-note">검색과 읽기를 반복하므로 몇 분 걸릴 수 있어요. 조사가 끝날 때까지 이 화면을 닫지 마세요.</p>
        <p class="research-note">도구 호출 기록과 참고 자료는 조사가 끝나면 함께 보여드려요.</p>
        <button type="button" class="research-button research-secondary" onClick={() => controller?.abort()}>조사 중단</button>
      </section>
    </Show>

    <Show when={phase() === 'error' && message()}>
      <p class="research-error" role="alert">{message()}</p>
    </Show>
    <Show when={phase() === 'cancelled'}>
      <p class="research-cancelled" role="status">{message()}</p>
    </Show>
    <Show when={phase() === 'done' && result()}>{value => <>
      <ResearchReport result={value()} />
      <StepLog steps={value().steps} />
    </>}</Show>
  </main>;
}
