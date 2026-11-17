/** 상단 고정 상태 패널의 축약 판정과 축약 라벨. 화면 밖 센티널을 기준으로 한다. */
export function compactFromIntersection(entry: Pick<IntersectionObserverEntry, 'isIntersecting'>): boolean {
  return !entry.isIntersecting;
}

const shortLabels = { health: '체', warmth: '온', focus: '집' } as const;

export function shortStatLabel(tone: 'health' | 'warmth' | 'focus'): string {
  return shortLabels[tone];
}
