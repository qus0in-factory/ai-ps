import { A } from '@solidjs/router';
import './IndexPage.css';

export function IndexPage() {
  return (
    <main class="index-page">
      <h1>시작하기</h1>
      <nav aria-label="페이지 선택">
        <A href="/stats" class="page-link"><span>사용량</span><span aria-hidden="true">→</span></A>
        <A href="/chat" class="page-link">
          <span>Chat</span>
          <span aria-hidden="true">→</span>
        </A>
        <A href="/queens" class="page-link"><span>Queens</span><span aria-hidden="true">→</span></A>
        <A href="/adventure" class="page-link"><span>Adventure</span><span aria-hidden="true">→</span></A>
        <A href="/talk" class="page-link"><span>Talk</span><span aria-hidden="true">→</span></A>
        <A href="/research" class="page-link"><span>Research</span><span aria-hidden="true">→</span></A>
      </nav>
    </main>
  );
}
