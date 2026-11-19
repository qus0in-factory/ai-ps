// 라우트별 문서 제목·설명의 단일 출처. 새 라우트를 App.tsx에 추가하면 여기에도 추가한다(테스트가 강제).
export interface RouteMeta {
  title: string;
  description?: string;
}

const SITE = 'ai-ps';

// '/' 와 알 수 없는 경로는 설명을 비워 두어 index.html 의 기본 태그(og.json 생성물)를 그대로 쓴다.
export const ROUTE_META: Record<string, RouteMeta> = {
  '/': { title: SITE },
  '/chat': { title: `Chat · ${SITE}`, description: '도구 호출과 계획 실행을 시험하는 AI 채팅.' },
  '/queens': { title: `Queens · ${SITE}`, description: 'AI가 생성하는 Queens 퍼즐.' },
  '/adventure': { title: `Adventure · ${SITE}`, description: '「잿빛 등대」 텍스트 어드벤처.' },
  '/talk': { title: `Talk · ${SITE}`, description: '일본어 회화 연습 튜터.' },
  '/research': { title: `Research · ${SITE}`, description: '검색과 웹 읽기로 주제를 조사해 보고서를 쓰는 자동 리서치 에이전트.' },
  '/stats': { title: `사용량 · ${SITE}`, description: '외부 API 호출·오류·비용 통계.' },
};

export function metaFor(pathname: string): RouteMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ROUTE_META[path] ?? ROUTE_META['/']!;
}

interface MetaTag {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}
export interface MetaDocument {
  title: string;
  querySelector(selector: string): MetaTag | null;
}

const TAGS = {
  description: 'meta[name="description"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
} as const;

// 첫 적용 때 index.html 의 원래 content 를 기억해 두었다가 '/' 로 돌아오면 복원한다.
const originals = new WeakMap<object, string>();

function setContent(doc: MetaDocument, selector: string, value: string | undefined) {
  const tag = doc.querySelector(selector);
  if (!tag) return;
  if (!originals.has(tag)) originals.set(tag, tag.getAttribute('content') ?? '');
  tag.setAttribute('content', value ?? originals.get(tag) ?? '');
}

export function applyRouteMeta(doc: MetaDocument, pathname: string): void {
  const { title, description } = metaFor(pathname);
  doc.title = title;
  setContent(doc, TAGS.description, description);
  setContent(doc, TAGS.ogTitle, description === undefined ? undefined : title);
  setContent(doc, TAGS.ogDescription, description);
}
