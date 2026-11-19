// 관측·비용 계약(설계 /tmp/obs-spec.md §8·§10). 순수 도메인: 외부 의존 없음.

export type UsageService = 'openai' | 'brave' | 'ncp';

export type UsageOp = 'completion' | 'transcribe' | 'realtime' | 'search';

/** 기록 시점 단가로 costUsd를 계산해 D1에 저장한다(단가 변경은 과거 행에 소급되지 않는다). */
export interface UsageEvent {
  service: UsageService;
  op: UsageOp;
  model?: string | null;
  status: number;
  ms: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** 입력 토큰 중 프롬프트 캐시가 적중한 부분(§16). */
  cachedTokens?: number | null;
}

/** `day`는 UTC `YYYY-MM-DD`. 데이터 없는 날·서비스는 생략(UI가 0으로 채운다). */
export interface UsageStats {
  days: number;
  totals: { calls: number; errors: number; costUsd: number; inputTokens: number; cachedTokens: number };
  byService: { service: UsageService; calls: number; errors: number; avgMs: number; costUsd: number }[];
  byDay: { day: string; service: UsageService; calls: number; costUsd: number }[];
}

export interface ModelPriceUsd {
  inputPerM: number;
  outputPerM: number;
  /** 캐시 적중 입력 단가(§16). 없는 모델은 입력 단가로 폴백한다. */
  cachedInputPerM?: number;
}

export interface SearchPriceUsd {
  perCall: number;
}

/**
 * 단가 출처(달러, 1M 토큰당·호출당): OpenAI 공식 가격 페이지
 * https://developers.openai.com/api/docs/pricing — Standard, 확인 2026-11-19.
 * Brave 0.005/호출·NCP 0(한시 무료)은 사용자 확정(2026-11-19).
 * 단가를 못 찾은 항목은 0:
 * - gpt-transcribe: 토큰 단가 미공개(분당 $0.0045만 있음) → 토큰 비용 0.
 * realtime 항목은 입·출력 모두 오디오 토큰 단가로 계산하는 근사다(설계 §8).
 */
export const PRICES_USD: {
  models: Record<string, ModelPriceUsd>;
  search: Partial<Record<UsageService, SearchPriceUsd>>;
} = {
  models: {
    // cachedInputPerM은 실사용 모델(terra·luna)과 realtime 계열만 등록한다(§16).
    // 미등록 모델(6.2·sol·astra·5.6 계열)의 캐시분은 입력 단가로 계산해 과대평가만 방지한다.
    'gpt-6.2-astra': { inputPerM: 8, outputPerM: 40 },
    'gpt-6.2-sol': { inputPerM: 2, outputPerM: 10 },
    'gpt-6-astra': { inputPerM: 10, outputPerM: 50 },
    'gpt-6.1-sol': { inputPerM: 2, outputPerM: 10 },
    'gpt-6.1-terra': { inputPerM: 1, outputPerM: 5, cachedInputPerM: 0.05 },
    'gpt-6-luna': { inputPerM: 0.1, outputPerM: 0.5, cachedInputPerM: 0.01 },
    'gpt-6-sol': { inputPerM: 2, outputPerM: 10 },
    'gpt-5.6-sol': { inputPerM: 4, outputPerM: 20 },
    'gpt-5.6-terra': { inputPerM: 2, outputPerM: 12 },
    'gpt-5.6-luna': { inputPerM: 0.2, outputPerM: 1.2 },
    'gpt-transcribe': { inputPerM: 0, outputPerM: 0 },
    'gpt-realtime-2.1-mini': { inputPerM: 10, outputPerM: 20, cachedInputPerM: 0.3 },
    'gpt-realtime-mini': { inputPerM: 10, outputPerM: 20, cachedInputPerM: 0.3 },
    'gpt-realtime': { inputPerM: 32, outputPerM: 64, cachedInputPerM: 0.4 },
  },
  search: {
    brave: { perCall: 0.005 },
    ncp: { perCall: 0 },
  },
};

function modelPriceUsd(model: string): ModelPriceUsd | undefined {
  let match: string | null = null;
  for (const prefix of Object.keys(PRICES_USD.models)) {
    if (model.startsWith(prefix) && (match === null || prefix.length > match.length)) match = prefix;
  }
  return match === null ? undefined : PRICES_USD.models[match];
}

/** 검색은 호출당, 모델 호출은 토큰 단가(모델명 최장 접두어 일치, 없으면 0).
 * 캐시 적중분은 더 싼 캐시 입력 단가로, 캐시 단가가 없는 모델은 입력 단가로 계산한다(§16). */
export function costUsd(event: UsageEvent): number {
  if (event.op === 'search') return PRICES_USD.search[event.service]?.perCall ?? 0;
  if (!event.model) return 0;
  const price = modelPriceUsd(event.model);
  if (!price) return 0;
  const input = event.inputTokens ?? 0;
  const cached = Math.min(event.cachedTokens ?? 0, input);
  const cachedRate = price.cachedInputPerM ?? price.inputPerM;
  return ((input - cached) / 1_000_000) * price.inputPerM + (cached / 1_000_000) * cachedRate
    + ((event.outputTokens ?? 0) / 1_000_000) * price.outputPerM;
}
