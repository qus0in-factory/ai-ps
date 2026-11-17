import type { LocationId, TimeOfDay, Weather } from '../../../domain/adventure/types.ts';
import { ADVENTURE_DISPLAY_NAMES } from '../../../app/adventure/session-store.ts';

const display = ADVENTURE_DISPLAY_NAMES as Record<string, string>;

/** 내부 ID를 화면 표시 이름으로 바꾼다. 표에 없는 ID는 그대로 보여 준다. */
export function displayName(id: string): string {
  return display[id] ?? id;
}

/** 도메인 상수를 ui가 값으로 import할 수 없어(타입 전용 규칙) 표기만 여기서 관리한다. */
export const timeLabels: Record<TimeOfDay, string> = { dawn: '새벽', day: '낮', dusk: '해질녘', night: '밤' };
export const weatherLabels: Record<Weather, string> = { clear: '맑음', fog: '안개', storm: '폭풍' };

const locationIds: LocationId[] = ['quarters', 'stairwell', 'lantern-room', 'shore', 'boathouse', 'cliff-path'];
export const locationLabels = Object.fromEntries(locationIds.map((id) => [id, displayName(id)])) as Record<LocationId, string>;
export const locationOptions = locationIds.map((value) => ({ value, label: locationLabels[value] }));
