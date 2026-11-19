import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deploy, filterDeploySecrets, mapResearchSecretNames } from '../../scripts/deploy.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Given deployment research secret normalization', () => {
  it('When dotenv uses hyphen names Then maps Brave and the verified NCP search credentials', () => {
    const text = 'OPENAI_MODEL=test-model\nBRAVE-SEARCH-API-KEY=fake-brave\nX-NCP-APIGW-API-KEY-ID=fake-id\nX-NCP-APIGW-API-KEY=fake-ncp\nDISCORD_WEBHOOK_URL=private\n';
    assert.deepEqual(mapResearchSecretNames(text), { BRAVE_SEARCH_API_KEY: 'fake-brave', NCP_API_KEY_ID: 'fake-id', NCP_API_KEY: 'fake-ncp' });
    assert.deepEqual(filterDeploySecrets(text), { OPENAI_MODEL: 'test-model', BRAVE_SEARCH_API_KEY: 'fake-brave', NCP_API_KEY_ID: 'fake-id', NCP_API_KEY: 'fake-ncp' });
  });
  it('When canonical names exist Then takes precedence and omits empty or unrelated values', () => {
    assert.deepEqual(filterDeploySecrets('BRAVE_SEARCH_API_KEY=canonical\nBRAVE-SEARCH-API-KEY=alias\nNCP_API_KEY=canonical-ncp\nX-NCP-APIGW-API-KEY=alias-ncp\n'), { BRAVE_SEARCH_API_KEY: 'canonical', NCP_API_KEY: 'canonical-ncp' });
    assert.deepEqual(filterDeploySecrets('BRAVE-SEARCH-API-KEY=" "\nPATH=private'), {});
  });
  it('When deployment uses fake commands Then passes mapped search credentials only through stdin and prints no values', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'research-deploy-'));
    const lines: string[] = []; let sent: unknown;
    try {
      writeFileSync(join(cwd, '.env'), 'BRAVE-SEARCH-API-KEY=fake-brave-value\nX-NCP-APIGW-API-KEY-ID=fake-ncp-id\nX-NCP-APIGW-API-KEY=fake-ncp-value\n');
      await deploy([], { cwd, print: line => lines.push(line), execute: (step, _program, _args, options) => {
        if (step === 'secrets') sent = JSON.parse(options!.input!);
        return step === 'secret-list' ? '[]' : step === 'deploy' ? 'https://ai-ps.test.workers.dev\nVersion ID: 12345678-abcd-1234-abcd-123456789abc' : '';
      } });
      assert.deepEqual(sent, { BRAVE_SEARCH_API_KEY: 'fake-brave-value', NCP_API_KEY_ID: 'fake-ncp-id', NCP_API_KEY: 'fake-ncp-value' });
      assert.doesNotMatch(lines.join('\n'), /fake-brave-value|fake-ncp-id|fake-ncp-value/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
