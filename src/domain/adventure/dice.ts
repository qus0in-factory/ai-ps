import type { ToolDefinition } from '../tools.ts';
import type { Result } from '../chat.ts';
export const DICE_TOOL: ToolDefinition = { name: 'roll_dice', description: '폭풍 속 절벽이나 파도 치는 바위처럼 실제로 위험한 행동에만 호출한다. 일상적인 탐색·이동·물건 줍기·재료가 있는 불 피우기에는 호출하지 않는다. 주사위 하나를 굴려 정수 결과가 difficulty 이상이면 성공이다.', parameters: { type: 'object', properties: { sides: { type: 'integer', minimum: 2, maximum: 100 }, difficulty: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['sides','difficulty'], additionalProperties: false } };
export function rollDice(sides: unknown, difficulty: unknown, random: () => number = Math.random): Result<{ sides: number; difficulty: number; roll: number; success: boolean }> {
  if (typeof sides !== 'number' || !Number.isInteger(sides) || sides < 2 || sides > 100 || typeof difficulty !== 'number' || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > sides) return { ok: false, reason: '주사위는 2~100면, 난이도는 1~면 수의 정수여야 합니다.' };
  const threshold = Math.min(difficulty, Math.floor(sides * 0.7));
  const r = random();
  if (!Number.isFinite(r) || r < 0 || r >= 1) return { ok: false, reason: '주사위 난수 생성에 실패했습니다.' };
  const roll = Math.floor(r * sides) + 1;
  return { ok: true, value: { sides, difficulty: threshold, roll, success: roll >= threshold } };
}
