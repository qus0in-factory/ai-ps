import { marked } from 'marked';
import DOMPurify from 'dompurify';

type Purifier = Pick<typeof DOMPurify, 'sanitize' | 'addHook'>;

// 모델 출력(프롬프트 주입 가능)에서 자동 요청·폼 전송이 일어나지 않도록 외부 리소스 태그를 금지한다.
const FORBID_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'iframe', 'form'];

// purifier 마다 링크 hook 을 한 번만 건다(렌더마다 쌓이지 않게).
const hooked = new WeakSet<object>();

function hookLinks(purifier: Purifier) {
  if (hooked.has(purifier)) return;
  hooked.add(purifier);
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

export function renderMarkdown(content: string, purifier: Purifier = DOMPurify): string {
  hookLinks(purifier);
  return purifier.sanitize(marked.parse(content, { async: false, gfm: true, breaks: true }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
  });
}
