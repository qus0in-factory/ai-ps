import { renderMarkdown } from './markdown.ts';
import './Markdown.css';

export function Markdown(props: { content: string }) {
  return <div class="markdown" innerHTML={renderMarkdown(props.content)} />;
}
