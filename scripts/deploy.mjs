#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterAppSecrets, parseDeployment, staleSecretNames } from './lib/release-tools.mjs';
import { ROOT, STORE, command, noLocalStore, fail, cli, parseOptions } from './lib/command.mjs';

export async function deploy(args, { cwd = ROOT, execute = command, print = console.log } = {}) {
  if (args.includes('--help')) {
    print('deploy.mjs [--skip-secrets] [--skip-build] [--dry-run] [--timeout-ms N]\nDefault: requires .env; uploads nonempty allowlisted app keys via stdin. --skip-secrets deploys using existing remote secrets without .env. Missing local keys are preserved remotely with a warning, never deleted.\n--skip-build reuses existing dist/index.html after release/build; do not change source between building and deploying. Standalone deployment builds once by default.\nRequires noninteractive Wrangler authentication. Only the listed options are accepted; workers.dev must be enabled. No automatic rollback: a failure may follow successful secret upload or deployment.\nCommands default to a 10 minute hard deadline. PNPM_STORE_DIR overrides the default pnpm store.\nPost-deploy smoke checks GET /, /chat and scripts/og.json feature paths, plus --assets comparing every tracked file under public/ (git ls-files -z -- public/) byte-for-byte with the deployed origin. Asset rows show PASS/MISMATCH/HTTP/ERROR without hashes or bodies; only failing asset rows are retried once after 5 seconds (pages and --llm POST are not retried). Page rows show lengths and content presence, never response text. Run smoke --llm only on request: its POST makes a real LLM call (cost/logs). --dry-run prints plans only; no remote calls.');
    return;
  }
  const { values, timeoutMs } = parseOptions(args, ['--skip-secrets', '--skip-build', '--dry-run']);
  if (values.some(arg => !['--skip-secrets', '--skip-build', '--dry-run'].includes(arg))) fail('usage', 'deploy.mjs [--skip-secrets] [--skip-build] [--dry-run] [--timeout-ms N]');
  const dry = values.includes('--dry-run');
  const skipSecrets = values.includes('--skip-secrets');
  const skipBuild = values.includes('--skip-build');
  noLocalStore(cwd);
  if (skipBuild && !existsSync(join(cwd, 'dist/index.html'))) fail('build', 'dist/index.html missing; run release or build before --skip-build');
  const run = (step, program, argv, options = {}) => execute(step, program, argv, { cwd, timeoutMs, forwardOutput: step === 'smoke', ...options });
  let secrets = {};
  if (!skipSecrets) {
    try {
      if (!dry || existsSync(join(cwd, '.env'))) secrets = filterAppSecrets(readFileSync(join(cwd, '.env'), 'utf8'));
    } catch { fail('env', 'cannot read or parse .env; use --skip-secrets to preserve remote secrets'); }
    print(`SECRET KEYS: ${Object.keys(secrets).join(', ') || '(none)'}`);
  }
  if (dry) {
    print(skipBuild ? 'PLAN reuse existing dist (--skip-build)' : `PLAN pnpm ${STORE} build`);
    if (!skipSecrets) {
      print(`PLAN pnpm ${STORE} exec wrangler secret list --format json; warn about omitted app keys preserved remotely`);
      print(`PLAN pnpm ${STORE} exec wrangler secret bulk (JSON via stdin; no temporary file)`);
    }
    print(`PLAN pnpm ${STORE} exec wrangler deploy`);
    print('PLAN parse workers.dev URL and Version ID; smoke.mjs <url> --assets (GET pages from scripts/og.json; compare all tracked public/ files byte-for-byte; LLM requires a separate smoke --llm)');
    return;
  }
  let phase = 'build', secretState = skipSecrets ? 'skipped' : 'unchanged', deploymentState = 'not-started';
  try {
    if (!skipBuild) {
      await run('build', 'pnpm', [STORE, 'build']);
      print('PASS build');
    } else print('SKIP build (reusing existing dist)');
    noLocalStore(cwd);
    if (!skipSecrets) {
      phase = 'secret-list';
      let remoteSecrets = null;
      try {
        remoteSecrets = await run('secret-list', 'pnpm', [STORE, 'exec', 'wrangler', 'secret', 'list', '--format', 'json']);
      } catch (error) {
        if (error?.code !== 'WORKER_NOT_FOUND') throw error;
        print('WARN Worker not found; remote secret comparison skipped for first deployment');
      }
      if (remoteSecrets !== null) {
        const stale = staleSecretNames(remoteSecrets, secrets);
        if (stale.length) print(`WARN remote app secrets omitted from .env are preserved (not deleted): ${stale.join(', ')}`);
      }
      if (Object.keys(secrets).length) {
        phase = 'secrets';
        secretState = 'unknown (upload attempted)';
        await run('secrets', 'pnpm', [STORE, 'exec', 'wrangler', 'secret', 'bulk'], { input: JSON.stringify(secrets) });
        secretState = 'uploaded';
        print('PASS secrets');
      }
    }
    secrets = {};
    phase = 'deploy';
    deploymentState = 'unknown (deploy attempted)';
    const output = await run('deploy', 'pnpm', [STORE, 'exec', 'wrangler', 'deploy']);
    deploymentState = 'completed';
    phase = 'deploy-parse';
    const result = parseDeployment(output);
    if (!result) throw new Error('unparseable deployment');
    print(`PASS deploy ${result.url} Version ID: ${result.versionId}`);
    phase = 'smoke';
    await run('smoke', process.execPath, [join(ROOT, 'scripts/smoke.mjs'), result.url, '--assets']);
  } catch {
    fail('deploy', `${phase} failed; secrets=${secretState}; deployment=${deploymentState}; no automatic rollback; inspect remote state before retrying${secretState === 'uploaded' ? ' with --skip-secrets' : ''}${deploymentState === 'completed' ? '; rerun smoke --assets on the deployed URL' : ''}`);
  } finally { secrets = {}; }
}

await cli(import.meta.url, deploy);
