import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createKvJsonCache } from '../../src/infra/kv-cache.ts';
import { createCachedSearch } from '../../src/infra/research-cache.ts';

describe('Given a Workers KV JSON cache', () => {
  it('When there is no binding or key Then returns a cache miss', async () => {
    const missing = createKvJsonCache(undefined, { ttlSeconds: 300 });
    assert.equal(await missing.get('key'), null);
    await missing.put('key', { value: true });
    assert.equal(await missing.get('key'), null);

    const cache = createKvJsonCache({
      async get(key, type) {
        assert.equal(key, 'test/key');
        assert.equal(type, 'json');
        return null;
      },
      async put() { assert.fail('A miss must not write to KV'); },
    }, { prefix: 'test/', ttlSeconds: 300 });
    assert.equal(await cache.get('key'), null);
  });

  it('When KV reads and writes fail Then the search returns the live provider result', async () => {
    const calls: string[] = [];
    const cache = createKvJsonCache({
      async get() { calls.push('read'); throw Error('KV unavailable'); },
      async put() { calls.push('write'); throw Error('KV unavailable'); },
    }, { ttlSeconds: 300 });
    const hit = { title: 'Park', url: 'https://example.com/', description: '' };
    const search = createCachedSearch({ async search() {
      calls.push('provider');
      return { ok: true, value: [hit] };
    } }, cache);

    assert.deepEqual(await search.search('park', 1), { ok: true, value: [hit] });
    assert.deepEqual(calls, ['read', 'provider', 'write']);
  });
});
