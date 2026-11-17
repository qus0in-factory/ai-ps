import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { verifyHead, gitSucceeded, type VerifyHeadOptions, type VerifyHeadIO } from '../../scripts/verify-head.mjs';
import { STORE } from '../../scripts/lib/command.mjs';

const ROOT = '/mock/repo', TEMP = "/mock/temp/verify 'dir", OID = '0123456789abcdef0123456789abcdef01234567';
function fixture() {
  const signals = new EventEmitter(), printed: string[] = [], effects: string[] = [], gitCalls: string[][] = [];
  const commands: { step: string; program: string; args: string[]; cwd?: string; forwardOutput?: boolean }[] = [];
  const state = { modules: true, remains: true };
  const io: VerifyHeadIO = {
    mkdtemp: async () => { effects.push('mkdtemp'); return TEMP; },
    symlink: async (from, to) => {
      effects.push('symlink'); assert.equal(from, ROOT + '/node_modules'); assert.equal(to, TEMP + '/node_modules');
    },
    gitSync: args => { effects.push(args[1]!); gitCalls.push(args); return true; },
    rmSync: (dir, options) => {
      assert.equal(dir, TEMP); assert.deepEqual(options, { recursive: true, force: true }); effects.push('rm'); state.remains = false;
    },
    existsSync: dir => {
      effects.push('exists'); if (dir === ROOT + '/node_modules') return state.modules;
      assert.equal(dir, TEMP); return state.remains;
    },
  };
  const execute: NonNullable<VerifyHeadOptions['execute']> = async (step, program, args, options) => {
    commands.push({ step, program, args, ...options }); return step === 'rev-parse' ? OID + '\n' : '';
  };
  const options: VerifyHeadOptions = { cwd: ROOT, io, execute, signalTarget: signals, print: line => printed.push(line) };
  const detached = () => { assert.equal(signals.listenerCount('SIGINT'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0); };
  return { options, io, execute, signals, printed, effects, gitCalls, commands, state, detached };
}

describe('Given committed-ref verification with mock IO', () => {
  it('When requesting help or a dry run Then performs no effects and explains cleanup signal handling', async () => {
    for (const flag of ['--help', '--dry-run']) {
      const f = fixture(); assert.equal((await verifyHead([flag], f.options)).ok, true);
      assert.deepEqual(f.effects, []); assert.deepEqual(f.commands, []); f.detached();
      assert.match(f.printed.join('\n'), flag === '--help' ? /cleanup.*ignored/ : /PLAN/);
    }
  });
  it('When verifying a ref Then pins its OID and forwards every pnpm stage output from the worktree', async () => {
    const f = fixture(); assert.deepEqual(await verifyHead(['release-ref'], f.options), { ok: true, dir: TEMP, interrupted: false });
    assert.deepEqual(f.commands, [
      { step: 'rev-parse', program: 'git', args: ['rev-parse', '--verify', 'release-ref^{commit}'], cwd: ROOT },
      { step: 'worktree-add', program: 'git', args: ['worktree', 'add', '--detach', TEMP, OID], cwd: ROOT },
      ...['test', 'typecheck', 'build'].map(step => ({ step, program: 'pnpm', args: [STORE, step], cwd: TEMP, forwardOutput: true })),
    ]);
    assert.deepEqual(f.gitCalls, [['worktree', 'remove', '--force', TEMP]]); assert.ok(f.effects.includes('rm')); f.detached();
  });
  it('When validation fails at any stage Then skips later stages and still cleans up', async () => {
    for (const step of ['test', 'typecheck', 'build']) {
      const f = fixture(); f.options.execute = async (...args) => {
        const output = await f.execute(...args); if (args[0] === step) throw Error('stage failed'); return output;
      };
      assert.equal((await verifyHead([], f.options)).ok, false);
      const stages = ['rev-parse', 'worktree-add', 'test', 'typecheck', 'build'];
      assert.deepEqual(f.commands.map(c => c.step), stages.slice(0, stages.indexOf(step) + 1));
      assert.ok(f.effects.includes('rm')); f.detached();
    }
  });
  it('When --keep validation fails Then preserves the directory and prints its quoted cleanup command', async () => {
    const f = fixture(); f.options.execute = async (...args) => {
      const output = await f.execute(...args); if (args[0] === 'test') throw Error('stage failed'); return output;
    };
    assert.equal((await verifyHead(['--keep'], f.options)).ok, false);
    assert.ok(f.printed.includes(`KEEP ${TEMP}`)); assert.ok(f.printed.some(line => line.includes("git worktree remove --force '/mock/temp/verify '\\''dir'")));
    assert.deepEqual(f.gitCalls, []); assert.ok(!f.effects.includes('rm')); f.detached();
  });
  it('When options or refs are invalid Then rejects before effects', async () => {
    for (const args of [['--bogus'], ['a', 'b'], ['-f'], ['--'], ['--', '-f']]) {
      const f = fixture(); assert.equal((await verifyHead(args, f.options)).ok, false);
      assert.deepEqual(f.effects, []); assert.deepEqual(f.commands, []); f.detached();
    }
  });
  it('When add partially fails Then removes the owned directory and prunes only after failed removal', async () => {
    const f = fixture(); f.options.execute = async (...args) => {
      const output = await f.execute(...args); if (args[0] === 'worktree-add') throw Error('partial add'); return output;
    };
    const git = f.io.gitSync; f.io.gitSync = args => { git(args); return args[1] === 'prune'; };
    assert.equal((await verifyHead([], f.options)).ok, false);
    assert.deepEqual(f.effects.filter(x => ['remove', 'rm', 'prune'].includes(x)), ['remove', 'rm', 'prune']);
    assert.deepEqual(f.gitCalls, [['worktree', 'remove', '--force', TEMP], ['worktree', 'prune']]); f.detached();
  });
  it('When the directory remains Then reports failure with shell-quoted recovery', async () => {
    const f = fixture(), exists = f.io.existsSync; f.io.existsSync = dir => dir === TEMP ? true : exists(dir);
    assert.equal((await verifyHead([], f.options)).ok, false);
    assert.ok(f.printed.some(line => line.startsWith('RECOVERY') && line.includes("'/mock/temp/verify '\\''dir'")));
    assert.ok(!f.printed.includes('PASS worktree-remove')); f.detached();
  });
  it('When SIGINT arrives between stages Then skips remaining work and reports 130', async () => {
    const f = fixture(); f.options.execute = async (...args) => {
      const output = await f.execute(...args); if (args[0] === 'test') f.signals.emit('SIGINT'); return output;
    };
    assert.deepEqual(await verifyHead([], f.options), { ok: false, dir: TEMP, interrupted: true, interruptedCode: 130 });
    assert.deepEqual(f.commands.map(c => c.step), ['rev-parse', 'worktree-add', 'test']); assert.ok(f.effects.includes('rm')); f.detached();
  });
  it('When SIGTERM arrives during mkdtemp Then already has handlers and cleans the returned path', async () => {
    const f = fixture(), make = f.io.mkdtemp; f.io.mkdtemp = async prefix => {
      assert.equal(f.signals.listenerCount('SIGINT'), 1); assert.equal(f.signals.listenerCount('SIGTERM'), 1);
      f.signals.emit('SIGTERM'); await Promise.resolve(); return make(prefix);
    };
    assert.deepEqual(await verifyHead([], f.options), { ok: false, dir: TEMP, interrupted: true, interruptedCode: 143 });
    assert.deepEqual(f.commands, []); assert.ok(f.effects.includes('rm')); f.detached();
  });
  it('When signals arrive throughout cleanup Then ignores them through the last cleanup message', async () => {
    const f = fixture(), git = f.io.gitSync, rm = f.io.rmSync, exists = f.io.existsSync;
    f.io.gitSync = args => { assert.equal(f.signals.emit('SIGINT'), true); git(args); return args[1] === 'prune'; };
    f.io.rmSync = (...args) => { assert.equal(f.signals.emit('SIGTERM'), true); rm(...args); };
    f.io.existsSync = dir => { if (dir === TEMP) assert.equal(f.signals.emit('SIGINT'), true); return exists(dir); };
    f.options.print = line => { f.printed.push(line); if (line === 'PASS worktree-remove') assert.equal(f.signals.emit('SIGTERM'), true); };
    assert.deepEqual(await verifyHead([], f.options), { ok: true, dir: TEMP, interrupted: false });
    assert.deepEqual(f.gitCalls.map(args => args[1]), ['remove', 'prune']); f.detached();
  });
  it('When mkdtemp fails Then detaches handlers without cleaning an unowned path', async () => {
    const f = fixture(); f.io.mkdtemp = async () => { throw Error('mkdtemp failed'); };
    const result = await verifyHead([], f.options); assert.equal(result.ok, false); assert.equal(result.dir, undefined);
    assert.deepEqual(f.gitCalls, []); assert.ok(!f.effects.includes('rm')); f.detached();
  });
  it('When ref resolution fails Then reports the requested invalid ref and cleans only its directory', async () => {
    const f = fixture(); f.options.execute = async (...args) => { await f.execute(...args); throw Error('git failed'); };
    assert.equal((await verifyHead(['badref'], f.options)).ok, false);
    assert.ok(f.printed.includes('FAIL invalid ref: badref')); assert.deepEqual(f.gitCalls, []);
    assert.ok(f.effects.includes('rm')); f.detached();
  });
  it('When symlink creation fails Then removes the worktree without running pnpm', async () => {
    const f = fixture(); f.io.symlink = async () => { throw Error('link failed'); };
    assert.equal((await verifyHead([], f.options)).ok, false);
    assert.deepEqual(f.commands.map(c => c.step), ['rev-parse', 'worktree-add']); assert.ok(f.effects.includes('rm')); f.detached();
  });
  it('When git status, error or signal indicates failure Then never reports cleanup success', async () => {
    for (const [result, expected] of [
      [{ status: 0 }, true], [{ status: 1 }, false], [{ status: null, error: Error('ENOENT') }, false],
      [{ status: null, signal: 'SIGTERM' }, false], [{ status: 0, error: Error('timeout') }, false],
      [{ status: 0, signal: 'SIGINT' }, false], [{}, false], [undefined, false],
    ] as const) assert.equal(gitSucceeded(result), expected);
    const f = fixture(), git = f.io.gitSync; f.io.gitSync = args => { git(args); return false; };
    assert.equal((await verifyHead([], f.options)).ok, false);
    assert.ok(!f.printed.includes('PASS worktree-remove')); assert.ok(f.printed.some(line => line.startsWith('RECOVERY'))); f.detached();
  });
  it('When root node_modules is missing Then fails before allocating a directory or executing git', async () => {
    const f = fixture(); f.state.modules = false;
    assert.equal((await verifyHead([], f.options)).ok, false);
    assert.ok(f.printed.some(line => line.startsWith('FAIL node_modules missing')));
    assert.deepEqual(f.commands, []); assert.ok(!f.effects.includes('mkdtemp')); f.detached();
  });
});
