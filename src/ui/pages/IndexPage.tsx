import { A } from '@solidjs/router';
import './IndexPage.css';

export function IndexPage() {
  return (
    <main class="index-page">
      <h1>시작하기</h1>
      <nav aria-label="페이지 선택">
        <A href="/chat" class="page-link">
          <span>Chat</span>
          <span aria-hidden="true">→</span>
        </A>
        <A href="/queen" class="page-link"><span>Queens</span><span aria-hidden="true">→</span></A>
      </nav>
    </main>
  );
}
