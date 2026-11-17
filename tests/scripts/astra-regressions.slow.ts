// Regression versions of Astra's probes: assert the defects are absent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');

describe('Given Astra subprocess reproductions', () => {
  it('When deployment receives SIGTERM during secret upload Then leaves no secret file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sol-astra-signal-'));
    try {
      writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=FAKE_SIGNAL_SECRET\n');
      const code = `import {deploy} from ${JSON.stringify(join(root, 'scripts/deploy.mjs'))};
        await deploy([], {cwd:${JSON.stringify(cwd)}, print:()=>{}, execute:(step,p,args,options)=>{
          if(step==='secret-list') return '[]';
          if(step==='secrets') {
            if(args.at(-1)!=='bulk'||JSON.parse(options.input).OPENAI_API_KEY!=='FAKE_SIGNAL_SECRET') throw new Error('invalid stdin');
            process.kill(process.pid,'SIGTERM');
            return new Promise(()=>{});
          }
          return '';
        }});`;
      // Isolate TMPDIR so every possible secret file is visible to this assertion.
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        encoding: 'utf8', timeout: 3000, env: { ...process.env, TMPDIR: cwd },
      });
      assert.equal(result.signal, 'SIGTERM', result.stderr);
      assert.deepEqual(readdirSync(cwd), ['.env']);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('When smoke receives fake secret and terminal controls Then prints metadata only', () => {
    const code = `import{smoke}from ${JSON.stringify(join(root, 'scripts/smoke.mjs'))};
      let rows;
      const ok=await smoke(['https://fake.example','--llm'],{fetcher:async()=>new Response('FAKE_ERROR_SECRET\\x1b[31m',{status:502}),table:x=>rows=x});
      console.log(JSON.stringify({ok,rows}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.rows.length, 4);
    assert.ok(output.rows.every((row: { length: number; contentPresent: boolean }) => row.length > 0 && row.contentPresent === false));
    assert.ok(!result.stdout.includes('FAKE_ERROR_SECRET'));
    assert.ok(!result.stdout.includes('\\u001b'));
  });

  it('When help is requested Then documents env requirements, secret preservation, real LLM calls, and store overrides', () => {
    for (const name of ['release', 'deploy', 'smoke']) {
      const result = spawnSync(process.execPath, [`scripts/${name}.mjs`, '--help'], { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 0, result.stderr);
      for (const expected of ['.env', '--skip-secrets', 'LLM', 'PNPM_STORE_DIR']) assert.ok(result.stdout.includes(expected));
    }
  });

  it('When PNPM_STORE_DIR is set Then deployment dry-run uses that store without executing commands', () => {
    const result = spawnSync(process.execPath, ['scripts/deploy.mjs', '--skip-secrets', '--dry-run'], {
      encoding: 'utf8', timeout: 3000, env: { ...process.env, PNPM_STORE_DIR: '/tmp/sol-custom-store' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--config.store-dir=\/tmp\/sol-custom-store/);
  });
});
