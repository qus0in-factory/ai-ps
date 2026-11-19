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
