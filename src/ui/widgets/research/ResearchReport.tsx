import { For, Show } from 'solid-js';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import type { ResearchResult } from './types.ts';
import { runSummary, visibleSources } from './research-view.ts';

export function ResearchReport(props: { result: ResearchResult }) {
  const sources = () => visibleSources(props.result.sources);
  return <>
    <section class="research-report" aria-label="조사 보고서">
      <header class="research-report-head">
        <h2>보고서</h2>
        <span>{runSummary(props.result)}</span>
      </header>
      <Show when={props.result.capped}>
        <p class="research-capped" role="status">반복 한도에 도달해 조사를 마무리했어요. 일부 내용은 출처를 직접 확인해 주세요.</p>
      </Show>
      <Markdown content={props.result.report} />
    </section>
    <section class="research-sources" aria-label="참고 자료">
      <h2>참고 자료</h2>
      <Show when={sources().length > 0} fallback={<p class="research-note">표시할 참고 자료 링크가 없어요. 보고서의 출처를 직접 확인해 주세요.</p>}>
        <ul>
          <For each={sources()}>{(source) => (
            <li>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.host}</a>
              <span class="research-source-url">{source.url}</span>
            </li>
          )}</For>
        </ul>
      </Show>
    </section>
  </>;
}
