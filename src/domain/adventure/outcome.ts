import type { Result } from '../chat.ts';
import type { TurnOutcome } from './types.ts';
import { LOCATIONS, TIMES, WEATHER, PARTS, itemId, member, record, text, integer } from './session.ts';
export function parseTurnOutcome(content: string): Result<TurnOutcome> {
  let v: unknown;
  try { v = JSON.parse(content); }
  catch { try { v = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)); } catch { return { ok: false, reason: '서술을 받지 못했어요. 다른 행동을 입력해 보세요.' }; } }
  if (record(v)) v = { ...v, statChanges: v.statChanges === undefined ? {} : v.statChanges, addItems: v.addItems === undefined ? [] : v.addItems, removeItems: v.removeItems === undefined ? [] : v.removeItems };
  if (!record(v) || !text(v.narrative, 1200) || !record(v.statChanges) ||
      !Object.keys(v.statChanges).every(k => ['health','warmth','focus'].includes(k)) ||
      !Object.values(v.statChanges).every(n => typeof n === 'number' && Number.isFinite(n)) ||
      ![v.addItems, v.removeItems].every(items => Array.isArray(items) && items.length <= 4 && items.every(itemId)) ||
      (v.day !== undefined && !integer(v.day, 1, 6)) ||
      (v.location !== undefined && !member(v.location, LOCATIONS)) || (v.time !== undefined && !member(v.time, TIMES)) || (v.weather !== undefined && !member(v.weather, WEATHER)) ||
      (v.repaired !== undefined && (!Array.isArray(v.repaired) || v.repaired.length > 3 || !v.repaired.every(p => member(p, PARTS)))) ||
      ['sleep','lampLit'].some(k => v[k] !== undefined && typeof v[k] !== 'boolean')) return { ok: false, reason: '서술을 받지 못했어요. 다른 행동을 입력해 보세요.' };
  return { ok: true, value: v as unknown as TurnOutcome };
}
