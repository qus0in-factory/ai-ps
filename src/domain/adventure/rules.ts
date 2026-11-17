import { SHIP_DAY, type GameState, type TurnOutcome, type AppliedChanges } from './types.ts';
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const supplies = { lens: 'spare-lens', clockwork: 'clock-spring', oil: 'lamp-oil' } as const;
export function applyTurn(state: GameState, outcome: TurnOutcome): { state: GameState; applied: AppliedChanges } {
  const next = structuredClone(state);
  const applied: AppliedChanges = { stats: { health: 0, warmth: 0, focus: 0 }, added: [], removed: [], repaired: [], slept: false };
  if (state.ending) return { state: next, applied };
  next.stats.warmth -= state.weather === 'storm' && state.time === 'night' ? 12 : 6;
  next.stats.focus -= 4;
  for (const stat of ['health','warmth','focus'] as const) {
    const raw = outcome.statChanges[stat] ?? 0;
    const delta = Number.isInteger(raw) && Number.isFinite(raw) ? Math.max(-40, Math.min(40, raw)) : 0;
    next.stats[stat] = clamp(next.stats[stat] + delta);
  }
  if (next.stats.warmth === 0) next.stats.health -= 10;
  if (next.stats.focus === 0) next.stats.health -= 5;
  next.stats.health = clamp(next.stats.health);
  for (const part of new Set(outcome.repaired ?? [])) {
    if (next.repairs[part] || state.location !== 'lantern-room' || state.stats.focus === 0 || next.stats.focus === 0 || !state.inventory.includes(supplies[part])) continue;
    next.repairs[part] = true; applied.repaired.push(part);
    next.inventory = next.inventory.filter(id => id !== supplies[part]); applied.removed.push(supplies[part]);
  }
  for (const id of outcome.removeItems) if (next.inventory.includes(id)) { next.inventory = next.inventory.filter(item => item !== id); applied.removed.push(id); }
  for (const id of outcome.addItems) if (!next.inventory.includes(id) && next.inventory.length < 12) { next.inventory.push(id); applied.added.push(id); }
  if (outcome.location && outcome.location !== next.location) { next.location = outcome.location; applied.moved = outcome.location; }
  if (outcome.day !== undefined) next.day = Math.max(1, Math.min(SHIP_DAY + 1, outcome.day));
  if (outcome.time) next.time = outcome.time;
  if (outcome.weather) next.weather = outcome.weather;
  if (next.stats.health === 0) next.ending = 'dead';
  if (outcome.sleep && !next.ending) {
    next.day = outcome.day ?? Math.min(SHIP_DAY + 1, state.day + 1);
    next.time = outcome.time ?? 'dawn';
    next.stats.health = clamp(next.stats.health + 15); next.stats.focus = clamp(next.stats.focus + 40); applied.slept = true;
  }
  if (!next.ending && outcome.lampLit && next.day <= SHIP_DAY && next.location === 'lantern-room' && Object.values(next.repairs).every(Boolean)) next.ending = 'cleared';
  if (!next.ending && next.day > SHIP_DAY) next.ending = 'missed';
  for (const stat of ['health','warmth','focus'] as const) applied.stats[stat] = next.stats[stat] - state.stats[stat];
  return { state: next, applied };
}
