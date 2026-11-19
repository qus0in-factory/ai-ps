// 책 10.7의 회귀 관문(순수 비교). 기준선과 후보를 인덱스로 짝지어 코드 채점과 루브릭 평균을 함께 본다.
import { rubricAverage, type RubricScores } from './rubric.ts';

export interface EvalCase {
  topic: string;
  citations: { passed: boolean };
  effort: { passed: boolean };
  scores: RubricScores;
}

export interface EvalComparison {
  topic: string;
  verdict: 'regression' | 'improvement' | 'same';
}

const codeChecksPassed = (entry: EvalCase): boolean => entry.citations.passed && entry.effort.passed;

/** 인덱스 짝짓기 전에 주제 집합·개수·순서를 검증해 누락·재배치가 회귀를 감추지 않게 한다. */
export function validateEvalAlignment(baseline: EvalCase[], candidate: EvalCase[]): string[] {
  const problems: string[] = [];
  const before = baseline.map(entry => entry.topic);
  const after = candidate.map(entry => entry.topic);
  if (before.length !== after.length) problems.push(`주제 수 불일치: 기준선 ${before.length}건, 후보 ${after.length}건`);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const topic of beforeSet) if (!afterSet.has(topic)) problems.push(`기준선 주제 누락: ${topic}`);
  for (const topic of afterSet) if (!beforeSet.has(topic)) problems.push(`후보에 추가된 주제: ${topic}`);
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    if (before[index] !== after[index]) problems.push(`${index + 1}번째 주제 순서 불일치: ${before[index]} -> ${after[index]}`);
  }
  return problems;
}

/** 길이가 다르면 짧은 쪽까지만 비교한다. */
export function compareEvalRuns(
  baseline: EvalCase[], candidate: EvalCase[], { scoreDrop = 0.5 }: { scoreDrop?: number } = {},
): EvalComparison[] {
  const comparisons: EvalComparison[] = [];
  for (let index = 0; index < Math.min(baseline.length, candidate.length); index++) {
    const before = baseline[index]!;
    const after = candidate[index]!;
    const wasPassing = codeChecksPassed(before);
    const isPassing = codeChecksPassed(after);
    const dropped = rubricAverage(before.scores) - rubricAverage(after.scores) >= scoreDrop;
    comparisons.push({
      topic: after.topic,
      verdict: (wasPassing && !isPassing) || dropped ? 'regression'
        : !wasPassing && isPassing ? 'improvement'
        : 'same',
    });
  }
  return comparisons;
}
