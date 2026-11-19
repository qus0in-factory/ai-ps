import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { renderMarkdown } from '../../../../src/ui/components/markdown/markdown.ts';

const window = new JSDOM('').window;
const purifier = createDOMPurify(window);

describe('Given an AI answer in Markdown', () => {
  it('When rendered Then shows bold, lists, code blocks, tables and links as HTML', () => {
    const html = renderMarkdown([
      '**현재 시간**은 다음과 같습니다.', '',
      '- 첫 번째', '- 두 번째', '',
      '```ts', 'const time = "20:00";', '```', '',
      '| 도시 | 날씨 |', '| --- | --- |', '| 서울 | 맑음 |', '',
      '[날씨 정보](https://openweathermap.org)',
    ].join('\n'), purifier);
    const document = new JSDOM(html).window.document;
    assert.equal(document.querySelector('strong')?.textContent, '현재 시간');
    assert.equal(document.querySelectorAll('li').length, 2);
    assert.equal(document.querySelector('pre code')?.textContent, 'const time = "20:00";\n');
    assert.equal(document.querySelector('td')?.textContent, '서울');
    assert.equal(document.querySelector('a')?.getAttribute('href'), 'https://openweathermap.org');
  });

  it('When the answer contains unsafe HTML Then removes executable markup', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[링크](javascript:alert%281%29)', purifier);
    const document = new JSDOM(html).window.document;
    assert.equal(document.querySelector('script'), null);
    assert.equal(document.querySelector('img'), null);
    assert.equal(document.querySelector('a')?.getAttribute('href'), null);
  });
});
