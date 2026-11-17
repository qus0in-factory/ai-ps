import type { DiceRoll } from '../../../app/adventure/session-store.ts';
import type { AdventureLogEntry, StreamingTurn } from '../../../app/adventure/session-store.ts';
import type { AppliedChanges } from '../../../domain/adventure/types.ts';
import { displayName } from './labels.ts';

/** 주사위 판정 한 줄. 예: 🎲 d20=14 ≥ 12 성공 */
export function diceLine(dice: DiceRoll): string {
  return `🎲 d${dice.sides}=${dice.roll} ≥ ${dice.difficulty} ${dice.success ? '성공' : '실패'}`;
}

/** 스트림 조각을 문장 하나로 합친다(빈 조각은 버린다). */
export function joinFragments(fragments: readonly string[]): string {
  return fragments.filter((fragment) => Boolean(fragment && fragment.trim())).join(' ');
}

const rejectedLabels: Record<string, string> = {
  'repair:no-part': '부품 없음',
  'repair:not-lantern-room': '등실이 아님',
  'repair:no-focus': '집중 부족',
  'sleep:not-quarters': '숙소가 아님',
  'lamp:not-ready': '점등 조건 미충족',
  'lamp:too-late': '기한 지남',
};

export function rejectedLabel(code: string): string {
  if (code in rejectedLabels) return rejectedLabels[code]!;
  if (/^stat:[a-z]+:clamped$/.test(code)) return '변화량 상한 적용';
  if (/^stat:[a-z]+:/.test(code)) return '변화량 조정';
  return code;
}

/** 진행 중인 턴 표시. 서술이 아직 없어도 행동·주사위가 오면 보여 준다(R8). */
export function streamingView(streaming: StreamingTurn | undefined): {
  visible: boolean;
  action: string;
  text: string;
  dice: DiceRoll[];
} {
  return {
    visible: Boolean(streaming),
    action: streaming?.action ?? '',
    text: streaming?.text ?? '',
    dice: streaming?.dice ?? [],
  };
}

/** 첫 장면(행동 없는 인트로)은 행동·변화 줄을 숨긴다(R10). */
export function isIntro(entry: Pick<AdventureLogEntry, 'action'>): boolean {
  return entry.action.trim() === '';
}

/** 턴 적용 결과를 한 줄로. 예: 체력 +15 · 온기 -6 · 획득 spare-lens */
export function deltaLine(applied: AppliedChanges): string {
  const parts: string[] = [];
  const stats: Array<[keyof AppliedChanges['stats'], string]> = [
    ['health', '체력'], ['warmth', '온기'], ['focus', '집중'],
  ];
  for (const [key, label] of stats) {
    const value = applied.stats[key];
    if (value !== 0) parts.push(`${label} ${value > 0 ? '+' : ''}${value}`);
  }
  if (applied.added.length) parts.push(`획득 ${applied.added.map(displayName).join(', ')}`);
  if (applied.removed.length) parts.push(`잃음 ${applied.removed.map(displayName).join(', ')}`);
  if (applied.repaired.length) parts.push(`수리 ${applied.repaired.join(', ')}`);
  if (applied.rejected.length) parts.push(`거부 ${applied.rejected.map(rejectedLabel).join(', ')}`);
  if (applied.slept) parts.push('잠');
  if (applied.moved) parts.push(`이동 ${displayName(applied.moved)}`);
  return parts.length ? parts.join(' · ') : '변화 없음';
}
