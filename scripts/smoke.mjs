#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeSmoke, mergeSmokePaths, trackedPublicAssets, assetVerdict } from './lib/release-tools.mjs';
import { ROOT, DEFAULT_URL, command, fail, cli, parseOptions } from './lib/command.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function smoke(args, { cwd = ROOT, execute = command, fetcher = fetch, table = console.table, print = console.log, features, readAsset = readFileSync, delay = wait } = {}) {
  if (args.includes('--help')) {
    print('smoke.mjs [url] [--assets] [--llm] [--dry-run] [--timeout-ms N]\nDefault: GET /, /chat and unique route paths from scripts/og.json.\n--assets compares every tracked file under public/ byte-for-byte with the deployed origin (git ls-files -z -- public/). Asset rows show path/status/result only: PASS, MISMATCH, HTTP (non-200 including 3xx) or ERROR (read/request failure). Never hashes or bodies. Only failing asset rows are retried once after 5 seconds; page GETs and the --llm POST are never retried. --dry-run prints plans only.\n--llm adds POST /api/chat: a real LLM call (cost/logs), only on request. Page rows show lengths and content presence, never response text.\n.env is not required here; deploy requires .env unless --skip-secrets is used. PNPM_STORE_DIR overrides the store for release/deploy. Requests have a 90 second limit; --timeout-ms can shorten it.');
    return true;
  }
  const { values, timeoutMs } = parseOptions(args, ['--dry-run', '--llm', '--assets']);
  const dry = values.includes('--dry-run');
  const compareAssets = values.includes('--assets');
  const positional = values.filter(arg => !['--dry-run', '--llm', '--assets'].includes(arg));
  if (positional.length > 1) fail('usage', 'smoke.mjs [url] [--assets] [--llm] [--dry-run]');
  let base;
  try {
    base = new URL(positional[0] ?? DEFAULT_URL);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error();
  } catch { fail('usage', 'expected an http(s) origin without credentials, path, query or fragment'); }
  let paths;
  try { paths = mergeSmokePaths(features ?? JSON.parse(readFileSync(new URL('./og.json', import.meta.url), 'utf8')).features); }
  catch { fail('features', 'cannot read valid feature paths from scripts/og.json'); }
  if (values.includes('--llm') && !paths.includes('/api/chat')) paths.push('/api/chat');
  let files = [];
  if (compareAssets) {
    try { files = trackedPublicAssets(await execute('assets', 'git', ['ls-files', '-z', '--', 'public/'], { cwd, timeoutMs })).files; }
    catch { fail('assets', 'cannot list tracked public files'); }
  }
  const rows = await Promise.all(paths.map(async path => {
    const method = values.includes('--llm') && path === '/api/chat' ? 'POST' : 'GET';
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
  const checkAsset = async file => {
    const path = '/' + file.slice(7).split('/').map(encodeURIComponent).join('/');
    if (dry) return { path, status: '-', result: 'PLAN' };
    const attempt = async () => {
      try {
        const local = await readAsset(join(cwd, file));
        const response = await fetcher(new URL(path, base), { method: 'GET', redirect: 'manual',
          headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(Math.min(90_000, timeoutMs)) });
        return { path, status: response.status, result: assetVerdict(response.status, local, new Uint8Array(await response.arrayBuffer())) };
      } catch { return { path, status: '-', result: 'ERROR' }; }
    };
    let row = await attempt();
    if (row.result !== 'PASS') {
      await delay(5_000);
      row = await attempt();
    }
    return row;
  };
  const assetRows = await Promise.all(files.map(checkAsset));
  if (compareAssets) {
    if (assetRows.length === 0) print('assets: no tracked public assets');
    else table(assetRows);
  }
  return [...rows, ...assetRows].every(row => row.result === 'PASS' || row.result === 'PLAN');
}

await cli(import.meta.url, async args => { if (!await smoke(args)) process.exitCode = 1; });
