#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterAppSecrets, parseDeployment, staleSecretNames } from './lib/release-tools.mjs';
import { ROOT, STORE, command, noLocalStore, fail, cli, parseOptions } from './lib/command.mjs';

export async function deploy(args, { cwd = ROOT, execute = command, print = console.log } = {}) {
  if (args.includes('--help')) {
    print('deploy.mjs [--skip-secrets] [--dry-run] [--timeout-ms N]\nDefault: requires .env; uploads nonempty allowlisted app keys via stdin. --skip-secrets deploys using existing remote secrets without .env. Missing local keys are preserved remotely with a warning, never deleted.\nRequires noninteractive Wrangler authentication. Only the listed options are accepted; workers.dev must be enabled. No automatic rollback: a failure may follow successful secret upload or deployment.\nCommands default to a 10 minute hard deadline. PNPM_STORE_DIR overrides the default pnpm store.\nPost-deploy smoke POST makes a real LLM call and may incur cost/logs. --dry-run performs no remote calls.');
    return;
  }
  const { values, timeoutMs } = parseOptions(args, ['--skip-secrets', '--dry-run']);
  if (values.some(arg => !['--skip-secrets', '--dry-run'].includes(arg))) fail('usage', 'deploy.mjs [--skip-secrets] [--dry-run] [--timeout-ms N]');
  const dry = values.includes('--dry-run');
  const skipSecrets = values.includes('--skip-secrets');
  noLocalStore(cwd);
  let secrets = {};
  if (!skipSecrets) {
    try {
      if (!dry || existsSync(join(cwd, '.env'))) secrets = filterAppSecrets(readFileSync(join(cwd, '.env'), 'utf8'));
    } catch { fail('env', 'cannot read or parse .env; use --skip-secrets to preserve remote secrets'); }
    print(`SECRET KEYS: ${Object.keys(secrets).join(', ') || '(none)'}`);
  }
  if (dry) {
    print(`PLAN pnpm ${STORE} build`);
    if (!skipSecrets) {
      print(`PLAN pnpm ${STORE} exec wrangler secret list --format json; warn about omitted app keys preserved remotely`);
      print(`PLAN pnpm ${STORE} exec wrangler secret bulk (JSON via stdin; no temporary file)`);
    }
    print(`PLAN pnpm ${STORE} exec wrangler deploy`);
    print('PLAN parse workers.dev URL and Version ID; smoke POST makes a real LLM call only outside dry-run');
    return;
  }
  const run = (step, program, argv, options = {}) => execute(step, program, argv, { cwd, timeoutMs, forwardOutput: step === 'smoke', ...options });
  let phase = 'build', secretState = skipSecrets ? 'skipped' : 'unchanged', deploymentState = 'not-started';
  try {
    await run('build', 'pnpm', [STORE, 'build']);
    print('PASS build');
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
    await run('smoke', process.execPath, [join(ROOT, 'scripts/smoke.mjs'), result.url]);
  } catch {
    fail('deploy', `${phase} failed; secrets=${secretState}; deployment=${deploymentState}; no automatic rollback; inspect remote state before retrying${secretState === 'uploaded' ? ' with --skip-secrets' : ''}${deploymentState === 'completed' ? '; rerun smoke on the deployed URL' : ''}`);
  } finally { secrets = {}; }
}

await cli(import.meta.url, deploy);
