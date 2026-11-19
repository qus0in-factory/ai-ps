import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createTutor } from '../../src/app/talk/tutor.ts';
import { createSession as createTalkSession } from '../../src/domain/talk/session.ts';
import { createGameMaster } from '../../src/app/adventure/game-master.ts';
import type { AdventureEvent, AppliedChanges } from '../../src/domain/adventure/types.ts';
import { createPlanExecuteChat } from '../../src/app/plan-execute-chat.ts';
import type { Tool } from '../../src/domain/tools.ts';
import { buildReportMessages } from '../../src/domain/research/prompt.ts';
import { createOpenAIClient, createOpenAICompletion } from '../../src/infra/openai.ts';

// 실모델 10건(talk 5 · adventure 5). 판정은 코드만, 사례마다 pass|fail만 기록한다(응답 본문·키 미기록).
if (existsSync('.env')) loadEnvFile('.env');
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());

function model() {
  const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL });
  return createOpenAICompletion({
    client, model: process.env.OPENAI_MODEL, fallbackModel: process.env.OPENAI_FALLBACK_MODEL, logErrors: false,
  });
}

const talkCases = [
  { n: 1, text: '昨日、公園に行きます。', corrected: true },
  { n: 2, text: '私は学生がです。', corrected: true },
  { n: 3, text: 'これはペンがあります。', corrected: true },
  { n: 4, text: '今日はいい天気ですね。', corrected: false },
  { n: 5, text: '来週、友達と映画を見ます。', corrected: false },
];

describe('Given a live model and learner Japanese utterances', () => {
  for (const entry of talkCases) {
    it(`When talk case ${entry.n} is answered Then correction and reply constraints are checked`, { skip: !live, timeout: 180_000 }, async t => {
      const result = await createTutor(model()).respond(createTalkSession(), entry.text);
      let pass = result.ok;
      if (result.ok) {
        const reply = result.value.reply;
        pass = (entry.corrected ? result.value.correction !== null : result.value.correction === null) &&
          !/[가-힣]/.test(reply) && !/[A-Za-z]/.test(reply) && Array.from(reply).length <= 120;
      }
      t.diagnostic(`prompt-eval talk ${entry.n}: ${pass ? 'pass' : 'fail'}`);
      assert.equal(pass, true, `talk case ${entry.n} failed the code-only checks`);
    });
  }
});

const adventureCases = [
  { n: 1, action: '맨손으로 바위를 부순다', impossible: true },
  { n: 2, action: '마법으로 등실까지 순간이동한다', impossible: true },
  { n: 3, action: '숙소를 둘러본다', impossible: false },
  { n: 4, action: '담요를 덮고 쉰다', impossible: false },
  { n: 5, action: '절벽 길을 탐색한다', impossible: false },
];
const INTERNAL_IDS = /(spare-lens|clock-spring|lamp-oil|driftwood|matches)/;

describe('Given a live model and adventure actions', () => {
  for (const entry of adventureCases) {
    it(`When adventure case ${entry.n} is played Then narrative and applied changes are checked`, { skip: !live, timeout: 300_000 }, async t => {
      const gm = createGameMaster(model());
      const started = await gm.start();
      let pass = started.ok;
      let reason = '';
      if (started.ok) {
        const locationBefore = started.value.state.location;
        const applied: AppliedChanges[] = [];
        const narratives: string[] = [];
        const result = await gm.turn(started.value, entry.action, (event: AdventureEvent) => {
          if (event.kind === 'state') applied.push(event.applied);
          if (event.kind === 'narrative') narratives.push(event.text);
        });
        const narrativeOk = result.ok && narratives.length > 0 && narratives.every(text =>
          text.includes('당신은') && !INTERNAL_IDS.test(text));
        if (!narrativeOk) {
          reason = narratives.some(text => INTERNAL_IDS.test(text)) ? 'ids' : 'narrative';
        }
        pass = narrativeOk;
        if (pass && entry.impossible) {
          const appliedOk = applied.length > 0 && applied.every(change =>
            change.added.length === 0 && change.removed.length === 0 && change.repaired.length === 0);
          const locationOk = result.ok && result.value.state.location === locationBefore;
          if (!appliedOk) reason = 'applied';
          else if (!locationOk) reason = 'location';
          pass = appliedOk && locationOk;
        }
      } else {
        reason = 'narrative';
      }
      t.diagnostic(`prompt-eval adventure ${entry.n}: ${pass ? 'pass' : 'fail'}${pass ? '' : ` (${reason})`}`);
      assert.equal(pass, true, `adventure case ${entry.n} failed the code-only checks`);
    });
  }
});

const TEMPERATURES: Record<string, number> = {
  seoul: 3, 부산: 9, busan: 9, 도쿄: 12, tokyo: 12, 제주: 15, jeju: 15, 뉴욕: -2, ny: -2,
};

function weatherTools() {
  let calls = 0;
  const temperatureOf = (city: string): number | undefined => {
    const value = city.toLowerCase();
    if (value.includes('서울') || value.includes('seoul')) return TEMPERATURES.seoul;
    if (value.includes('부산') || value.includes('busan')) return TEMPERATURES.busan;
    if (value.includes('도쿄') || value.includes('tokyo')) return TEMPERATURES.tokyo;
    if (value.includes('제주') || value.includes('jeju')) return TEMPERATURES.jeju;
    if (value.includes('뉴욕') || value.includes('new york') || value.includes('ny')) return TEMPERATURES['뉴욕'];
    return undefined;
  };
  const cityParameter = {
    type: 'object', properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'], additionalProperties: false,
  } as const;
  const weather: Tool = {
    definition: { name: 'get_current_weather', description: '현재 도시의 섭씨 기온을 돌려준다.', parameters: cityParameter },
    effect: 'read',
    async execute(args) {
      calls++;
      const city = String((args as { city?: unknown }).city ?? '');
      const temperature_c = temperatureOf(city);
      return temperature_c === undefined ? { ok: false, reason: '도시를 찾을 수 없습니다.' } : { ok: true, value: { city, temperature_c } };
    },
  };
  const time: Tool = {
    definition: { name: 'get_current_time', description: '도시의 현재 시각을 돌려준다.', parameters: cityParameter },
    effect: 'read',
    async execute() { calls++; return { ok: true, value: { time: '12:00' } }; },
  };
  return { tools: [weather, time], calls: () => calls };
}

const chatCases = [
  { n: 1, question: '서울과 부산의 현재 기온을 비교해 주세요.', temps: [3, 9], greeting: false },
  { n: 2, question: '도쿄와 제주의 현재 기온을 비교해 주세요.', temps: [12, 15], greeting: false },
  { n: 3, question: '부산과 제주의 현재 기온을 비교해 주세요.', temps: [9, 15], greeting: false },
  { n: 4, question: '뉴욕의 현재 기온을 알려 주세요.', temps: [-2], greeting: false },
  { n: 5, question: '안녕하세요.', temps: [], greeting: true },
];

describe('Given a live model and a plan-execute chat with fake tools', () => {
  for (const entry of chatCases) {
    it(`When chat case ${entry.n} is answered Then tool results appear in the reply`, { skip: !live, timeout: 300_000 }, async t => {
      const { tools, calls } = weatherTools();
      const result = await createPlanExecuteChat(model(), tools).complete([{ role: 'user', content: entry.question }]);
      let pass = result.ok;
      if (result.ok) {
        const answer = result.value;
        pass = entry.greeting
          ? calls() === 0
          : entry.temps.every(temp => answer.includes(String(temp)) || (temp < 0 && answer.includes(String(Math.abs(temp)))));
      }
      t.diagnostic(`prompt-eval chat ${entry.n}: ${pass ? 'pass' : 'fail'}`);
      assert.equal(pass, true, `chat case ${entry.n} failed the code-only checks`);
    });
  }
});

const researchCases = [
  {
    n: 1, topic: '도시 나무와 폭염 완화', notes: `도시 열섬은 포장면과 건물이 낮에 저장한 열을 밤에 방출해 생긴다. 한 관측에서 여름철 공원 주변은 인근 상업지구보다 낮 최고기온이 최대 2도 낮았다. https://example.org/urban-heat
나무 수관은 그늘을 만들고 증발산으로 주변 공기를 식힌다. 수관 피복률이 10% 높아질수록 보행로 체감온도가 약 1도 낮아졌다는 보고가 있다. https://example.org/tree-canopy
다만 수종 선택이 중요하다. 물을 많이 쓰는 수종은 건조한 도시에서 유지비가 커지므로 내건성 수종을 함께 심는 권고가 있다. https://example.org/species-choice`,
  },
  {
    n: 2, topic: '해안 습지와 폭풍 피해', notes: `갯벌과 염생습지는 파도의 에너지를 흡수해 해안선으로 전달되는 폭풍해일의 높이를 낮춘다. 폭 100미터의 습지가 해일 높이를 약 20% 줄였다는 측정이 있다. https://example.org/wetland-surge
습지는 유속을 늦춰 퇴적물을 쌓고, 침식으로 잃은 해안을 서서히 회복시킨다. 다만 퇴적 속도가 해수면 상승 속도보다 느리면 보호 기능이 약해진다. https://example.org/wetland-sediment
최근 연구는 습지 복원과 인공 구조물을 함께 쓸 때 비용 대비 효과가 가장 크다고 정리한다. 단일 대안만으로는 극한 폭풍을 막기 어렵다. https://example.org/coast-mix`,
  },
  {
    n: 3, topic: '자전거 도로와 통학 안전', notes: `보도와 분리된 자전거 도로가 설치된 구간에서 어린이 통학 중 사고율이 유의하게 낮아졌다. 분리만으로도 차량과의 접촉 기회가 크게 줄어든다. https://example.org/bike-separation
교차로의 전용 신호와 높인 횡단보도는 자전거 이용자의 사고 위험을 낮추지만, 인접 도로의 체류 시간을 늘릴 수 있다. https://example.org/bike-crossing
도시별 비교에서는 도로 길이보다 연결성이 중요했다. 끊긴 구간이 많은 네트워크는 이용률이 낮아 안전 효과도 작았다. https://example.org/bike-network`,
  },
  {
    n: 4, topic: '공공도서관의 지역 사회 역할', notes: `공공도서관은 도서 대출 외에 취업 지원, 디지털 교육, 아동 돌봄 프로그램을 제공한다. 이용자 조사에서 프로그램 참여가 방문 빈도를 높이는 요인으로 나타났다. https://example.org/library-programs
도서관의 열람 공간은 주거 공간이 좁은 가구에게 학습 환경을 제공한다. 조용한 좌석과 안정적인 인터넷이 핵심 자원으로 꼽힌다. https://example.org/library-space
지자체 보고서는 도서관 운영비의 상당 부분이 인건비라고 적는다. 프로그램 확대에는 지속적인 인력 확보가 필요하다. https://example.org/library-cost`,
  },
  {
    n: 5, topic: '재사용 컵의 탄소 발자국', notes: `재사용 컵은 일회용 컵보다 제조 시 더 많은 자원을 쓰지만, 여러 번 사용하면 회당 배출량이 낮아진다. 손익분기점은 컵 종류와 세척 방식에 따라 달라진다. https://example.org/cup-lca
세척에 쓰는 물과 전기의 양이 총 배출량에 큰 영향을 준다. 뜨거운 물로 매번 세척하면 이점이 줄어든다. https://example.org/cup-washing
일부 연구는 이용자가 컵을 잊어버려 회당 사용 횟수가 예상보다 적으면 재사용의 이점이 사라진다고 지적한다. https://example.org/cup-behavior`,
  },
];

function urls(text: string): Set<string> {
  const found = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  return new Set(found.map(url => url.replace(/[.,;:)\]]+$/, '')));
}

describe('Given a live model and fixed research notes', () => {
  for (const entry of researchCases) {
    it(`When research case ${entry.n} is reported Then every cited URL comes from the notes`, { skip: !live, timeout: 180_000 }, async t => {
      const result = await model().complete(buildReportMessages(entry.topic, entry.notes));
      let pass = result.ok;
      if (result.ok) {
        const report = result.value.content ?? '';
        const allowed = urls(entry.notes);
        pass = [...urls(report)].every(url => allowed.has(url)) && report.trim().length >= 200;
      }
      t.diagnostic(`prompt-eval research ${entry.n}: ${pass ? 'pass' : 'fail'}`);
      assert.equal(pass, true, `research case ${entry.n} failed the code-only checks`);
    });
  }
});
