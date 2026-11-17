import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const STORE = `--config.store-dir=${process.env.PNPM_STORE_DIR || '/Users/young-mini/Library/pnpm/store'}`;
export const DEFAULT_URL = 'https://ai-ps.qus0in.workers.dev';
class StepError extends Error {}
export function fail(step, reason) { throw new StepError(`${step}: ${reason}`); }
export function cleanOutput(text) {
  return stripVTControlCharacters(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}
export function noLocalStore(cwd = ROOT) {
  if (existsSync(`${cwd}/.pnpm-store`)) fail('worktree', '.pnpm-store exists; remove it before continuing');
}

export function parseOptions(args, flags) {
  const values = [];
  let timeoutMs = 600_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout-ms') {
      const value = args[++i];
      if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483_647) fail('usage', '--timeout-ms requires an integer between 1 and 2147483647');
      timeoutMs = Number(value);
    } else if (args[i].startsWith('--') && !flags.includes(args[i])) fail('usage', 'unknown option');
    else values.push(args[i]);
  }
  return { values, timeoutMs };
}

// Secrets travel only through a pipe; Wrangler cannot write unsanitized disk logs.
// A new process group lets the hard deadline kill only this command and descendants.
export async function command(step, executable, args, { cwd = ROOT, forwardOutput = false, input, timeoutMs = 600_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) fail(step, 'invalid deadline');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, detached: process.platform !== 'win32',
      env: { ...process.env, WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false',
        CLOUDFLARE_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', bytes = 0, failure;
    const stop = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* Already exited. */ }
    };
    const onSignal = signal => { failure = `interrupted by ${signal}`; process.exitCode = signal === 'SIGINT' ? 130 : 143; stop(); };
    const onInt = () => onSignal('SIGINT');
    const onTerm = () => onSignal('SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    const timer = setTimeout(() => { failure = `deadline exceeded (${timeoutMs}ms)`; stop(); }, timeoutMs);
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { failure = 'output limit exceeded'; stop(); return; }
      if (target === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', collect('stdout'));
    child.stderr.setEncoding('utf8').on('data', collect('stderr'));
    child.stdin.on('error', () => {}); // EPIPE must never expose the input buffer.
    child.on('error', () => { failure = 'command unavailable'; });
    child.on('close', code => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
      if (forwardOutput && stdout) console.log(stdout.split(/\r?\n/).map(cleanOutput).join('\n').trimEnd());
      if (failure || code !== 0) {
        const error = new StepError(`${step}: ${failure ?? `command failed (${code ?? 'signal'})`}`);
        // Only Wrangler's specific missing-Worker diagnostic permits bootstrap.
        // Authentication, network, generic 404 and timeout failures stay fatal.
        const diagnostic = stripVTControlCharacters(stdout + '\n' + stderr);
        if (!failure && Number.isInteger(code) && code > 0 && step === 'secret-list' &&
            /(?:^|\n)[^\S\r\n]*(?:✘\s*)?(?:\[ERROR\]\s*)?Worker(?:\s+"[^"\r\n]+")?\s+not found(?:[.!]|$)/im.test(diagnostic)) {
          error.code = 'WORKER_NOT_FOUND';
        }
        reject(error);
      } else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

export async function cli(moduleUrl, main) {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) return;
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(`FAIL ${error instanceof StepError ? cleanOutput(error.message) : 'internal: operation failed'}`);
    process.exitCode ||= 1;
  }
}
