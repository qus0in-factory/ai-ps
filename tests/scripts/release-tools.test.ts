import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterAppSecrets, parseDeployment, judgeSmoke, classifyWorktree } from '../../scripts/lib/release-tools.mjs';

describe('Given deployment environment text', () => {
  it('When filtering Then includes only nonempty app keys without expanding shell expressions', () => {
    const result = filterAppSecrets(`OPENAI_API_KEY="fake-key"\nexport OPENAI_MODEL='model=one'\nOWM_API_KEY=\nOPENAI_BASE_URL="  "\nLOG_LEVEL=warn # comment\nDISCORD_WEBHOOK_URL=private\nPATH=private\nOPENAI_TOOL_MODE='$(touch /tmp/not-run)'`);
    assert.deepEqual(result, { OPENAI_API_KEY: 'fake-key', OPENAI_MODEL: 'model=one', LOG_LEVEL: 'warn', OPENAI_TOOL_MODE: '$(touch /tmp/not-run)' });
  });
});

describe('Given Wrangler deployment output', () => {
  it('When a deployment finishes Then extracts only the workers.dev URL and version ID', () => {
    assert.deepEqual(parseDeployment('\u001b[32mDeployed ai-ps\u001b[0m\n  https://ai-ps.qus0in.workers.dev\nCurrent Version ID: 12345678-abcd-1234-abcd-123456789abc'), {
      url: 'https://ai-ps.qus0in.workers.dev', versionId: '12345678-abcd-1234-abcd-123456789abc',
    });
    assert.deepEqual(parseDeployment('Deployed ai-ps triggers\n  https://ai-ps.qus0in.workers.dev\n  aips.qus0in.dev (custom domain)\nCurrent Version ID: 12345678-abcd-1234-abcd-123456789abc'), {
      url: 'https://ai-ps.qus0in.workers.dev', versionId: '12345678-abcd-1234-abcd-123456789abc',
    });
    assert.deepEqual(parseDeployment('Deployed ai-ps triggers\n  aips.qus0in.dev (custom domain)\nCurrent Version ID: 12345678-abcd-1234-abcd-123456789abc'), {
      url: 'https://aips.qus0in.dev', versionId: '12345678-abcd-1234-abcd-123456789abc',
    });
    assert.equal(parseDeployment('https://example.com\nVersion ID: none'), null);
    assert.equal(parseDeployment('https://ai-ps.test.workers.dev.evil.example\nCurrent Version ID: 12345678-abcd-1234-abcd-123456789abc'), null);
  });
});

describe('Given smoke responses', () => {
  it('When checking pages and chat Then requires successful JSON content for chat and emits metadata without response text', () => {
    assert.equal(judgeSmoke('/', 200, 'text/html', 'a'.repeat(200)).ok, true);
    assert.equal(judgeSmoke('/', 500, 'text/html', '').ok, false);
    assert.equal(judgeSmoke('/api/chat', 200, 'application/json; charset=utf-8', '{"content":"안녕"}').ok, true);
    for (const body of ['{}', 'null', '{"content":4}', 'not JSON']) {
      assert.equal(judgeSmoke('/api/chat', 200, 'application/json', body).ok, false);
    }
    assert.equal(judgeSmoke('/api/chat', 200, 'text/html', '{"content":"hello"}').ok, false);
    assert.equal(judgeSmoke('/api/chat', 502, 'application/json', '{"content":"hello"}').ok, false);
    const summary = judgeSmoke('/api/chat', 502, 'application/json', '{"content":"FAKE_SECRET\\u001b[31m"}');
    assert.equal(summary.contentPresent, true);
    assert.ok(summary.length > 0);
    assert.ok(!JSON.stringify(summary).includes('FAKE_SECRET'));
    assert.ok(!JSON.stringify(summary).includes('preview'));
  });
});

describe('Given git porcelain worktree status', () => {
  it('When tracked changes and untracked retros coexist Then blocks tracked changes but only warns about untracked files', () => {
    assert.deepEqual(classifyWorktree('?? docs/retro/\0 M package.json\0'), { dirty: ['package.json'], untracked: ['docs/retro/'] });
    assert.deepEqual(classifyWorktree('?? docs/retro/\0'), { dirty: [], untracked: ['docs/retro/'] });
    assert.deepEqual(classifyWorktree('R  new.txt\0old.txt\0'), { dirty: ['new.txt'], untracked: [] });
  });
});
