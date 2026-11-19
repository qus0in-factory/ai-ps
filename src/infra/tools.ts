import type { Tool } from '../domain/tools.ts';
import type { QueensOperations } from '../domain/queens/types.ts';
import { fetchWithRetry } from './http-client.ts';
import { createQueensTools } from './queens-tools.ts';

export function createTools(
  { apiKey, fetcher = fetchWithRetry, now = () => new Date(), queens }: {
    apiKey?: string;
    fetcher?: typeof fetch;
    now?: () => Date;
    queens?: QueensOperations;
  },
): Tool[] {
  return [{
    definition: {
      name: 'get_current_weather',
      description: 'Get current weather from OpenWeatherMap. Not a forecast. Use for current weather questions. Ask for the city if unknown. Pass the city in English with an ISO country code when known, e.g. Seoul,KR.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name and optional country code, e.g. Seoul,KR' } },
        required: ['city'],
        additionalProperties: false,
      },
    },
    effect: 'read',
    async execute(args) {
      if (!args || typeof args !== 'object' || !('city' in args) ||
          typeof args.city !== 'string' || !args.city.trim()) {
        return { ok: false, reason: '날씨를 조회할 도시명을 입력해주세요.' };
      }
      if (!apiKey?.trim()) return { ok: false, reason: 'OWM_API_KEY를 .env에 설정해주세요.' };
      try {
        const geo = new URL('https://api.openweathermap.org/geo/1.0/direct');
        geo.search = new URLSearchParams({ q: args.city.trim(), limit: '1', appid: apiKey }).toString();
        const locationResponse = await fetcher(geo, { signal: AbortSignal.timeout(15_000) });
        if (!locationResponse.ok) {
          return { ok: false, reason: `OpenWeatherMap 위치 조회 실패 (${locationResponse.status})` };
        }
        const locations = await locationResponse.json();
        const location = Array.isArray(locations) ? locations[0] : undefined;
        if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
          return { ok: false, reason: '도시를 찾지 못했습니다. 도시명과 국가를 확인해주세요.' };
        }
        const url = new URL('https://api.openweathermap.org/data/2.5/weather');
        url.search = new URLSearchParams({
          lat: String(location.lat), lon: String(location.lon),
          appid: apiKey, units: 'metric', lang: 'kr',
        }).toString();
        const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return { ok: false, reason: `OpenWeatherMap 날씨 조회 실패 (${response.status})` };
        const data = await response.json();
        if (!Number.isFinite(data.main?.temp) || typeof data.weather?.[0]?.description !== 'string') {
          return { ok: false, reason: '날씨 응답을 읽지 못했습니다.' };
        }
        return { ok: true, value: {
          source: 'OpenWeatherMap',
          city: location.name,
          country: location.country,
          description: data.weather[0].description,
          temperature_c: data.main.temp,
          feels_like_c: data.main.feels_like,
          humidity_percent: data.main.humidity,
          wind_speed_m_s: data.wind?.speed,
          observed_at_unix: data.dt,
        } };
      } catch {
        // Network errors may contain the request URL, including the API key.
        return { ok: false, reason: 'OpenWeatherMap에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
      }
    },
  }, {
    definition: {
      name: 'get_current_time',
      description: 'Get the current date and time in Asia/Seoul (Korean Standard Time), along with UTC. Call this when the user asks for the current time or date.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    effect: 'read',
    async execute() {
      try {
        const date = now();
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Seoul',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
        return { ok: true, value: {
          timezone: 'Asia/Seoul',
          datetime: `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+09:00`,
          utc: date.toISOString(),
          unix_seconds: Math.floor(date.getTime() / 1000),
        } };
      } catch {
        return { ok: false, reason: '현재 시간을 조회하지 못했습니다.' };
      }
    },
  }, ...(queens ? createQueensTools(queens) : [])];
}
