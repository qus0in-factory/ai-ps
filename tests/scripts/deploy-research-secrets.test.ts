import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deploy, filterDeploySecrets, mapResearchSecretNames } from '../../scripts/deploy.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Given deployment research secret normalization', () => {
  it('When dotenv uses hyphen names Then maps aliases and uploads Brave without unused NCP secrets', () => {
    const text = 'OPENAI_MODEL=test-model\nBRAVE-SEARCH-API-KEY=fake-brave\nX-NCP-APIGW-API-KEY-ID=fake-id\nX-NCP-APIGW-API-KEY=fake-ncp\nDISCORD_WEBHOOK_URL=private\n';
    assert.deepEqual(mapResearchSecretNames(text), { BRAVE_SEARCH_API_KEY: 'fake-brave', NCP_API_KEY_ID: 'fake-id', NCP_API_KEY: 'fake-ncp' });
    assert.deepEqual(filterDeploySecrets(text), { OPENAI_MODEL: 'test-model', BRAVE_SEARCH_API_KEY: 'fake-brave' });
  });
  it('When canonical names exist Then takes precedence and omits empty or unrelated values', () => {
    assert.deepEqual(filterDeploySecrets('BRAVE_SEARCH_API_KEY=canonical\nBRAVE-SEARCH-API-KEY=alias\nNCP_API_KEY=unused\n'), { BRAVE_SEARCH_API_KEY: 'canonical' });
    assert.deepEqual(filterDeploySecrets('BRAVE-SEARCH-API-KEY=" "\nPATH=private'), {});
  });
  it('When deployment uses fake commands Then passes mapped Brave only through stdin and prints no secret values', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'research-deploy-'));
    const lines: string[] = []; let sent: unknown;
    try {
      writeFileSync(join(cwd, '.env'), 'BRAVE-SEARCH-API-KEY=fake-brave-value\nX-NCP-APIGW-API-KEY=unused-ncp-value\n');
      await deploy([], { cwd, print: line => lines.push(line), execute: (step, _program, _args, options) => {
        if (step === 'secrets') sent = JSON.parse(options!.input!);
        return step === 'secret-list' ? '[]' : step === 'deploy' ? 'https://ai-ps.test.workers.dev\nVersion ID: 12345678-abcd-1234-abcd-123456789abc' : '';
      } });
      assert.deepEqual(sent, { BRAVE_SEARCH_API_KEY: 'fake-brave-value' });
      assert.doesNotMatch(lines.join('\n'), /fake-brave-value|unused-ncp-value|NCP_API_KEY/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
