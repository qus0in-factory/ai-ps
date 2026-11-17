#!/usr/bin/env node
import { mkdtemp, symlink } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, STORE, cli, command } from './lib/command.mjs';

const ALLOWED_OPTIONS = new Set(['--dry-run', '--keep', '--help']);
const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const removeCommand = dir => `git worktree remove --force ${shellQuote(dir)}`;
const usage = () => 'verify-head.mjs [ref] [--dry-run] [--keep] [--help]\nVerify a committed ref in a temporary worktree. Signals during cleanup are ignored until cleanup finishes.';

export const gitSucceeded = result => result?.status === 0 && !result.error && !result.signal;
function systemIO(cwd) {
  return { mkdtemp, symlink, rmSync, existsSync, gitSync: args => {
    try { return gitSucceeded(spawnSync('git', args, { cwd, stdio: 'ignore', timeout: 60_000 })); }
    catch { return false; }
  } };
}
function parseArgs(args) {
  const options = [], positional = [];
  for (const arg of args) {
    if (!arg.startsWith('-')) positional.push(arg);
    else {
      if (!ALLOWED_OPTIONS.has(arg)) throw Error(`unknown option: ${arg}`);
      options.push(arg);
    }
  }
  if (positional.length > 1) throw Error('too many positional arguments');
  return { options, ref: positional[0] || 'HEAD' };
}
function cleanup(dir, addAttempted, io, print) {
  const removed = !addAttempted || io.gitSync(['worktree', 'remove', '--force', dir]);
  try { io.rmSync(dir, { recursive: true, force: true }); }
  catch { /* Check the owned path below. */ }
  const metadataOk = removed || io.gitSync(['worktree', 'prune']);
  let remains = true;
  try { remains = io.existsSync(dir); } catch { /* Treat an unknown state as incomplete. */ }
  if (remains || !metadataOk) {
    print(`FAIL worktree cleanup incomplete: ${dir}`);
    print(`RECOVERY ${removeCommand(dir)}; rm -rf ${shellQuote(dir)}${removed ? '' : '; git worktree prune'}`);
    return false;
  }
  print('PASS worktree-remove');
  return true;
}

export async function verifyHead(args, {
  cwd = ROOT, execute = command, print = console.log, signalTarget = process, io = systemIO(cwd),
} = {}) {
  let parsed;
  try { parsed = parseArgs(args); }
  catch (error) { print(`FAIL ${error.message}`); print(usage()); return { ok: false }; }
  const { options, ref } = parsed;
  const keep = options.includes('--keep');
  if (options.includes('--help')) { print(usage()); return { ok: true }; }
  if (options.includes('--dry-run')) {
    print(`PLAN create temp worktree for ${ref}`);
    print(`PLAN git worktree add --detach <dir> ${ref}`);
    print('PLAN symlink node_modules');
    for (const name of ['test', 'typecheck', 'build']) print(`PLAN pnpm ${STORE} ${name}`);
    print(keep ? 'PLAN keep worktree' : 'PLAN git worktree remove --force <dir>');
    return { ok: true };
  }
  if (!io.existsSync(join(cwd, 'node_modules'))) {
    print('FAIL node_modules missing; run pnpm install');
    return { ok: false };
  }

  let dir, interrupted, addAttempted = false, cleaning = false, failed = false;
  const mark = signal => { if (!cleaning && !interrupted) interrupted = signal; };
  const onInt = () => mark('SIGINT'), onTerm = () => mark('SIGTERM');
  signalTarget.on('SIGINT', onInt);
  signalTarget.on('SIGTERM', onTerm);
  const step = async fn => {
    if (interrupted) throw Error('interrupted');
    const value = await fn();
    if (interrupted) throw Error('interrupted');
    return value;
  };
  try {
    // Assign before step's post-check so an interrupted mkdtemp cannot lose its owned path.
    await step(async () => { dir = await io.mkdtemp(join(tmpdir(), 'ai-ps-verify-')); });
    let oid;
    try { oid = (await step(() => execute('rev-parse', 'git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd }))).trim(); }
    catch (error) { if (interrupted) throw error; throw Error(`invalid ref: ${ref}`); }
    await step(() => {
      addAttempted = true;
      return execute('worktree-add', 'git', ['worktree', 'add', '--detach', dir, oid], { cwd });
    });
    print(`PASS worktree-add ${dir}`);
    await step(() => io.symlink(join(cwd, 'node_modules'), join(dir, 'node_modules')));
    print('PASS symlink node_modules');
    for (const name of ['test', 'typecheck', 'build']) {
      await step(() => execute(name, 'pnpm', [STORE, name], { cwd: dir, forwardOutput: true }));
      print(`PASS ${name}`);
    }
  } catch (error) {
    failed = true;
    print(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    cleaning = true;
    try {
      if (dir && keep) { print(`KEEP ${dir}`); print(`CLEANUP ${removeCommand(dir)}`); }
      else if (dir && !cleanup(dir, addAttempted, io, print)) failed = true;
    } finally {
      signalTarget.removeListener('SIGINT', onInt);
      signalTarget.removeListener('SIGTERM', onTerm);
    }
  }
  if (interrupted) return { ok: false, ...(dir ? { dir } : {}), interrupted: true, interruptedCode: { SIGINT: 130, SIGTERM: 143 }[interrupted] };
  if (!failed) print(`PASS verify ${ref}`);
  return { ok: !failed, ...(dir ? { dir } : {}), interrupted: false };
}

await cli(import.meta.url, async args => {
  const result = await verifyHead(args);
  if (result.interrupted) process.exitCode = result.interruptedCode;
  else if (!result.ok) process.exitCode = 1;
});
