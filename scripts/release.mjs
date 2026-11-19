#!/usr/bin/env node
import { classifyWorktree } from './lib/release-tools.mjs';
import { ROOT, STORE, command, noLocalStore, fail, cli, parseOptions } from './lib/command.mjs';

const USAGE = 'release.mjs <version> [--chapter N] [--dry-run] [--timeout-ms N]';
const VERSION = /^v?([1-9]\d*)\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/;

function majorOf(tag) {
  const major = Number(VERSION.exec(tag)?.[1]);
  return Number.isSafeInteger(major) ? major : undefined;
}

export async function release(args, { cwd = ROOT, execute = command, print = console.log } = {}) {
  if (args.includes('--help')) {
    print(USAGE + '\nMajor version equals the book chapter. A lower major than the highest local release tag is rejected. A new major requires --chapter N matching that major.\nClean tracked worktree required; only untracked docs/retro/ is allowed. No commit is created. Atomic push; a failed push removes the new local tag.\nRuns fast test, typecheck and build. Deploy immediately afterward with --skip-build to reuse dist; do not change source between commands. Slow/special checks run only on request: test:slow, smoke --llm, Herdr probes, real-model checks.\nCommands default to a 10 minute deadline. PNPM_STORE_DIR overrides the default pnpm store.\nDeployment requires .env or deploy --skip-secrets. Smoke defaults to GET only; smoke --llm POST makes a real LLM call (cost/logs).');
    return;
  }
  const chapterAt = args.indexOf('--chapter');
  const chapter = chapterAt < 0 ? undefined : args[chapterAt + 1];
  if (chapterAt >= 0 && (chapterAt !== args.lastIndexOf('--chapter') || !/^[1-9]\d*$/.test(chapter ?? ''))) {
    fail('usage', '--chapter requires one positive integer');
  }
  const options = chapterAt < 0 ? args : [...args.slice(0, chapterAt), ...args.slice(chapterAt + 2)];
  const { values, timeoutMs } = parseOptions(options, ['--dry-run']);
  const dry = values.includes('--dry-run');
  const positional = values.filter(arg => arg !== '--dry-run');
  const version = positional[0];
  const major = majorOf(version);
  if (positional.length !== 1 || major === undefined) fail('usage', USAGE);
  noLocalStore(cwd);
  const run = (step, program, argv) => execute(step, program, argv, { cwd, timeoutMs });
  const checkVersion = async () => {
    const tags = await run('version', 'git', ['tag', '--list']);
    let latest = 0;
    for (const tag of tags.split(/\r?\n/)) latest = Math.max(latest, majorOf(tag) ?? 0);
    if (major < latest) fail('version', `major ${major} is below the latest major ${latest}; major = book chapter (docs/harness/operations.md)`);
    if (major > latest && chapter !== String(major)) fail('version', `new major ${major} requires --chapter ${major} (book chapter number)`);
    if (chapter !== undefined && chapter !== String(major)) fail('version', `--chapter must match major ${major}`);
    return latest;
  };
  const latest = await checkVersion();
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
    print(`PLAN version major ${major} (latest ${latest})`);
    for (const step of ['test', 'typecheck', 'build', 'og:check']) print(`PLAN pnpm ${STORE} ${step}`);
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
  await run('og:check', 'pnpm', [STORE, 'og:check']);
  print('PASS og:check');
  if ((await run('tag', 'git', ['tag', '--list', version])).trim()) fail('tag', 'already exists locally');
  if ((await run('tag', 'git', ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).trim()) fail('tag', 'already exists remotely');
  await check();
  await checkVersion();
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
