import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ogBlock, replaceOgBlock } from '../../scripts/og.mjs';

describe('Given OG metadata generation', () => {
  const config = {
    site: {
      metaDescription: 'meta "desc"',
      ogTitle: 'title',
      ogDescription: 'og desc',
      imageAlt: 'alt',
    },
    background: '#0B1026',
    image: { width: 1200, height: 630, type: 'image/png' },
    features: [],
  };

  it('When building the block Then escapes attributes and includes markers', () => {
    const block = ogBlock(config);
    assert.match(block, /<!-- og:start -->/);
    assert.match(block, /<!-- og:end -->/);
    assert.match(block, /content="meta &quot;desc&quot;"/);
    assert.match(block, /content="title"/);
  });

  it('When replacing a marker block Then preserves surrounding lines', () => {
    const html = 'before\n<!-- og:start -->\nold\n<!-- og:end -->\nafter';
    const result = replaceOgBlock(html, 'NEW');
    assert.equal(result, 'before\nNEW\nafter');
  });

  it('When markers are missing Then throws', () => {
    assert.throws(() => replaceOgBlock('no markers', 'NEW'));
  });
});
