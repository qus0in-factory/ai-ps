import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { barCells, statusView } from '../../../../src/ui/components/adventure/status-view.ts';
import type { GameState } from '../../../../src/domain/adventure/types.ts';

const base: GameState = {
  day: 2, time: 'day', weather: 'fog', location: 'boathouse',
  stats: { health: 80, warmth: 60, focus: 50 },
  inventory: ['lantern-handheld', 'spare-lens'],
  repairs: { lens: true, clockwork: false, oil: false },
};

describe('Given a stat value mapped to the 8 pixel cells', () => {
  it('When values are typical Then they fill by half-up rounding', () => {
    assert.equal(barCells(90), 7);
    assert.equal(barCells(55), 4);
    assert.equal(barCells(70), 6);
  });
  it('When values are at the edges Then they clamp to 0..8', () => {
    assert.equal(barCells(0), 0);
    assert.equal(barCells(100), 8);
    assert.equal(barCells(-10), 0);
    assert.equal(barCells(130), 8);
  });
});

describe('Given the current game state', () => {
  it('When the stats are comfortable Then the portrait is ok and bars fill proportionally', () => {
    const view = statusView(base);
    assert.equal(view.portrait, 'ok');
    assert.deepEqual(view.bars, { health: 6, warmth: 5, focus: 4 });
  });
  it('When health is 30 or less Then the portrait is hurt', () => {
    assert.equal(statusView({ ...base, stats: { ...base.stats, health: 30 } }).portrait, 'hurt');
  });
  it('When warmth is 25 or focus is 20 Then the portrait is cold', () => {
    assert.equal(statusView({ ...base, stats: { ...base.stats, warmth: 25 } }).portrait, 'cold');
    assert.equal(statusView({ ...base, stats: { ...base.stats, focus: 20 } }).portrait, 'cold');
  });
  it('When rendered Then the Korean labels and remaining days are shown', () => {
    const view = statusView(base);
    assert.equal(view.dayLabel, '2일차');
    assert.equal(view.timeLabel, '낮');
    assert.equal(view.weatherLabel, '안개');
    assert.equal(view.locationLabel, '보트 창고');
    assert.equal(view.shipDaysLeft, 3);
    assert.equal(view.shipLabel, '배 도착까지 3일');
    assert.deepEqual(view.repairs, { lens: true, clockwork: false, oil: false });
  });
  it('When it is the ship day Then the label says tonight instead of 0일', () => {
    const view = statusView({ ...base, day: 5 });
    assert.equal(view.shipDaysLeft, 0);
    assert.equal(view.shipLabel, '배는 오늘 밤');
  });
  it('When the ship day has passed Then the label says it already passed', () => {
    const view = statusView({ ...base, day: 7 });
    assert.equal(view.shipDaysLeft, 0);
    assert.equal(view.shipLabel, '배는 이미 지나감');
  });
  it('When stats are extreme Then bars stay between 0 and 8', () => {
    const view = statusView({ ...base, stats: { health: 0, warmth: 100, focus: 101 } });
    assert.deepEqual(view.bars, { health: 0, warmth: 8, focus: 8 });
  });
});
