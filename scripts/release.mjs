#!/usr/bin/env node
import { classifyWorktree } from './lib/release-tools.mjs';
import { ROOT, STORE, command, noLocalStore, fail, cli, parseOptions } from './lib/command.mjs';

export async function release(args, { cwd = ROOT, execute = command, print = console.log } = {}) {
  if (args.includes('--help')) {
    print('release.mjs <version> [--dry-run] [--timeout-ms N]\nClean tracked worktree required; only untracked docs/retro/ is allowed. No commit is created. Atomic push; a failed push removes the new local tag.\nCommands default to a 10 minute deadline. PNPM_STORE_DIR overrides the default pnpm store.\nDeployment requires .env or deploy --skip-secrets; smoke POST makes a real LLM call (cost/logs).');
    return;
  }
  const { values, timeoutMs } = parseOptions(args, ['--dry-run']);
  const dry = values.includes('--dry-run');
  const positional = values.filter(arg => arg !== '--dry-run');
  if (positional.length !== 1 || !/^v?\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(positional[0])) fail('usage', 'release.mjs <version> [--dry-run] [--timeout-ms N]');
  const version = positional[0];
  noLocalStore(cwd);
  const run = (step, program, argv) => execute(step, program, argv, { cwd, timeoutMs });
  const branch = (await run('branch', 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  if (!branch) fail('branch', 'detached HEAD');
  const head = (await run('head', 'git', ['rev-parse', 'HEAD'])).trim();
  const check = async () => {
    noLocalStore(cwd);
    const state = classifyWorktree(await run('worktree', 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    if (state.dirty.length || state.untracked.some(path => !path.startsWith('docs/retro/'))) fail('worktree', 'tracked changes or unapproved untracked files; commit changes before validating HEAD');
    if (state.untracked.length) print('WARN untracked docs/retro/ excluded from HEAD');
  };
  await check();
  if (dry) {
    for (const step of ['test', 'typecheck', 'build']) print(`PLAN pnpm ${STORE} ${step}`);
    print(`PLAN check local and remote tag ${version}; recheck worktree and HEAD`);
    print(`PLAN git tag ${version} (HEAD ${head})`);
    print(`PLAN git push --atomic origin ${branch} ${version}; remove local tag on push failure`);
    print(`PLAN git ls-remote --tags origin ${version} (verify HEAD)`);
    return;
  }
  for (const step of ['test', 'typecheck', 'build']) {
    await run(step, 'pnpm', [STORE, step]);
    print(`PASS ${step}`);
  }
  if ((await run('tag', 'git', ['tag', '--list', version])).trim()) fail('tag', 'already exists locally');
  if ((await run('tag', 'git', ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).trim()) fail('tag', 'already exists remotely');
  await check();
  if ((await run('head', 'git', ['rev-parse', 'HEAD'])).trim() !== head || (await run('branch', 'git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() !== branch) fail('head', 'HEAD or branch changed during validation');
  await run('tag', 'git', ['tag', version]);
  try { await run('push', 'git', ['push', '--atomic', 'origin', branch, version]); }
  catch {
    let cleanup = 'local tag removed';
    try { await run('tag', 'git', ['tag', '-d', version]); }
    catch { cleanup = 'local tag removal failed'; }
    fail('push', `${cleanup}; remote outcome unknown (atomic request); inspect git ls-remote before retrying`);
  }
  const remote = await run('verify', 'git', ['ls-remote', '--tags', 'origin', version]);
  if (!remote.split(/\r?\n/).some(line => line.trim() === `${head}\trefs/tags/${version}`)) fail('verify', 'remote tag does not match validated HEAD; push completed; no automatic rollback');
  print(`PASS release ${version} (${head})`);
}

await cli(import.meta.url, release);
