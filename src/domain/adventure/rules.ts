import { TIMES } from './session.ts';
import { SHIP_DAY, type GameState, type TurnOutcome, type AppliedChanges } from './types.ts';
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const supplies = { lens: 'spare-lens', clockwork: 'clock-spring', oil: 'lamp-oil' } as const;
export function applyTurn(state: GameState, outcome: TurnOutcome, _context: { diceUsed: boolean }): { state: GameState; applied: AppliedChanges } {
  const next = structuredClone(state);
  const applied: AppliedChanges = { stats: { health: 0, warmth: 0, focus: 0 }, added: [], removed: [], repaired: [], rejected: [], slept: false };
  if (state.ending) return { state: next, applied };
  const sleeping = outcome.sleep === true && state.location === 'quarters';
  if (!sleeping) {
    next.stats.warmth -= state.weather === 'storm' && state.time === 'night' ? 12 : 6;
    next.stats.focus -= 4;
  } else if (state.inventory.includes('blanket')) next.stats.warmth += 10;
  for (const stat of ['health','warmth','focus'] as const) {
    const raw = outcome.statChanges[stat] ?? 0;
    const delta = Number.isInteger(raw) && Number.isFinite(raw) ? Math.max(-40, Math.min(40, raw)) : 0;
    if (delta !== raw) applied.rejected.push(`stat:${stat}:clamped`);
    next.stats[stat] = clamp(next.stats[stat] + delta);
  }
  if (next.stats.warmth === 0) next.stats.health -= 10;
  if (next.stats.focus === 0) next.stats.health -= 5;
  next.stats.health = clamp(next.stats.health);
  // Repairs and sleep must be available at the beginning of this action.
  for (const part of new Set(outcome.repaired ?? [])) {
    if (next.repairs[part]) continue;
    const reason = state.location !== 'lantern-room' ? 'repair:not-lantern-room' : state.stats.focus === 0 || next.stats.focus === 0 ? 'repair:no-focus' : !state.inventory.includes(supplies[part]) ? 'repair:no-part' : undefined;
    if (reason) { applied.rejected.push(reason); continue; }
    next.repairs[part] = true; applied.repaired.push(part);
    next.inventory = next.inventory.filter(id => id !== supplies[part]); applied.removed.push(supplies[part]);
  }
  for (const id of outcome.removeItems) if (next.inventory.includes(id)) { next.inventory = next.inventory.filter(item => item !== id); applied.removed.push(id); }
  for (const id of outcome.addItems) if (!next.inventory.includes(id) && next.inventory.length < 12) { next.inventory.push(id); applied.added.push(id); }
  if (outcome.location && outcome.location !== next.location) { next.location = outcome.location; applied.moved = outcome.location; }
  const currentTime = TIMES.indexOf(state.time);
  const requestedTime = outcome.time ? TIMES.indexOf(outcome.time) : currentTime;
  if (requestedTime < currentTime) applied.rejected.push('time:regress');
  const actionCount = (state.timeActions ?? 0) + 1;
  next.timeActions = actionCount % 3;
  next.time = TIMES[Math.max(currentTime, requestedTime, Math.min(3, currentTime + (actionCount >= 3 ? 1 : 0)))]!;
  if (outcome.weather) next.weather = outcome.weather;
  if (next.stats.health === 0) next.ending = 'dead';
  if (outcome.sleep) {
    if (state.location !== 'quarters') applied.rejected.push('sleep:not-quarters');
    else if (!next.ending) { next.day = Math.min(SHIP_DAY + 1, next.day + 1); next.time = 'dawn'; next.timeActions = 0; next.stats.health = clamp(next.stats.health + 15); next.stats.focus = clamp(next.stats.focus + 40); applied.slept = true; }
  }
  if (outcome.lampLit && !next.ending) {
    if (next.day > SHIP_DAY) applied.rejected.push('lamp:too-late');
    else if (next.location !== 'lantern-room' || !Object.values(next.repairs).every(Boolean)) applied.rejected.push('lamp:not-ready');
    else next.ending = 'cleared';
  }
  if (!next.ending && next.day > SHIP_DAY) next.ending = 'missed';
  for (const stat of ['health','warmth','focus'] as const) applied.stats[stat] = next.stats[stat] - state.stats[stat];
  return { state: next, applied };
}
