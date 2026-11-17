#!/usr/bin/env node
import { judgeSmoke } from './lib/release-tools.mjs';
import { DEFAULT_URL, fail, cli, parseOptions } from './lib/command.mjs';

export async function smoke(args, { fetcher = fetch, table = console.table } = {}) {
  if (args.includes('--help')) {
    console.log('smoke.mjs [url] [--llm] [--dry-run] [--timeout-ms N]\nDefault: GET /, /queen, /chat only. --llm adds POST /api/chat: a real LLM call (cost/logs), only on request. Only lengths and content presence are printed, never response text.\n.env is not required here; deploy requires .env unless --skip-secrets is used. PNPM_STORE_DIR overrides the store for release/deploy. Requests have a 90 second limit; --timeout-ms can shorten it.');
    return true;
  }
  const { values, timeoutMs } = parseOptions(args, ['--dry-run', '--llm']);
  const dry = values.includes('--dry-run');
  const positional = values.filter(arg => !['--dry-run', '--llm'].includes(arg));
  if (positional.length > 1) fail('usage', 'smoke.mjs [url] [--llm] [--dry-run]');
  let base;
  try {
    base = new URL(positional[0] ?? DEFAULT_URL);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error();
  } catch { fail('usage', 'expected an http(s) origin without credentials, path, query or fragment'); }
  const paths = ['/', '/queen', '/chat', ...(values.includes('--llm') ? ['/api/chat'] : [])];
  const rows = await Promise.all(paths.map(async path => {
    const method = path === '/api/chat' ? 'POST' : 'GET';
    if (dry) return { method, path, status: '-', result: 'PLAN', length: 0, contentPresent: false };
    try {
      const response = await fetcher(new URL(path, base), {
        method, redirect: 'manual', signal: AbortSignal.timeout(Math.min(90_000, timeoutMs)),
        headers: method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json' }
          : { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
        ...(method === 'POST' ? { body: JSON.stringify({ messages: [{ role: 'user', content: '안녕' }] }) } : {}),
      });
      const verdict = judgeSmoke(path, response.status, response.headers.get('Content-Type') ?? '', await response.text());
      return { method, path, status: response.status, result: verdict.ok ? 'PASS' : 'FAIL', length: verdict.length, contentPresent: verdict.contentPresent };
    } catch {
      return { method, path, status: '-', result: 'FAIL', length: 0, contentPresent: false };
    }
  }));
  table(rows);
  return rows.every(row => row.result !== 'FAIL');
}

await cli(import.meta.url, async args => { if (!await smoke(args)) process.exitCode = 1; });
