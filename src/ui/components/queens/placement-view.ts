import type { QueensSolution } from '../../../domain/queens/types.ts';

export function placementView(solution: QueensSolution) {
  return {
    summary: '정답 배치 생성 (펼쳐서 보기)',
    detail: solution.map((q) => `(${q.row}, ${q.column})`).join(', '),
  };
}
