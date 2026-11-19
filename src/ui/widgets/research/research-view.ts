import type { ResearchEvaluation, ResearchResult, ResearchStep } from './types.ts';
import { RESEARCH_TOPIC_MAX } from './types.ts';

const DETAIL_MAX = 120;

export function topicProblem(topic: string): string | null {
  const trimmed = topic.trim();
  if (!trimmed) return `조사할 주제를 입력해 주세요. (1~${RESEARCH_TOPIC_MAX}자)`;
  if (trimmed.length > RESEARCH_TOPIC_MAX) return `주제는 1~${RESEARCH_TOPIC_MAX}자로 입력해 주세요.`;
  return null;
}

export function stepTitle(step: ResearchStep): string {
  return step.tool === 'search_web' ? '웹 검색' : '페이지 읽기';
}

export function stepDetail(step: ResearchStep): string {
  const value = step.tool === 'search_web' ? step.args.query : step.args.url;
  if (typeof value !== 'string') return '';
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= DETAIL_MAX ? oneLine : `${oneLine.slice(0, DETAIL_MAX - 1)}…`;
}

export function stepOutcome(step: ResearchStep): string {
  return step.ok ? '성공' : '실패';
}

export interface VisibleSource {
  url: string;
  host: string;
}

export function visibleSources(sources: readonly string[]): VisibleSource[] {
  const seen = new Set<string>();
  const result: VisibleSource[] = [];
  for (const source of sources) {
    if (seen.has(source)) continue;
    let parsed: URL;
    try { parsed = new URL(source); } catch { continue; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    seen.add(source);
    result.push({ url: source, host: parsed.hostname });
  }
  return result;
}

export function runSummary(result: Pick<ResearchResult, 'steps' | 'iterations' | 'capped'>): string {
  const base = `${result.iterations}회 반복 · 도구 ${result.steps.length}회`;
  return result.capped ? `${base} · 반복 한도 도달` : base;
}

export function elapsedLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `조사 중 · ${minutes > 0 ? `${minutes}분 ${rest}초` : `${rest}초`} 경과`;
}

export function evaluationSummary(evaluation: ResearchEvaluation): string {
  if (evaluation.passed) return '검증 통과 · 조사 노트 근거 확인';
  return evaluation.problems.length > 0
    ? `검증 미통과 · 보완 필요 ${evaluation.problems.length}건`
    : '검증 미통과';
}
