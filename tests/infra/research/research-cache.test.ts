import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createKvJsonCache } from '../../../src/infra/kv-cache.ts';
import { createCachedReader, createCachedSearch } from '../../../src/infra/research-cache.ts';
import { createResearchWebReader } from '../../../src/infra/research-web-reader.ts';
import type { ResearchSearchProvider } from '../../../src/infra/research-merged-search.ts';

const entry = 'https://entry.example.com/';
const middle = 'https://middle.example.com/';
const destination = 'https://destination.example.com/';
const entryHost = new URL(entry).hostname;
const middleHost = new URL(middle).hostname;
const destinationHost = new URL(destination).hostname;
const page = { url: destination, title: '', content: 'Public article' };

function memoryCache(prefix: string, ttlSeconds: number) {
  const entries = new Map<string, string>();
  const writes: { key: string; ttl?: number }[] = [];
  const cache = createKvJsonCache({
    async get(key) {
      const value = entries.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key, value, options) {
      entries.set(key, value);
      writes.push({ key, ttl: options?.expirationTtl });
    },
  }, { prefix, ttlSeconds });
  return { cache, entries, writes };
}

function redirectReader(cache: ReturnType<typeof createKvJsonCache>, fetches: string[]) {
  const fetcher: typeof fetch = async input => {
    fetches.push(String(input));
    if (input === entry) return Response.redirect(middle);
    if (input === middle) return Response.redirect(destination);
    assert.equal(input, destination);
    return new Response(page.content);
  };
  return (hosts: string[]) => {
    const allowedHosts = new Set(hosts);
    const reader = createResearchWebReader({ allowedHosts, allowIpLiterals: false,
      fetcher, lookup: async () => ['93.184.216.34'] });
    return createCachedReader(reader, cache, { allowedHosts }).read(entry);
  };
}

describe('Given a shared page cache and request-specific redirect allowlists', () => {
  it('When the complete redirect chain is allowed Then reuses the page for the same host policy', async () => {
    const { cache, writes } = memoryCache('rp/v1/', 86_400);
    const fetches: string[] = [];
    const read = redirectReader(cache, fetches);

    assert.deepEqual(await read([entryHost, middleHost, destinationHost]), { ok: true, value: page });
    assert.deepEqual(await read([destinationHost, entryHost, middleHost]), { ok: true, value: page });
    assert.deepEqual(fetches, [entry, middle, destination]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.ttl, 86_400);
    assert.match(writes[0]!.key, /^rp\/v1\/[a-f\d]{64}$/);
  });

  it('When any intermediate or final redirect host is no longer allowed Then the cache leaves the decision to the reader', async () => {
    const { cache, writes } = memoryCache('rp/v1/', 86_400);
    const fetches: string[] = [];
    const read = redirectReader(cache, fetches);

    assert.equal((await read([entryHost, middleHost, destinationHost])).ok, true);
    fetches.length = 0;
    assert.equal((await read([entryHost, destinationHost])).ok, false);
    assert.deepEqual(fetches, [entry]);
    fetches.length = 0;
    assert.equal((await read([entryHost, middleHost])).ok, false);
    assert.deepEqual(fetches, [entry, middle]);
    assert.equal(writes.length, 1);
  });

  it('When a URL-only entry from the previous cache format exists Then reads the page with the current policy', async () => {
    const { cache, entries } = memoryCache('rp/v1/', 86_400);
    const oldKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry));
    entries.set(`rp/v1/${Buffer.from(oldKey).toString('hex')}`, JSON.stringify(page));
    const denied = { ok: false, reason: 'Host not permitted' } as const;
    const reader = { read: async () => denied };
    const allowedHosts = new Set([entryHost, destinationHost]);

    assert.deepEqual(await createCachedReader(reader, cache, { allowedHosts }).read(entry), denied);
  });

  it('When the host policy changes during a read Then does not cache the result under the earlier policy', async () => {
    const { cache, writes } = memoryCache('rp/v1/', 86_400);
    const allowedHosts = new Set([entryHost, destinationHost]);
    const reader = { async read() {
      allowedHosts.add(middleHost);
      return { ok: true, value: page } as const;
    } };

    assert.equal((await createCachedReader(reader, cache, { allowedHosts }).read(entry)).ok, true);
    assert.deepEqual(writes, []);
  });
});

describe('Given the search cache', () => {
  const hit = { url: entry, title: 'Park', description: 'Public park' };

  it('When a normalized query and count repeat Then serves a hit without calling the provider', async () => {
    const { cache, writes } = memoryCache('rs/v1/', 21_600);
    let calls = 0;
    const search = createCachedSearch({ async search() { calls++; return { ok: true, value: [hit] }; } }, cache);

    assert.deepEqual(await search.search(' City  Park ', 1), { ok: true, value: [hit] });
    assert.deepEqual(await search.search('city park', 1), { ok: true, value: [hit] });
    assert.equal(calls, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.ttl, 21_600);
    assert.match(writes[0]!.key, /^rs\/v1\/[a-f\d]{64}$/);
    await search.search('city park', 2);
    assert.equal(calls, 2);
    assert.equal(writes[1]?.ttl, 300);
  });

  it('When the provider returns no hits or fails Then does not write a cache entry', async () => {
    const { cache, writes } = memoryCache('rs/v1/', 21_600);
    const outcomes: Awaited<ReturnType<ResearchSearchProvider['search']>>[] = [
      { ok: true, value: [] }, { ok: false, reason: 'Unavailable' },
    ];

    for (const outcome of outcomes) {
      const provider: ResearchSearchProvider = { async search() { return outcome; } };
      assert.deepEqual(await createCachedSearch(provider, cache).search('parks'), outcome);
    }
    assert.deepEqual(writes, []);
  });
});
