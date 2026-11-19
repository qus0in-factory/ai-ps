import { MAX_RESEARCH_RESPONSE_BYTES, cancelResearchBody, readResearchBody } from './research-http.ts';

const CONTENT_LIMIT = 4000;
const TITLE_LIMIT = 500;
// Malformed markup can turn a small chunk into thousands of JavaScript callbacks.
const MAX_PARSER_EVENTS = 4000;
const IGNORED = 'script,style,noscript,nav,footer,header,aside,template,svg,form,iframe';
const IGNORED_TAGS = new Set(IGNORED.split(','));
const BLOCKS = new Set('address article blockquote br dd div dl dt fieldset figcaption figure h1 h2 h3 h4 h5 h6 hr li main ol p pre section table td th tr ul'.split(' '));
const namedEntities = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©',
}));

interface TextChunk { text: string; lastInTextNode: boolean }
interface Element {
  tagName: string;
  onEndTag(callback: () => void): void;
}
interface Handler { text?(chunk: TextChunk): void; element?(element: Element): void }
interface Rewriter {
  on(selector: string, handler: Handler): this;
  onDocument(handler: { text(chunk: TextChunk): void }): this;
  transform(response: Response): Response;
}
type RewriterConstructor = new () => Rewriter;
type HtmlContent = { title: string; content: string };
export type ResearchHtmlExtractor = (response: Response, signal: AbortSignal) => Promise<HtmlContent>;

class TextBuffer {
  value = '';
  private separator = '';

  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  get full() { return this.value.length >= this.limit; }

  breakLine() { this.separator = '\n'; }

  append(text: string) {
    if (this.full) return;
    for (const part of text.matchAll(/\s+|\S+/gu)) {
      const token = part[0];
      if (/^\s/u.test(token)) {
        this.separator ||= ' ';
        continue;
      }
      const next = (this.value ? this.separator : '') + token;
      this.value += next.slice(0, this.limit - this.value.length);
      this.separator = '';
      if (this.full) break;
    }
  }
}

function decodeEntities(text: string): string {
  // Bound each match, including on malformed input consisting entirely of ampersands.
  return text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]{1,32});/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return namedEntities.get(name) ?? entity;
    const codepoint = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
      ? String.fromCodePoint(codepoint) : '�';
  });
}

/** Cap bytes before they enter the parser, including a chunk containing the stopping point. */
function parserInput(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > MAX_RESEARCH_RESPONSE_BYTES) {
    cancelResearchBody(response);
    throw new Error('Response exceeds size limit');
  }
  const input = response.body;
  if (!input) return { response, stop() {}, failure: new Promise<never>(() => {}) };

  const reader = input.getReader();
  const { promise: failure, reject } = Promise.withResolvers<never>();
  let bytes = 0;
  let pending: Uint8Array | undefined;
  let closed = false;
  const finish = (cancel: boolean) => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', abort);
    if (cancel) void reader.cancel().catch(() => {});
    reader.releaseLock();
  };
  const abort = () => { reject(signal.reason); finish(true); };
  signal.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        if (!pending?.length) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) {
            controller.close();
            finish(false);
            return;
          }
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESEARCH_RESPONSE_BYTES) throw new Error('Response exceeds size limit');
          pending = chunk.value;
        }
        // Give the parser an opportunity to yield or stop between chunks.
        controller.enqueue(pending.subarray(0, 4 * 1024));
        pending = pending.subarray(4 * 1024);
      } catch (error) {
        reject(error);
        finish(true);
        controller.error(error);
      }
    },
    cancel() { finish(true); },
  }, { highWaterMark: 0 });
  // Body bytes have already been decompressed by fetch.
  return {
    response: new Response(body, { headers: { 'content-type': response.headers.get('content-type') ?? 'text/html' } }),
    stop: () => finish(true),
    failure,
  };
}

async function extractWithRewriter(response: Response, signal: AbortSignal, Rewriter: RewriterConstructor): Promise<HtmlContent> {
  signal.throwIfAborted();
  const title = new TextBuffer(TITLE_LIMIT);
  const main = new TextBuffer(CONTENT_LIMIT);
  const article = new TextBuffer(CONTENT_LIMIT);
  const body = new TextBuffer(CONTENT_LIMIT);
  const fragment = new TextBuffer(CONTENT_LIMIT);
  const { promise: interrupted, resolve: stopParsing, reject: failParsing } = Promise.withResolvers<void>();
  let events = 0;
  let stopped = false;
  const canParse = () => {
    if (stopped) return false;
    if (++events <= MAX_PARSER_EVENTS) return true;
    stopped = true;
    failParsing(new Error('HTML parser event limit exceeded'));
    return false;
  };
  let regions = { skip: false, head: false, title: false, main: false, article: false, body: false };
  let entityTail = '';
  const mark = (region: keyof typeof regions) => ({ text() { regions[region] = true; } });
  const source = parserInput(response, signal);
  const output = new Rewriter()
    .on(IGNORED, mark('skip'))
    .on('head', mark('head'))
    .on('title', mark('title'))
    .on('main', mark('main'))
    .on('article', mark('article'))
    .on('body', mark('body'))
    .on('*', { element(element) {
      if (!canParse()) return;
      if (!BLOCKS.has(element.tagName)) return;
      const boundary = () => {
        for (const buffer of [main, article, body, fragment]) buffer.breakLine();
      };
      boundary();
      if (element.tagName !== 'br' && element.tagName !== 'hr') element.onEndTag(boundary);
    } })
    .onDocument({ text(chunk) {
      if (!canParse()) return;
      // Selector callbacks have all run by the time the document callback receives a chunk.
      let text = entityTail + chunk.text;
      entityTail = '';
      if (!chunk.lastInTextNode) {
        const amp = text.lastIndexOf('&');
        if (amp >= 0 && text.length - amp <= 34 && /^&[#a-z0-9]*$/i.test(text.slice(amp))) {
          entityTail = text.slice(amp);
          text = text.slice(0, amp);
        }
      }
      if (text && !regions.skip) {
        if (regions.title) title.append(decodeEntities(text));
        else if (!regions.head) {
          const decoded = decodeEntities(text);
          if (regions.main) main.append(decoded);
          if (regions.article) article.append(decoded);
          if (regions.body) body.append(decoded);
          fragment.append(decoded);
        }
      }
      regions = { skip: false, head: false, title: false, main: false, article: false, body: false };
      // Only main is final this early. An article or body prefix could precede a later main.
      if (main.full) {
        stopped = true;
        stopParsing();
      }
    } })
    .transform(source.response).body;

  if (output) {
    const reader = output.getReader();
    const drain = async () => {
      while (!(await reader.read()).done) signal.throwIfAborted();
    };
    try {
      await Promise.race([interrupted, source.failure, drain()]);
    } finally {
      source.stop();
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  signal.throwIfAborted();
  return { title: title.value.trimEnd(), content: (main.value || article.value || body.value || fragment.value).trimEnd() };
}

/** Vite and Node tests have no native HTMLRewriter. Use the existing Node parser there. */
const extractWithNode: ResearchHtmlExtractor = async (response, signal) => {
  const raw = await readResearchBody(response, signal);
  // Keep the Node-only module out of the Workers bundle.
  const nodeParser = 'jsdom';
  const { JSDOM } = await import(/* @vite-ignore */ nodeParser) as typeof import('jsdom');
  signal.throwIfAborted();
  const dom = new JSDOM(raw);
  try {
    const document = dom.window.document;
    const title = new TextBuffer(TITLE_LIMIT);
    title.append(document.title);
    const body = new TextBuffer(CONTENT_LIMIT);
    const main = new TextBuffer(CONTENT_LIMIT);
    const article = new TextBuffer(CONTENT_LIMIT);
    const buffers = [main, article, body];
    const boundary = () => buffers.forEach(buffer => buffer.breakLine());
    const root = document.body;
    if (!root) return { title: title.value, content: '' };
    let mains = 0;
    let articles = 0;
    const tag = (node: Node) => (node as HTMLElement).localName;
    for (let node: Node | null = root.firstChild; node && node !== root && !main.full;) {
      const name = tag(node);
      if (!IGNORED_TAGS.has(name)) {
        if (node.nodeType === 3) {
          const text = node.nodeValue ?? '';
          if (mains) main.append(text);
          if (articles) article.append(text);
          body.append(text);
        }
        if (BLOCKS.has(name)) boundary();
        if (name === 'main') mains++;
        if (name === 'article') articles++;
        if (node.firstChild) {
          node = node.firstChild;
          continue;
        }
      }
      while (node && node !== root) {
        const closing = tag(node);
        if (BLOCKS.has(closing)) boundary();
        if (closing === 'main') mains--;
        if (closing === 'article') articles--;
        if (node.nextSibling) {
          node = node.nextSibling;
          break;
        }
        node = node.parentNode;
      }
    }
    return { title: title.value.trimEnd(), content: (main.value || article.value || body.value).trimEnd() };
  } finally { dom.window.close(); }
};

export const extractResearchHtml: ResearchHtmlExtractor = (response, signal) => {
  const Rewriter = (globalThis as typeof globalThis & { HTMLRewriter?: RewriterConstructor }).HTMLRewriter;
  return Rewriter ? extractWithRewriter(response, signal, Rewriter) : extractWithNode(response, signal);
};
