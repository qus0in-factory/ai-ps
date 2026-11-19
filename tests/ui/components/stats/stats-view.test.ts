import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCosts, errorRate, formatMs, formatUsd, serviceLabel } from '../../../../src/ui/pages/stats-view.ts';
import type { UsageStats } from '../../../../src/domain/usage.ts';

const stats: UsageStats = {
  days: 3,
  totals: { calls: 5, errors: 1, costUsd: 0.03 },
  byService: [],
  byDay: [
    { day: '2026-11-17', service: 'openai', calls: 2, costUsd: 0.01 },
    { day: '2026-11-17', service: 'brave', calls: 1, costUsd: 0.005 },
    { day: '2026-11-19', service: 'openai', calls: 2, costUsd: 0.015 },
  ],
};

describe('Given stats view helpers', () => {
  it('When building daily costs Then fills every UTC day of the window with zeros and sums services', () => {
    const days = dailyCosts(stats, new Date('2026-11-19T23:30:00Z'));
    assert.deepEqual(days.map((d) => d.day), ['2026-11-17', '2026-11-18', '2026-11-19']);
    assert.deepEqual(days.map((d) => Number(d.costUsd.toFixed(3))), [0.015, 0, 0.015]);
  });

  it('When formatting Then error rate, usd, ms and service labels are readable', () => {
    assert.equal(errorRate(0, 0), '0%');
    assert.equal(errorRate(8, 1), '12.5%');
    assert.equal(errorRate(3, 3), '100%');
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(0.0123), '$0.0123');
    assert.equal(formatUsd(12.3456), '$12.35');
    assert.equal(formatMs(420.6), '421ms');
    assert.equal(formatMs(1500), '1.5s');
    assert.equal(serviceLabel('ncp'), 'NAVER');
    assert.equal(serviceLabel('openai'), 'OpenAI');
    assert.equal(serviceLabel('brave'), 'Brave');
  });
});
