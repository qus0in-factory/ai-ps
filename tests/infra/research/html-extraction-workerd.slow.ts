import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('Given native HTMLRewriter When a stream reaches the text or parser work limit Then stops within the budget', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-html-workerd-'));
  try {
    const script = join(directory, 'worker.ts');
    const config = join(directory, 'wrangler.json');
    const readerPath = fileURLToPath(new URL('../../../src/infra/research-web-reader.ts', import.meta.url));
    await writeFile(config, JSON.stringify({ name: 'research-html-local', main: script,
      compatibility_date: '2026-11-17', compatibility_flags: ['nodejs_compat'] }));
    await writeFile(script, `
      import { createResearchWebReader } from ${JSON.stringify(readerPath)};
      const encoder = new TextEncoder();
      export default {
        async fetch(request) {
          let pulls = 0;
          let cancelled = false;
          const path = new URL(request.url).pathname;
          const html = path === '/malformed' ? '<'.repeat(1024 * 1024)
            : path === '/oversize' ? 'x'.repeat(1024 * 1024 + 1)
            : new ReadableStream({
                pull(controller) {
                  pulls++;
                  if (pulls === 1) controller.enqueue(encoder.encode('<title>A &am'));
                  if (pulls === 2) controller.enqueue(encoder.encode('p; B</title><main>' + 'x'.repeat(4100) + '</main>'));
                  if (pulls > 2) return new Promise(() => {});
                },
                cancel() { cancelled = true; },
              }, { highWaterMark: 0 });
          const started = Date.now();
          const reader = createResearchWebReader({
            lookup: async () => ['93.184.216.34'],
            fetcher: async () => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
          });
          const result = await reader.read('https://example.com');
          return Response.json({ ok: result.ok, ms: Date.now() - started, pulls, cancelled,
            ...(result.ok ? { title: result.value.title, length: result.value.content.length } : {}) });
        }
      };
    `);
    process.env.WRANGLER_WRITE_LOGS = 'false';
    process.env.CLOUDFLARE_SEND_METRICS = 'false';
    process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
    const wranglerModule = 'wrangler';
    const { unstable_dev } = await import(wranglerModule);
    const worker = await unstable_dev(script, {
      config, local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0, persist: false, logLevel: 'none',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
    try {
      const local = async (path: string) => {
        const response = await worker.fetch('http://localhost' + path, { signal: AbortSignal.timeout(4000) });
        assert.equal(response.status, 200);
        return response.json();
      };
      const { ms: earlyMs, ...early } = await local('/early');
      assert.deepEqual(early, { ok: true, pulls: 2, cancelled: true, title: 'A & B', length: 4000 });
      assert.ok(earlyMs < 200);
      const malformed = await local('/malformed');
      assert.equal(malformed.ok, false);
      assert.ok(malformed.ms < 200, `1 MiB of malformed HTML took ${malformed.ms} ms`);
      assert.equal((await local('/oversize')).ok, false);
    } finally { await worker.stop(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
