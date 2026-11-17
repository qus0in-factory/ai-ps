import type { AdventureEvent, AdventureSession, AppliedChanges, GameState } from './types.ts';
export const LOCATIONS = ['quarters', 'stairwell', 'lantern-room', 'shore', 'boathouse', 'cliff-path'] as const;
export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export const WEATHER = ['clear', 'fog', 'storm'] as const;
export const PARTS = ['lens', 'clockwork', 'oil'] as const;
export const MAX_TURNS = 1_000_000;
export const START_STATE: GameState = { day: 1, time: 'dawn', weather: 'storm', location: 'quarters', stats: { health: 90, warmth: 55, focus: 70 }, inventory: ['lantern-handheld', 'matches'], repairs: { lens: false, clockwork: false, oil: false } };
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
export const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export const itemId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,23}$/.test(v);
export const member = (v: unknown, values: readonly string[]): boolean => typeof v === 'string' && values.includes(v);
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
export function isGameState(v: unknown): v is GameState {
  return record(v) && only(v, ['day','time','weather','location','stats','inventory','repairs','ending']) && integer(v.day, 1, 6) && (v.day < 6 || v.ending === 'missed' || v.ending === 'dead') && member(v.time, TIMES) && member(v.weather, WEATHER) && member(v.location, LOCATIONS) &&
    record(v.stats) && only(v.stats, ['health','warmth','focus']) && ['health', 'warmth', 'focus'].every(key => integer((v.stats as Record<string, unknown>)[key], 0, 100)) &&
    Array.isArray(v.inventory) && v.inventory.length <= 12 && v.inventory.every(itemId) && new Set(v.inventory).size === v.inventory.length &&
    record(v.repairs) && only(v.repairs, [...PARTS]) && PARTS.every(key => typeof (v.repairs as Record<string, unknown>)[key] === 'boolean') &&
    (v.ending === undefined || member(v.ending, ['cleared', 'dead', 'missed']));
}
export function isAdventureSession(v: unknown): v is AdventureSession {
  return record(v) && only(v, ['version','state','recent','turn']) && v.version === 1 && isGameState(v.state) && integer(v.turn, 0, MAX_TURNS) &&
    Array.isArray(v.recent) && v.recent.length <= 4 && v.recent.every(r => record(r) && only(r, ['action','narrative']) && text(r.action, 200) && text(r.narrative, 400));
}
export function createSession(): AdventureSession { return { version: 1, state: structuredClone(START_STATE), recent: [], turn: 0 }; }
function isApplied(v: unknown): v is AppliedChanges {
  return record(v) && record(v.stats) && only(v.stats, ['health','warmth','focus']) && ['health', 'warmth', 'focus'].every(key => integer((v.stats as Record<string, unknown>)[key], -100, 100)) &&
    Array.isArray(v.added) && v.added.length <= 4 && v.added.every(itemId) && Array.isArray(v.removed) && v.removed.length <= 12 && v.removed.every(itemId) &&
    Array.isArray(v.repaired) && v.repaired.length <= 3 && v.repaired.every(p => member(p, PARTS)) &&
    typeof v.slept === 'boolean' && (v.moved === undefined || member(v.moved, LOCATIONS));
}
export function isAdventureEvent(v: unknown): v is AdventureEvent {
  if (!record(v)) return false;
  switch (v.kind) {
    case 'accepted': return text(v.action, 200);
    case 'dice': return integer(v.sides, 2, 100) && integer(v.difficulty, 1, Number(v.sides)) && integer(v.roll, 1, Number(v.sides)) && v.success === (Number(v.roll) >= Number(v.difficulty));
    case 'narrative': return text(v.text, 1200);
    case 'state': return isGameState(v.state) && isApplied(v.applied);
    case 'invalid': return text(v.reason, 500);
    case 'ending': return member(v.ending, ['cleared', 'dead', 'missed']) && integer(v.day, 1, 6);
    default: return false;
  }
}

// Reconstruct instead of forwarding client-owned objects across the HTTP/model boundary.
export function normalizeSession(value: unknown): AdventureSession | undefined {
  if (!isAdventureSession(value)) return undefined;
  const s = value.state;
  return { version: 1, turn: value.turn, recent: value.recent.map(r => ({ action: r.action, narrative: r.narrative })),
    state: { day: s.day, time: s.time, weather: s.weather, location: s.location,
      stats: { health: s.stats.health, warmth: s.stats.warmth, focus: s.stats.focus }, inventory: [...s.inventory],
      repairs: { lens: s.repairs.lens, clockwork: s.repairs.clockwork, oil: s.repairs.oil }, ...(s.ending ? { ending: s.ending } : {}) } };
}
