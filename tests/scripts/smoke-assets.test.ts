import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { smoke } from '../../scripts/smoke.mjs';
import { mergeSmokePaths } from '../../scripts/lib/release-tools.mjs';

const bytes = new TextEncoder().encode('PRIVATE_ASSET_BYTES');
const noDelay = () => {};

describe('Given smoke routes from OG metadata', () => {
  it('When feature paths repeat or only use route Then merges them with home/chat', async () => {
    assert.deepEqual(mergeSmokePaths([{ route: '/talk' }, { route: '/adventure' }, { route: '/chat' }, { route: '/talk' }]), ['/', '/chat', '/talk', '/adventure']);
    assert.deepEqual(mergeSmokePaths([]), ['/', '/chat']);
    assert.throws(() => mergeSmokePaths([{ route: '//private.example' }]));
    const legacyFeature = { route: '/legacy', path: '/ignored' };
    assert.deepEqual(mergeSmokePaths([legacyFeature]), ['/', '/chat', '/legacy']);
    const paths: string[] = [];
    assert.equal(await smoke(['https://fake.example'], { fetcher: async url => {
      paths.push(new URL(String(url)).pathname); return new Response('<html>page</html>');
    }, table: () => {} }), true);
    assert.deepEqual(paths, ['/', '/chat', '/adventure', '/queens', '/research', '/talk', '/stats']);
  });
  it('When metadata happens to include the chat API Then never enables a paid POST without --llm', async () => {
    for (const llm of [false, true]) {
      const methods: string[] = [];
      await smoke(['https://fake.example', ...(llm ? ['--llm'] : [])], { features: [{ route: '/api/chat' }], table: () => {},
        fetcher: async (url, init) => {
          if (new URL(String(url)).pathname === '/api/chat') methods.push(init!.method!);
          return Response.json({ content: 'fake' });
        } });
      assert.deepEqual(methods, [llm ? 'POST' : 'GET']);
    }
  });
});

describe('Given tracked public assets', () => {
  it('When remote bytes match, differ or return 404 Then reports PASS/MISMATCH/HTTP without hashes or bodies', async () => {
    const tables: unknown[][] = [];
    const ok = await smoke(['https://fake.example', '--assets'], {
      cwd: '/fake-repo', features: [], table: rows => tables.push(rows), delay: noDelay,
      execute: (step: string, program: string, args: string[]) => {
        assert.equal(step, 'assets'); assert.equal(program, 'git');
        assert.deepEqual(args, ['ls-files', '-z', '--', 'public/']);
        return 'public/talk/same.png\0public/talk/different.png\0public/talk/missing.png\0';
      },
      readAsset: () => bytes,
      fetcher: async url => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('different.png')) return new Response('DIFFERENT_BYTES');
        if (path.endsWith('missing.png')) return new Response(bytes, { status: 404 });
        return new Response(bytes);
      },
    });
    assert.equal(ok, false);
    assert.deepEqual(tables[1], [
      { path: '/talk/same.png', status: 200, result: 'PASS' },
      { path: '/talk/different.png', status: 200, result: 'MISMATCH' },
      { path: '/talk/missing.png', status: 404, result: 'HTTP' },
    ]);
    assert.doesNotMatch(JSON.stringify(tables), /PRIVATE_ASSET_BYTES|DIFFERENT_BYTES|sha256|hash/);
  });
  it('When asset calls are counted Then PASS is fetched once and persistent failures twice', async () => {
    const tables: unknown[][] = [], calls: Record<string, number> = {}, delays: number[] = [];
    const files = ['ok.png', 'mismatch.png', 'http.png', 'error.png'];
    let errorReads = 0;
    assert.equal(await smoke(['https://fake.example', '--assets'], {
      features: [], table: rows => tables.push(rows), delay: ms => { delays.push(ms); },
      execute: () => files.map(file => `public/${file}\0`).join(''),
      readAsset: path => { if (path.endsWith('error.png')) { errorReads++; throw Error('private read failure'); } return bytes; },
      fetcher: async url => {
        const pathname = new URL(String(url)).pathname;
        if (!files.some(file => pathname.endsWith(file))) return new Response('<html>page</html>');
        calls[pathname] = (calls[pathname] ?? 0) + 1;
        if (pathname.endsWith('http.png')) return new Response(bytes, { status: 502 });
        if (pathname.endsWith('mismatch.png')) return new Response('OTHER');
        return new Response(bytes);
      },
    }), false);
    assert.deepEqual(files.map(file => calls['/' + file] ?? 0), [1, 2, 2, 0]);
    assert.equal(errorReads, 2); // ERROR occurs before fetch; both attempts re-read the local file.
    assert.deepEqual(delays, [5000, 5000, 5000]);
    assert.deepEqual((tables[1] as { path: string; result: string }[]).map(row => row.result),
      ['PASS', 'MISMATCH', 'HTTP', 'ERROR']);
  });
  it('When the origin redirects Then reports HTTP, not PASS', async () => {
    const tables: unknown[][] = [];
    assert.equal(await smoke(['https://fake.example', '--assets'], {
      features: [], table: rows => tables.push(rows), delay: noDelay,
      execute: () => 'public/old.html\0', readAsset: () => bytes,
      fetcher: async () => new Response(null, { status: 307, headers: { location: '/new' } }),
    }), false);
    assert.deepEqual(tables[1], [{ path: '/old.html', status: 307, result: 'HTTP' }]);
  });
  it('When a non-PASS row turns PASS on the second attempt Then retries once and passes', async () => {
    const tables: unknown[][] = [], delays: number[] = [], fetches: string[] = [];
    assert.equal(await smoke(['https://fake.example', '--assets'], {
      features: [], table: rows => tables.push(rows), delay: ms => { delays.push(ms); },
      execute: () => 'public/flaky.png\0', readAsset: () => bytes,
      fetcher: async url => {
        const pathname = new URL(String(url)).pathname;
        if (!pathname.endsWith('flaky.png')) return new Response('<html>page</html>');
        fetches.push(pathname);
        return new Response(fetches.length === 1 ? 'OLD' : bytes);
      },
    }), true);
    assert.equal(fetches.length, 2);
    assert.deepEqual(delays, [5000]);
    assert.deepEqual(tables[1], [{ path: '/flaky.png', status: 200, result: 'PASS' }]);
  });
  it('When every tracked file is compared Then URL-encodes filenames and applies no 50-file limit', async () => {
    const paths: string[] = [];
    const warnings: string[] = [];
    assert.equal(await smoke(['https://fake.example', '--assets'], {
      features: [], table: () => {}, print: line => warnings.push(line), delay: noDelay, readAsset: () => bytes,
      execute: () => Array.from({ length: 51 }, (_, i) => `public/${i}.png\0`).join('') + 'public/顔 #.png\0',
      fetcher: async url => { paths.push(new URL(String(url)).pathname); return new Response(bytes); },
    }), true);
    assert.equal(paths.filter(path => path.endsWith('.png')).length, 52);
    assert.ok(paths.includes('/%E9%A1%94%20%23.png'));
    assert.deepEqual(warnings, []);
  });
  it('When no public files are tracked Then prints the empty message', async () => {
    const warnings: string[] = [], tables: unknown[][] = [], paths: string[] = [];
    assert.equal(await smoke(['https://fake.example', '--assets'], {
      features: [], table: rows => tables.push(rows), print: line => warnings.push(line), delay: noDelay,
      execute: () => '',
      fetcher: async url => { paths.push(new URL(String(url)).pathname); return new Response('<html>page</html>'); },
    }), true);
    assert.deepEqual(tables.length, 1);
    assert.deepEqual(paths, ['/', '/chat']);
    assert.deepEqual(warnings, ['assets: no tracked public assets']);
  });
  it('When dry-running or local bytes are unreadable Then plans only or fails without fetching', async () => {
    const tables: unknown[][] = [];
    const options = { features: [], table: (rows: unknown[]) => tables.push(rows), delay: noDelay,
      execute: () => 'public/talk/a.png\0', readAsset: (): never => { throw Error('private local failure'); },
      fetcher: async (): Promise<Response> => assert.fail('must not fetch') };
    assert.equal(await smoke(['https://fake.example', '--assets', '--dry-run'], options), true);
    assert.equal((tables[1]![0] as { result: string }).result, 'PLAN');
    tables.length = 0;
    assert.equal(await smoke(['https://fake.example', '--assets'], { ...options, fetcher: async () => new Response('page') }), false);
    assert.deepEqual(tables[1], [{ path: '/talk/a.png', status: '-', result: 'ERROR' }]);
    await assert.rejects(smoke(['https://fake.example', '--assets', '5.2.0'], options), /usage/);
  });
});
