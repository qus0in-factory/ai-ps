import { cancelResearchBody, readResearchBody, researchFailure, withResearchDeadline } from './research-http.ts';
import type { ResearchAdapterResult } from './research-http.ts';

export interface ResearchWebpage { url: string; title: string; content: string }
/** An injected resolver must return every A/AAAA address, not just the first answer. */
export type ResearchDnsLookup = (hostname: string, signal: AbortSignal) => Promise<string[]>;

function publicAddress(address: string): boolean {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) {
    // Canonicalize DNS answers too: padded hextets must not bypass exclusions.
    try { ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
    catch { return false; }
    // Only global unicast, excluding transition/special-purpose and documentation ranges.
    return /^[23][0-9a-f]{3}:/.test(ip) && !ip.includes('.')
      && !/^2001:(?:[01]?[0-9a-f]{0,2}|db8):/.test(ip)
      && !ip.startsWith('2002:') && !ip.startsWith('3fff:');
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number];
  if (ip.split('.').some(part => Number(part) > 255)) return false;
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99))
    && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
    && !(a === 203 && b === 0 && c === 113);
}

function validateUrl(input: string): URL {
  if (input.length > 4096) throw new Error('URL too long');
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || !hostname.includes('.') && !hostname.includes(':')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(hostname)) throw new Error('Blocked URL');
  if ((hostname.includes(':') || /^[\d.]+$/.test(hostname)) && !publicAddress(hostname)) throw new Error('Blocked address');
  url.hash = '';
  return url;
}

async function resolvePublicDns(hostname: string, signal: AbortSignal, fetcher: typeof fetch): Promise<string[]> {
  const addresses: string[] = [];
  for (const type of ['A', 'AAAA']) {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname); url.searchParams.set('type', type);
    const response = await fetcher(url.href, { headers: { Accept: 'application/dns-json' }, redirect: 'error', signal });
    if (!response.ok) { cancelResearchBody(response); throw new Error('DNS lookup failed'); }
    const data: unknown = JSON.parse(await readResearchBody(response, signal, 32 * 1024));
    if (!data || typeof data !== 'object' || !('Status' in data) || data.Status !== 0) throw new Error('DNS lookup failed');
    const answer = (data as { Answer?: unknown }).Answer;
    if (answer === undefined) continue;
    if (!Array.isArray(answer)) throw new Error('Invalid DNS response');
    for (const item of answer) {
      if (item?.type === 1 || item?.type === 28) {
        if (typeof item.data !== 'string') throw new Error('Invalid DNS address');
        addresses.push(item.data);
      }
    }
  }
  return addresses;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? entity;
    const codepoint = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff) ? String.fromCodePoint(codepoint) : '�';
  });
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/[\t\r\f\v ]+/g, ' ')
    .split('\n').map(line => line.trim()).filter(Boolean).join('\n').trim();
}

function extractHtml(html: string): { title: string; content: string } {
  const withoutComments = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const title = cleanText(withoutComments.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '');
  const cleaned = withoutComments
    .replace(/<(script|style|noscript|template|svg|nav|header|footer|aside|form|iframe)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?(?:<\/head\s*>|$)/gi, '');
  const main = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]
    ?? cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1] ?? cleaned;
  return { title, content: cleanText(main.replace(/<\/?(?:p|div|h[1-6]|li|br|section|article|tr|blockquote)\b[^>]*>/gi, '\n')) };
}

export function createResearchWebReader(config: {
  fetcher?: typeof fetch; lookup?: ResearchDnsLookup; timeoutMs?: number;
  allowedHosts?: ReadonlySet<string>; allowIpLiterals?: boolean;
} = {}) {
  const fetcher = config.fetcher ?? fetch;
  return {
    async read(input: string, external?: AbortSignal): Promise<ResearchAdapterResult<ResearchWebpage>> {
      try {
        return await withResearchDeadline(config.timeoutMs, async signal => {
          let url = validateUrl(input);
          const visited = new Set<string>();
          for (let redirects = 0; redirects <= 3; redirects++) {
            if (visited.has(url.href)) throw new Error('Redirect loop');
            visited.add(url.href);
            const hostname = url.hostname.replace(/\.$/, '');
            const literal = hostname.includes(':') || /^[\d.]+$/.test(hostname);
            if (literal && config.allowIpLiterals === false || config.allowedHosts && !config.allowedHosts.has(hostname)) throw new Error('Host not permitted');
            if (!literal) {
              const addresses = await (config.lookup ?? ((name, deadline) => resolvePublicDns(name, deadline, fetcher)))(hostname, signal);
              if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error('Blocked DNS address');
            }
            // Standard fetch cannot pin a DNS answer. A runtime egress policy is needed
            // for a strict guarantee against DNS rebinding between lookup and connect.
            const response = await fetcher(url.href, { redirect: 'manual', signal,
              headers: { Accept: 'text/html, application/xhtml+xml, text/plain' }, credentials: 'omit' });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get('location'); cancelResearchBody(response);
              if (!location || redirects === 3) throw new Error('Invalid redirect');
              url = validateUrl(new URL(location, url).href); continue;
            }
            if (!response.ok) { cancelResearchBody(response); throw new Error('Page request failed'); }
            const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
            if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(mediaType ?? '')) {
              cancelResearchBody(response); throw new Error('Unsupported content type');
            }
            const raw = await readResearchBody(response, signal);
            const extracted = mediaType === 'text/plain' ? { title: '', content: raw.trim() } : extractHtml(raw);
            if (!extracted.content) throw new Error('No readable text');
            return { ok: true, value: { url: url.href, title: extracted.title.slice(0, 500), content: extracted.content.slice(0, 4000) } };
          }
          throw new Error('Too many redirects');
        }, external);
      } catch (error) { return researchFailure(error, '웹페이지 읽기'); }
    },
  };
}
