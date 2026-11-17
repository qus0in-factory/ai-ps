import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { command } from '../../scripts/lib/command.mjs';

describe('Given subprocess security and deadlines', () => {
  it('When parent Wrangler logging is unsafe Then forces sanitization and disables disk logs', async t => {
    const previousSanitize = process.env.WRANGLER_LOG_SANITIZE;
    const previousLogs = process.env.WRANGLER_WRITE_LOGS;
    process.env.WRANGLER_LOG_SANITIZE = 'false';
    process.env.WRANGLER_WRITE_LOGS = 'true';
    t.after(() => {
      if (previousSanitize === undefined) delete process.env.WRANGLER_LOG_SANITIZE;
      else process.env.WRANGLER_LOG_SANITIZE = previousSanitize;
      if (previousLogs === undefined) delete process.env.WRANGLER_WRITE_LOGS;
      else process.env.WRANGLER_WRITE_LOGS = previousLogs;
    });
    const output = await command('env', process.execPath, ['-e', 'console.log(JSON.stringify([process.env.WRANGLER_LOG_SANITIZE,process.env.WRANGLER_WRITE_LOGS]))']);
    assert.deepEqual(JSON.parse(output), ['true', 'false']);
  });

  it('When a child ignores SIGTERM Then the configured hard deadline kills it', { timeout: 5000 }, async () => {
    const started = Date.now();
    await assert.rejects(command('test', process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { timeoutMs: 150 }), /deadline/);
    assert.ok(Date.now() - started < 3000);
  });

  it('When stdin contains secrets Then delivers it without adding it to process arguments or output', async () => {
    const output = await command('test', process.execPath, ['-e', 'let data="";process.stdin.on("data",b=>data+=b);process.stdin.on("end",()=>console.log(JSON.stringify({keys:Object.keys(JSON.parse(data)),args:process.argv.slice(1)})))'], { input: '{"OPENAI_API_KEY":"FAKE_PRIVATE"}' });
    assert.deepEqual(JSON.parse(output), { keys: ['OPENAI_API_KEY'], args: [] });
  });
});

describe('Given Wrangler secret-list diagnostics', () => {
  for (const [diagnostic, expected] of [
    ['✘ [ERROR] Worker "ai-ps" not found.\nIf this is a new Worker, run `wrangler deploy` first.', 'WORKER_NOT_FOUND'],
    ['Worker not found', 'WORKER_NOT_FOUND'],
    ['Authentication failed (401)', undefined],
    ['Permission denied (403)', undefined],
    ['fetch failed', undefined],
    ['Resource not found (404)', undefined],
  ] as const) {
    it(`When secret-list fails with ${diagnostic.split('\n')[0]} Then preserves only its safe classification`, async () => {
      await assert.rejects(command('secret-list', process.execPath, ['-e', `console.error(${JSON.stringify(diagnostic)});process.exitCode=1;`]), error => {
        assert.equal((error as Error & { code?: string }).code, expected);
        assert.ok(!String(error).includes(diagnostic));
        return true;
      });
    });
  }
});
