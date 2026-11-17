import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { release } from '../../scripts/release.mjs';
import { deploy } from '../../scripts/deploy.mjs';

const { smoke } = await import(new URL('../../scripts/smoke.mjs', import.meta.url).href) as {
  smoke(args: string[], options: { fetcher?: typeof fetch; table?: (rows: unknown[]) => void }): Promise<boolean>;
};

const versionId = '12345678-abcd-1234-abcd-123456789abc';
const deployment = `https://ai-ps.test.workers.dev\nCurrent Version ID: ${versionId}`;

describe('Given the default fast deployment checks', () => {
  for (const llm of [false, true]) {
    it(`When smoke ${llm ? 'explicitly enables LLM' : 'uses defaults'} Then ${llm ? 'includes' : 'omits'} the chat POST`, async () => {
      const calls: { path: string; method: string }[] = [];
      let rows: unknown[] = [];
      assert.equal(await smoke(['https://fake.example', ...(llm ? ['--llm'] : [])], {
        fetcher: async (url, init) => {
          const path = new URL(String(url)).pathname;
          calls.push({ path, method: init!.method! });
          if (path === '/api/chat') {
            assert.deepEqual(JSON.parse(String(init!.body)), { messages: [{ role: 'user', content: '안녕' }] });
            return Response.json({ content: 'fake answer' });
          }
          return new Response('<html>fake page</html>');
        }, table: values => { rows = values; },
      }), true);
      assert.deepEqual(calls, [
        { path: '/', method: 'GET' }, { path: '/queen', method: 'GET' }, { path: '/chat', method: 'GET' },
        ...(llm ? [{ path: '/api/chat', method: 'POST' }] : []),
      ]);
      assert.equal(rows.length, llm ? 4 : 3);
    });
  }
  it('When an explicitly requested LLM check fails Then smoke fails without printing response text', async () => {
    let rows: unknown[] = [];
    assert.equal(await smoke(['https://fake.example', '--llm'], {
      fetcher: async url => new URL(String(url)).pathname === '/api/chat'
        ? new Response('PRIVATE_FAILURE', { status: 502 }) : new Response('<html>page</html>'),
      table: values => { rows = values; },
    }), false);
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_FAILURE'));
  });
  it('When reusing a release build Then deploy skips build and its smoke does not enable LLM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ps-reuse-build-'));
    const calls: { step: string; args: string[] }[] = [];
    try {
      mkdirSync(join(cwd, 'dist'));
      writeFileSync(join(cwd, 'dist/index.html'), '<html>built page</html>');
      await deploy(['--skip-secrets', '--skip-build'], { cwd, print: () => {}, execute: (step, _program, args) => {
        calls.push({ step, args });
        return step === 'deploy' ? deployment : '';
      } });
      assert.deepEqual(calls.map(call => call.step), ['deploy', 'smoke']);
      assert.ok(!calls.find(call => call.step === 'smoke')!.args.includes('--llm'));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
  it('When build is skipped without existing assets Then fails before any remote commands', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ps-missing-build-'));
    const calls: string[] = [];
    try {
      await assert.rejects(deploy(['--skip-secrets', '--skip-build'], { cwd, print: () => {}, execute: step => {
        calls.push(step); return '';
      } }), /build:.*dist\/index\.html/);
      assert.deepEqual(calls, []);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('Given release orchestration with a fake executor', () => {
  it('When dry-running Then performs only local read commands and prints the complete plan', async () => {
    const calls: string[][] = [];
    const lines: string[] = [];
    await release(['4.3.2', '--dry-run'], { print: line => lines.push(line), execute: (_step, program, args) => {
      calls.push([program, ...args]);
      if (args[0] === 'symbolic-ref') return 'main\n';
      if (args[0] === 'rev-parse') return 'abc123\n';
      return '?? docs/retro/\0';
    } });
    assert.ok(calls.every(([program, verb]) => program === 'git' && ['symbolic-ref', 'rev-parse', 'status'].includes(verb!)));
    assert.ok(lines.some(line => line.includes('WARN untracked')));
    assert.ok(lines.some(line => line.includes('git push --atomic origin main 4.3.2')));
  });

  it('When tracked changes exist Then stops before validation or creating a tag', async () => {
    const calls: string[] = [];
    await assert.rejects(release(['4.3.2'], { print: () => {}, execute: (step) => {
      calls.push(step);
      return step === 'worktree' ? ' M package.json\0' : 'main';
    } }), /worktree:/);
    assert.ok(!calls.includes('test'));
    assert.ok(!calls.includes('tag'));
  });

  it('When validation fails Then never tags or pushes', async () => {
    const calls: string[] = [];
    await assert.rejects(release(['4.3.2'], { print: () => {}, execute: (step) => {
      calls.push(step);
      if (step === 'typecheck') throw new Error('typecheck: command failed');
      return step === 'worktree' ? '' : 'main';
    } }), /typecheck:/);
    assert.ok(!calls.includes('tag'));
    assert.ok(!calls.includes('push'));
  });
});

describe('Given deployment orchestration with fake credentials and commands', () => {
  for (const failUpload of [false, true]) {
    it(`When secret upload ${failUpload ? 'fails' : 'succeeds'} Then sends only allowlisted secrets through stdin without a file`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ps-deploy-test-'));
      let secretInput = '';
      const calls: string[] = [];
      const printed: string[] = [];
      try {
        writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=fake-private-value\nOPENAI_MODEL=test-model\nDISCORD_WEBHOOK_URL=excluded\nLOG_LEVEL=\n');
        const action = deploy([], { cwd, print: line => printed.push(line), execute: (step, _program, args, options) => {
          calls.push(step);
          if (step === 'secrets') {
            assert.equal(args.at(-1), 'bulk');
            secretInput = options!.input!;
            assert.deepEqual(JSON.parse(secretInput), { OPENAI_API_KEY: 'fake-private-value', OPENAI_MODEL: 'test-model' });
            if (failUpload) throw new Error('secrets: command failed');
          }
          return step === 'secret-list' ? '[]' : step === 'deploy' ? deployment : '';
        } });
        if (failUpload) await assert.rejects(action, /secrets failed; secrets=unknown/);
        else await action;
        assert.ok(secretInput);
        assert.deepEqual((await import('node:fs')).readdirSync(cwd), ['.env']);
        assert.equal(calls.includes('smoke'), !failUpload);
        assert.equal(calls.includes('deploy'), !failUpload);
        assert.ok(!printed.join('').includes('fake-private-value'));
        assert.ok(!printed.join('').includes('excluded'));
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }

  it('When dry-running or skipping secrets Then performs no secret upload', async () => {
    const calls: string[] = [];
    const execute = (step: string) => { calls.push(step); return step === 'deploy' ? deployment : ''; };
    await deploy(['--dry-run'], { execute, print: () => {} });
    assert.deepEqual(calls, []);
    await deploy(['--skip-secrets'], { execute, print: () => {} });
    assert.deepEqual(calls, ['build', 'deploy', 'smoke']);
  });
});


describe('Given release atomicity and validation boundaries', () => {
  it('When push fails Then uses atomic push and removes its local tag', async () => {
    const calls: string[][] = [];
    await assert.rejects(release(['9.9.9'], { print: () => {}, execute: (step, _program, args) => {
      calls.push(args);
      if (step === 'branch') return 'main';
      if (step === 'head') return 'abc123';
      if (step === 'push') throw new Error('push: fake failure');
      return '';
    } }), /push:.*local tag removed/);
    assert.ok(calls.some(args => args.join(' ') === 'push --atomic origin main 9.9.9'));
    assert.ok(calls.some(args => args.join(' ') === 'tag -d 9.9.9'));
  });

  it('When untracked source exists Then fails before running validation even during dry-run', async () => {
    const calls: string[] = [];
    await assert.rejects(release(['9.9.9', '--dry-run'], { print: () => {}, execute: step => {
      calls.push(step);
      return step === 'worktree' ? '?? src/untracked.ts\0' : 'main';
    } }), /worktree:/);
    assert.ok(!calls.includes('test'));
  });
});

describe('Given partially applied deployment state', () => {
  for (const failedStep of ['deploy', 'deploy-parse', 'smoke']) {
    it(`When ${failedStep} fails Then reports applied secrets and deployed state`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ps-deploy-state-'));
      const printed: string[] = [];
      try {
        writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=FAKE_SECRET');
        await assert.rejects(deploy([], { cwd, print: line => printed.push(line), execute: step => {
          if (step === failedStep) throw new Error('fake failure');
          if (step === 'secret-list') return '[{"name":"OPENAI_BASE_URL"},{"name":"DISCORD_WEBHOOK_URL"}]';
          if (step === 'deploy') return failedStep === 'deploy-parse' ? 'unparseable' : deployment;
          return '';
        } }), error => {
          assert.match(String(error), /secrets=uploaded/);
          assert.match(String(error), failedStep === 'deploy' ? /deployment=unknown/ : /deployment=completed/);
          assert.match(String(error), /no automatic rollback/);
          return true;
        });
        assert.ok(printed.some(line => line.includes('OPENAI_BASE_URL') && line.includes('preserved')));
        assert.ok(!printed.join('').includes('DISCORD_WEBHOOK_URL'));
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }
});

describe('Given the first deployment of a missing Worker', () => {
  for (const reason of ['missing', 'unauthorized', 'network', 'invalid-list']) {
    it(`When secret-list reports ${reason} Then continues only for a missing Worker`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ps-bootstrap-'));
      const calls: string[] = [];
      const printed: string[] = [];
      try {
        writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=FAKE_BOOTSTRAP_KEY');
        const action = deploy([], { cwd, print: line => printed.push(line), execute: step => {
          calls.push(step);
          if (step === 'secret-list') {
            if (reason === 'invalid-list') return 'invalid JSON';
            throw Object.assign(new Error('private diagnostic'), { code: reason === 'missing' ? 'WORKER_NOT_FOUND' : reason });
          }
          return step === 'deploy' ? deployment : '';
        } });
        if (reason === 'missing') {
          await action;
          assert.deepEqual(calls, ['build', 'secret-list', 'secrets', 'deploy', 'smoke']);
          assert.ok(printed.some(line => /WARN.*Worker.*not found.*comparison skipped/i.test(line)));
        } else {
          await assert.rejects(action, /secret-list failed; secrets=unchanged; deployment=not-started/);
          assert.deepEqual(calls, ['build', 'secret-list']);
        }
        assert.ok(!printed.join('').includes('FAKE_BOOTSTRAP_KEY'));
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }
});
