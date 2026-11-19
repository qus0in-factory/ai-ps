import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { completion, createOpenAIClient } from '../../src/infra/openai.ts';

// 실모델 3건. 같은 요청을 연속 2회 보내 2회차 캐시 적중 토큰을 측정한다(사례별 수치만 기록, 본문·키 미기록).
if (existsSync('.env')) loadEnvFile('.env');
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());

// 고정 접두부 상수(반복 문단으로 늘리지 않음). 앞 1,200자는 짧은 접두부 사례에서 다시 쓴다.
const FIXED_PREFIX = `The municipal archive opened in a converted tram depot in the spring of 1983. Its founders were three retired teachers and a printer who between them owned two typewriters, a shelf of cardboard boxes, and a stubborn belief that the small notices in old newspapers deserved to survive. They began by cutting out columns with scissors, mounting each clipping on paper, and writing a careful index in pencil. The first catalogue filled a single notebook. Within a decade it had grown to twelve volumes, and the volunteers had learned to read the faded ink of the nineteen twenties without squinting.
Visitors in those early years were mostly students writing local history papers and descendants trying to locate the address of a vanished family shop. The rules were simple and strictly enforced: nothing left the reading room, pencils only, and every request had to be written on a slip with a date and a signature. The head librarian kept a ledger of all slips, partly to track demand and partly because she enjoyed the ritual. On quiet afternoons the depot smelled of dust and old glue, and the only sound was the turning of pages.
Digitisation began in 1997 with a donated scanner that was slower than a patient clerk. The team photographed the collection in batches, always keeping the original clippings in their boxes until a second volunteer had checked the image against the source. Errors were common at first: a stray crease could swallow a line of text, and the optical reader confused certain letters in the German-language pages. Rather than trust the machine, the archive adopted a habit of double entry, in which two people transcribed the same notice independently and a third settled any disagreement.
By 2004 the catalogue had moved to a database running on a machine in the town hall basement. The move was controversial. Several volunteers feared that a search box would make the index feel less personal, while others argued that a catalogue nobody could search was a catalogue nobody used. The compromise was to keep the paper notebooks on display beside a single terminal, so that visitors could compare the old hand with the new screen. That terminal is still there, though its screen has been replaced twice.
The archive's most requested holdings are not grand documents but ordinary ones: theatre programmes, shipping schedules, dance advertisements, and the minutes of a hiking club that met every Thursday for forty years. Researchers value these because they record what people actually did rather than what officials planned. A single programme can reveal the price of a seat, the name of a forgotten performer, and the fact that a concert was cancelled and replaced by a lecture on bicycle safety. Such details rarely appear in a formal history.
Preservation is a continuous negotiation with chemistry. Newsprint from the war years is brittle and acidic, and the paper from the nineteen fifties tends to yellow at the edges. The conservators keep the collection in a room with stable humidity, wrap the most fragile items in acidic-free folders, and freeze a few of the worst cases to slow decay. They have learned that handling causes more damage than time, so the reading room now uses foam cradles and soft weights for anything that will not lie flat.
Funding has never been secure. The archive survives on a small municipal grant, the proceeds of an annual book sale, and the occasional donation from a family clearing an attic. Every winter the volunteers write letters to the council explaining why the collection matters, and every spring they receive a slightly smaller budget than they asked for. They have adapted by doing most work themselves: cataloguing, cleaning, answering letters, and guiding school groups through the depot in pairs.
The volunteer rota is posted on a corkboard near the entrance. It lists names, days, and a short note about each person's specialty, such as handwritten scripts, maps, or the old photo negatives. Newcomers are paired with someone patient for their first three shifts, because the catalogue has quirks that no manual explains. A note filed under a person's surname may actually be under the name of the shop they ran, and a place can appear under an older spelling that nobody uses today. Learning these habits takes time and a certain tolerance for surprise.
Outreach changed the archive more than any technology. A teacher asked whether the collection could supply material for a lesson about daily life during a long strike, and the volunteers assembled a box of posters, menus, and letters that filled an entire afternoon. That box became the first of many theme sets, now borrowed by schools across the region. Each set travels with a short guide written in plain language, explaining what the items are, where they came from, and which questions they might help a student answer. The guide deliberately avoids giving conclusions.
The depot is not open every day, and the volunteers are careful to say so. They would rather turn a visitor away with a clear explanation than promise a service they cannot staff. Appointments are recommended for anyone planning a serious search, especially if the material needed is likely to be in the boxes that have not yet been catalogued. Those boxes are labelled by decade and by donor, and a patient reader can still find things there that no database knows about. The staff call them the unsorted shelves and treat them as a reminder that a catalogue is never finished.
Last year the archive marked its fortieth anniversary with an exhibition of forty notices, one from each year, chosen because each seemed ordinary at the time. The oldest was a lost-and-found advertisement for a single umbrella. The newest was a notice about a community meeting to discuss a new bus route. Between them lay strikes, floods, elections, and a great many concerts that nobody now remembers, preserved because someone once thought a small printed notice was worth cutting out and keeping.
The volunteers say the collection teaches a useful lesson about attention. A newspaper is designed to be read once and discarded, yet the very same pages can become a record of a place when someone takes the trouble to save them. The index is an act of patience repeated across generations: one pencil entry at a time, one corrected date at a time, until a shelf of boxes becomes something that can answer a question. The work is slow, unglamorous, and, by the measure of the students who come through the door each week, entirely worth the trouble.`;

interface CallMetrics {
  status: string;
  promptTokens: number | null;
  cachedTokens: number | null;
  ms: number;
}

interface Pair {
  first: CallMetrics;
  second: CallMetrics;
}

function metrics(result: Awaited<ReturnType<typeof completion>>, ms: number): CallMetrics {
  if (!result.ok) {
    return { status: result.reason.match(/HTTP (\d+)/)?.[1] ?? 'error', promptTokens: null, cachedTokens: null, ms };
  }
  const usage = result.value.usage as { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
  return {
    status: '200',
    promptTokens: usage?.prompt_tokens ?? null,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
    ms,
  };
}

async function twice(prefix: string, cacheKey?: string): Promise<Pair> {
  const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL });
  const send = () => completion({
    model: process.env.OPENAI_MODEL!,
    messages: [
      { role: 'system', content: prefix },
      { role: 'user', content: '한 문장으로 요약하세요.' },
    ],
    max_completion_tokens: 16,
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
  }, { client, logErrors: false });
  const startedFirst = performance.now();
  const firstResult = await send();
  const first = metrics(firstResult, Math.round(performance.now() - startedFirst));
  const startedSecond = performance.now();
  const secondResult = await send();
  const second = metrics(secondResult, Math.round(performance.now() - startedSecond));
  return { first, second };
}

function report(t: { diagnostic: (message: string) => void }, name: string, pair: Pair) {
  const { first, second } = pair;
  t.diagnostic(`cache-key-eval ${name}: 1st(prompt=${first.promptTokens}, cached=${first.cachedTokens}, ms=${first.ms}, status=${first.status}) 2nd(prompt=${second.promptTokens}, cached=${second.cachedTokens}, ms=${second.ms}, status=${second.status})`);
}

describe('Given a live model and a fixed prompt prefix', () => {
  it('When a 1,500-token prefix with a cache key is sent twice Then the second call reports cached tokens', { skip: !live, timeout: 180_000 }, async t => {
    const pair = await twice(FIXED_PREFIX, 'ai-ps:eval');
    report(t, 'fixed-1500-key', pair);
    assert.equal(pair.first.status, '200', `first call failed: ${pair.first.status}`);
    assert.equal(pair.second.status, '200', `second call failed: ${pair.second.status}`);
    assert.ok((pair.second.cachedTokens ?? 0) > 0, 'second call must report cached tokens');
  });

  it('When the same prefix is sent twice without a key Then both calls are recorded for comparison', { skip: !live, timeout: 180_000 }, async t => {
    const pair = await twice(FIXED_PREFIX);
    report(t, 'fixed-1500-nokey', pair);
    assert.equal(pair.first.status, '200', `first call failed: ${pair.first.status}`);
    assert.equal(pair.second.status, '200', `second call failed: ${pair.second.status}`);
  });

  it('When a 300-token prefix with a cache key is sent twice Then both calls are recorded', { skip: !live, timeout: 180_000 }, async t => {
    const pair = await twice(FIXED_PREFIX.slice(0, 1_200), 'ai-ps:eval');
    report(t, 'short-300-key', pair);
    assert.equal(pair.first.status, '200', `first call failed: ${pair.first.status}`);
    assert.equal(pair.second.status, '200', `second call failed: ${pair.second.status}`);
  });
});
