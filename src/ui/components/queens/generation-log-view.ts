import type { PuzzleValidation } from '../../../domain/queens/types.ts';

export const SPOILER_SUMMARY = '정답 좌표 보기 (스포일러)';
export const HIDDEN_VALUE = '(가려짐)';

export interface LogEntryView {
  detail: string;
  spoiler?: string;
}

export interface ValidationEntryView extends LogEntryView {
  summary: string;
}

const queenObject = /\{\s*"row"\s*:\s*-?\d+\s*,\s*"column"\s*:\s*-?\d+\s*\}/g;
const queenPair = /\(\s*-?\d+\s*,\s*-?\d+\s*\)/g;

/** Hides "(row, column)" pairs and serialized queens while leaving the rest of the text readable. */
export function redactCoordinates(text: string): string {
  return text.replace(queenObject, HIDDEN_VALUE).replace(queenPair, HIDDEN_VALUE);
}

export function validationView(report: PuzzleValidation): ValidationEntryView {
  const codes = report.issues.map((issue) => issue.code).join(', ');
  const summary = report.valid
    ? `검증 통과 · 정답 ${report.solutions.length}개`
    : `검증 실패 · ${codes}`;
  const detail = JSON.stringify({
    valid: report.valid,
    solutionStatus: report.solutionStatus,
    solutions: report.solutions.length ? HIDDEN_VALUE : [],
    nodesVisited: report.nodesVisited,
    issues: report.issues.map((issue) => ({
      code: issue.code,
      message: redactCoordinates(issue.message),
      ...(issue.region === undefined ? {} : { region: issue.region }),
      ...(issue.solutions === undefined ? {} : { solutions: HIDDEN_VALUE }),
    })),
  }, null, 2);
  const hidden = report.solutions.length > 0 || report.issues.some((issue) =>
    (issue.solutions?.length ?? 0) > 0 || redactCoordinates(issue.message) !== issue.message);
  return hidden ? { summary, detail, spoiler: JSON.stringify(report, null, 2) } : { summary, detail };
}

export function feedbackView(message: string): LogEntryView {
  const detail = redactCoordinates(message);
  return detail === message ? { detail } : { detail, spoiler: message };
}

export function candidateView(regions: unknown): LogEntryView {
  const raw = JSON.stringify(regions, null, 2) ?? 'null';
  const detail = redactCoordinates(raw);
  return detail === raw ? { detail } : { detail, spoiler: raw };
}
