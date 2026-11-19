import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResearchWebReader } from '../../../src/infra/research-web-reader.ts';
import { MAX_RESEARCH_RESPONSE_BYTES } from '../../../src/infra/research-http.ts';

function reader(body: BodyInit) {
  return createResearchWebReader({
    lookup: async () => ['93.184.216.34'],
    fetcher: async () => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  });
}

describe('Given readable HTML with page chrome and nested content', () => {
  it('When main follows an article Then prefers main and preserves text across inline and block boundaries', async () => {
    const result = await reader(`<!doctype html><html><head><title>  A &amp; B  </title></head><body>
      <article><p>Previous article</p></article><main><header>Hidden header</header>
      <section><p>First <em>line</em> &lt;literal&gt;</p><p>Inter<strong>rupted</strong><br>last line</p>
      <aside><aside>Hidden nested aside</aside></aside></section>
      <noscript>Hidden noscript</noscript><nav>Hidden nav</nav><footer>Hidden footer</footer></main></body></html>`).read('https://example.com');
    assert.deepEqual(result, { ok: true, value: {
      url: 'https://example.com/', title: 'A & B', content: 'First line <literal>\nInterrupted\nlast line',
    } });
  });

  it('When main or article is missing Then falls back to the best remaining readable section', async () => {
    for (const [markup, expected] of [
      ['<body><p>Before</p><article><article>Once</article><p>Next</p></article></body>', 'Once\nNext'],
      ['<head><title>Title</title></head><body><p>Body</p><div>Second</div></body>', 'Body\nSecond'],
    ]) {
      const result = await reader(markup).read('https://example.com');
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value.content, expected);
    }
  });

  it('When a 1 MiB run of unclosed tag starts reaches extraction Then finishes within its time budget', async () => {
    const markup = '<main>Readable</main>' + '<'.repeat(MAX_RESEARCH_RESPONSE_BYTES - '<main>Readable</main>'.length);
    // Warm the local parser so this measures the input, not module loading.
    await reader('<main>Warm up</main>').read('https://example.com');
    const started = performance.now();
    const result = await reader(markup).read('https://example.com');
    assert.ok(performance.now() - started < 1_000, 'the parser spent more than one second on 1 MiB');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.content, 'Readable');
  });
});
