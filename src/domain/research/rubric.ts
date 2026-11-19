// 책 10.5의 루브릭 평가자(하네스 전용). 운영 평가자(evaluateReport)는 그대로 두고 여기서만 점수를 쓴다.
import type { ChatMessage, Result } from '../chat.ts';
import type { JsonSchemaResponseFormat } from '../completion.ts';
import { UNTRUSTED_RULE } from '../untrusted.ts';

export interface RubricScores {
  grounded: number;
  structured: number;
  clear: number;
  reasons: string;
}

export const RUBRIC_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'rubric_scores',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        grounded: { type: 'integer', description: '조사 노트에 근거한 정도(1~5)' },
        structured: { type: 'integer', description: '보고서 구조가 갖춰진 정도(1~5)' },
        clear: { type: 'integer', description: '군더더기 없이 명료한 정도(1~5)' },
        reasons: { type: 'string', description: '각 점수의 짧은 근거' },
      },
      required: ['grounded', 'structured', 'clear', 'reasons'],
      additionalProperties: false,
    },
  },
};

const RUBRIC_CRITERIA = [
  '근거(grounded): 조사 노트에 있는 사실만 사용했는지.',
  '구조(structured): 개요·주요 내용·시사점·참고 자료 등 보고서 구조를 갖췄는지.',
  '명료(clear): 군더더기 없이 명료하게 썼는지.',
].join('\n');

/** 노트·보고서는 외부 데이터라는 9.7 경계 규칙을 함께 넣는다. */
export function buildRubricMessages(topic: string, notes: string, report: string): ChatMessage[] {
  return [{ role: 'user', content: [
    '보고서의 길이나 유창함이 아니라 루브릭 기준만으로 채점한다.',
    RUBRIC_CRITERIA,
    '각 기준을 1부터 5까지의 정수로 매기고 reasons에 짧은 근거를 적는다.',
    UNTRUSTED_RULE,
    `[주제]\n${topic}`,
    `[조사 노트]\n${notes.trim() || '(조사 노트가 비어 있습니다.)'}`,
    `[보고서]\n${report.trim() || '(보고서가 비어 있습니다.)'}`,
  ].join('\n') }];
}

/** 세 점수의 산술 평균(회귀 관문의 rubric_avg). */
export function rubricAverage(scores: RubricScores): number {
  return (scores.grounded + scores.structured + scores.clear) / 3;
}

export function parseRubric(raw: string): Result<RubricScores> {
  const invalid = (): Result<RubricScores> => ({ ok: false, reason: '루브릭 응답 형식이 올바르지 않습니다.' });
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
    const value = data as Record<string, unknown>;
    const score = (key: 'grounded' | 'structured' | 'clear'): number | undefined => {
      const candidate = value[key];
      return Number.isInteger(candidate) && (candidate as number) >= 1 && (candidate as number) <= 5
        ? candidate as number : undefined;
    };
    const grounded = score('grounded');
    const structured = score('structured');
    const clear = score('clear');
    if (grounded === undefined || structured === undefined || clear === undefined || typeof value.reasons !== 'string') return invalid();
    return { ok: true, value: { grounded, structured, clear, reasons: value.reasons } };
  } catch {
    return invalid();
  }
}
