import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTools } from '../../src/infra/tools.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/openweather.json', import.meta.url), 'utf8'));

describe('Given the OpenWeather tool registry', () => {
  it('When requesting city weather Then geocodes and fetches metric Korean weather', async () => {
    const requests: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.searchParams.get('appid'), 'test-key');
      return Response.json(requests.length === 1 ? [fixture.location] : fixture.weather);
    };
    const [tool] = createTools({ apiKey: 'test-key', fetcher });
    assert.equal(tool!.definition.name, 'get_current_weather');
    const result = await tool!.execute({ city: 'Seoul,KR' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.value as { temperature_c: number }).temperature_c, fixture.weather.main.temp);
    }
    assert.equal(requests[0]!.searchParams.get('q'), 'Seoul,KR');
    assert.equal(requests[1]!.searchParams.get('lat'), String(fixture.location.lat));
    assert.equal(requests[1]!.searchParams.get('units'), 'metric');
    assert.equal(requests[1]!.searchParams.get('lang'), 'kr');
  });

  it('When the key or city is missing Then returns an error without network access', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('Must not fetch'); };
    assert.equal((await createTools({ fetcher })[0]!.execute({ city: 'Seoul' })).ok, false);
    assert.equal((await createTools({ apiKey: 'test', fetcher })[0]!.execute({ city: '' })).ok, false);
  });

  it('When OpenWeather fails Then does not expose the key in the tool result', async () => {
    for (const status of [401, 429, 500]) {
      const [tool] = createTools({ apiKey: 'secret-key', fetcher: async () => new Response('error', { status }) });
      const result = await tool!.execute({ city: 'Seoul' });
      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes('secret-key'));
    }
    const [missing] = createTools({ apiKey: 'test', fetcher: async () => Response.json([]) });
    assert.equal((await missing!.execute({ city: 'Unknown' })).ok, false);
  });
});

describe('Given the current time tool', () => {
  it('When registering tools Then exposes current weather and current time', () => {
    assert.deepEqual(createTools({}).map((tool) => tool.definition.name), [
      'get_current_weather', 'get_current_time',
    ]);
  });

  it('When crossing local midnight Then reports the correct Korean date and time', async () => {
    const cases = [
      ['2026-11-16T14:59:59Z', '2026-11-16T23:59:59+09:00'],
      ['2026-11-16T15:00:00Z', '2026-11-17T00:00:00+09:00'],
      ['2026-11-16T15:00:01Z', '2026-11-17T00:00:01+09:00'],
      ['2026-11-16T23:59:59Z', '2026-11-17T08:59:59+09:00'],
      ['2026-11-17T00:00:00Z', '2026-11-17T09:00:00+09:00'],
    ];
    for (const [instant, local] of cases) {
      const date = new Date(instant!);
      const tool = createTools({ now: () => date }).find((tool) => tool.definition.name === 'get_current_time')!;
      assert.deepEqual(await tool.execute({}), {
        ok: true,
        value: { timezone: 'Asia/Seoul', datetime: local, utc: date.toISOString(), unix_seconds: Math.floor(date.getTime() / 1000) },
      });
    }
  });

  it('When called again Then reads the clock again without using the previous time', async () => {
    let timestamp = Date.parse('2026-11-16T15:00:00Z');
    const tool = createTools({ now: () => new Date(timestamp) }).find((tool) => tool.definition.name === 'get_current_time')!;
    const first = await tool.execute({});
    timestamp += 1000;
    const second = await tool.execute({});
    assert.notDeepEqual(first, second);
  });
});
