import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTE_META, applyRouteMeta, metaFor, type MetaDocument } from '../../src/ui/route-meta.ts';

function fakeDocument(): MetaDocument & { tags: Record<string, { content: string }> } {
  const tags: Record<string, { content: string }> = {
    'meta[name="description"]': { content: '기본 설명' },
    'meta[property="og:title"]': { content: '기본 og 제목' },
    'meta[property="og:description"]': { content: '기본 og 설명' },
  };
  const elements = Object.fromEntries(Object.entries(tags).map(([selector, tag]) => [selector, {
    getAttribute: () => tag.content,
    setAttribute: (_name: string, value: string) => { tag.content = value; },
  }]));
  return { title: 'ai-ps', tags, querySelector: (selector: string) => elements[selector] ?? null };
}

describe('Given the route meta table', () => {
  it('When looking up a route Then returns its title and tolerates a trailing slash', () => {
    assert.equal(metaFor('/stats').title, '사용량 · ai-ps');
    assert.equal(metaFor('/chat/').title, 'Chat · ai-ps');
    assert.equal(metaFor('/').title, 'ai-ps');
  });

  it('When the path is unknown Then falls back to the site title', () => {
    assert.equal(metaFor('/nope').title, 'ai-ps');
  });

  it('When every App route is checked Then each has its own meta entry', () => {
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== '/queen');
    assert.ok(paths.includes('/stats'));
    for (const path of paths) assert.ok(path in ROUTE_META, `${path} missing in ROUTE_META`);
  });

  it('When og.json lists routes Then each exists in the table', () => {
    const og = JSON.parse(readFileSync('scripts/og.json', 'utf8')) as { features: { route: string }[] };
    assert.ok(og.features.some((f) => f.route === '/stats'));
    for (const { route } of og.features) assert.ok(route in ROUTE_META, route);
  });
});

describe('Given a document', () => {
  it('When applying a route Then sets title, description and og tags', () => {
    const doc = fakeDocument();
    applyRouteMeta(doc, '/research');
    assert.equal(doc.title, ROUTE_META['/research']!.title);
    assert.equal(doc.tags['meta[name="description"]']!.content, ROUTE_META['/research']!.description);
    assert.equal(doc.tags['meta[property="og:title"]']!.content, ROUTE_META['/research']!.title);
    assert.equal(doc.tags['meta[property="og:description"]']!.content, ROUTE_META['/research']!.description);
  });

  it('When returning to home Then restores the original description tags', () => {
    const doc = fakeDocument();
    applyRouteMeta(doc, '/talk');
    applyRouteMeta(doc, '/');
    assert.equal(doc.title, 'ai-ps');
    assert.equal(doc.tags['meta[name="description"]']!.content, '기본 설명');
    assert.equal(doc.tags['meta[property="og:title"]']!.content, '기본 og 제목');
    assert.equal(doc.tags['meta[property="og:description"]']!.content, '기본 og 설명');
  });

  it('When tags are missing Then only the title changes without throwing', () => {
    const doc: MetaDocument = { title: '', querySelector: () => null };
    applyRouteMeta(doc, '/chat');
    assert.equal(doc.title, 'Chat · ai-ps');
  });
});
