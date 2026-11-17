import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactFromIntersection, shortStatLabel } from '../../../../src/ui/components/adventure/status-layout.ts';

describe('Given the sentinel under the sticky status panel', () => {
  it('When the sentinel scrolls out of view Then the panel becomes compact', () => {
    assert.equal(compactFromIntersection({ isIntersecting: false }), true);
  });
  it('When the sentinel is visible Then the full panel is shown', () => {
    assert.equal(compactFromIntersection({ isIntersecting: true }), false);
  });
});

describe('Given compact stat labels', () => {
  it('When a stat is shown in one line Then it uses the short Korean label', () => {
    assert.equal(shortStatLabel('health'), '체');
    assert.equal(shortStatLabel('warmth'), '온');
    assert.equal(shortStatLabel('focus'), '집');
  });
});
