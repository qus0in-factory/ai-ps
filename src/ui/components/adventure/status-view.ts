import type { GameState } from '../../../domain/adventure/types.ts';
import { locationLabels, timeLabels, weatherLabels } from './labels.ts';

/** design §1: 5일차 밤에 보급선이 지난다. */
const SHIP_DAY = 5;
const BARS = 8;

export type PortraitKind = 'ok' | 'hurt' | 'cold';

export interface StatusView {
  portrait: PortraitKind;
  bars: { health: number; warmth: number; focus: number };
  dayLabel: string;
  timeLabel: string;
  weatherLabel: string;
  locationLabel: string;
  shipDaysLeft: number;
  shipLabel: string;
  repairs: { lens: boolean; clockwork: boolean; oil: boolean };
}

/** 0~100 값을 8칸 채움 개수로 바꾼다. 예: 90 → 7칸(반올림), 100 → 8칸. */
export function barCells(value: number): number {
  const filled = Math.round((value / 100) * BARS);
  return Math.max(0, Math.min(BARS, filled));
}

export function statusView(state: GameState): StatusView {
  const { stats } = state;
  const portrait: PortraitKind = stats.health <= 30 ? 'hurt'
    : stats.warmth <= 25 || stats.focus <= 20 ? 'cold' : 'ok';
  const remaining = SHIP_DAY - state.day;
  return {
    portrait,
    bars: { health: barCells(stats.health), warmth: barCells(stats.warmth), focus: barCells(stats.focus) },
    dayLabel: `${state.day}일차`,
    timeLabel: timeLabels[state.time],
    weatherLabel: weatherLabels[state.weather],
    locationLabel: locationLabels[state.location],
    shipDaysLeft: Math.max(0, remaining),
    shipLabel: remaining > 0 ? `배 도착까지 ${remaining}일` : remaining === 0 ? '배는 오늘 밤' : '배는 이미 지나감',
    repairs: { lens: state.repairs.lens, clockwork: state.repairs.clockwork, oil: state.repairs.oil },
  };
}
