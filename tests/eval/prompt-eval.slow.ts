import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createTutor } from '../../src/app/talk/tutor.ts';
import { createSession as createTalkSession } from '../../src/domain/talk/session.ts';
import { createGameMaster } from '../../src/app/adventure/game-master.ts';
import type { AdventureEvent, AppliedChanges } from '../../src/domain/adventure/types.ts';
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
      if (started.ok) {
        const locationBefore = started.value.state.location;
        const applied: AppliedChanges[] = [];
        const narratives: string[] = [];
        const result = await gm.turn(started.value, entry.action, (event: AdventureEvent) => {
          if (event.kind === 'state') applied.push(event.applied);
          if (event.kind === 'narrative') narratives.push(event.text);
        });
        pass = result.ok && narratives.length > 0 && narratives.every(text =>
          text.includes('당신은') && !INTERNAL_IDS.test(text));
        if (pass && entry.impossible) {
          pass = applied.length > 0 && applied.every(change =>
            change.added.length === 0 && change.removed.length === 0 && change.repaired.length === 0) &&
            result.ok && result.value.state.location === locationBefore;
        }
      }
      t.diagnostic(`prompt-eval adventure ${entry.n}: ${pass ? 'pass' : 'fail'}`);
      assert.equal(pass, true, `adventure case ${entry.n} failed the code-only checks`);
    });
  }
});
