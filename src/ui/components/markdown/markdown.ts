import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(content: string, purifier: Pick<typeof DOMPurify, 'sanitize'> = DOMPurify): string {
  return purifier.sanitize(marked.parse(content, { async: false, gfm: true, breaks: true }), {
    USE_PROFILES: { html: true },
  });
}
