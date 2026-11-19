import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
import { runResearch, writeReport } from '../../src/app/research/agent.ts';
import type { ResearchAgentPorts } from '../../src/app/research/ports.ts';
import { checkCitations, checkEffort } from '../../src/domain/research/checks.ts';
import { buildRubricMessages, parseRubric, RUBRIC_FORMAT } from '../../src/domain/research/rubric.ts';
import type { EvalCase } from '../../src/domain/research/regression.ts';
import { compareEvalRuns } from '../../src/domain/research/regression.ts';
import { budget } from '../../src/domain/token-budget.ts';
import { createBraveSearch } from '../../src/infra/research-brave-search.ts';
import { createNcpSearch } from '../../src/infra/research-ncp-search.ts';
import { createMergedResearchSearch } from '../../src/infra/research-merged-search.ts';
import { createResearchWebReader } from '../../src/infra/research-web-reader.ts';
import { createOpenAIClient, createOpenAICompletion } from '../../src/infra/openai.ts';

// 책 10.5의 고정 주제. 실모델 평가는 요청 시에만 돌고, 통과 여부는 기록만 한다(단정 금지).
const EVAL_TOPICS = [
  '중소 개발팀의 AI 코딩 도구 도입 효과',
  '전기차 배터리 재활용 기술의 현황',
  '원격 근무가 신입 개발자 성장에 미치는 영향',
] as const;

if (existsSync('.env')) loadEnvFile('.env');
// vite.config.ts·deploy 스크립트와 같은 별칭(.env의 하이픈 이름 → Worker 변수명).
const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || process.env['BRAVE-SEARCH-API-KEY']?.trim();
const ncpId = process.env.NCP_API_KEY_ID?.trim() || process.env['X-NCP-APIGW-API-KEY-ID']?.trim();
const ncpKey = process.env.NCP_API_KEY?.trim() || process.env['X-NCP-APIGW-API-KEY']?.trim();
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim() && (braveKey || ncpId && ncpKey));
const runs = Math.max(1, Number(process.env.RESEARCH_EVAL_RUNS) || 1);

interface EvalRecord extends EvalCase {
  effort: { passed: boolean; searches: number; reads: number };
  unread: number;
}

const codePassed = (entry: EvalCase): boolean => entry.citations.passed && entry.effort.passed;

function ports() {
  const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL });
  const gateway = createOpenAICompletion({ client, model: process.env.OPENAI_MODEL, logErrors: false, strictTools: false });
  let modelCalls = 0;
  let searches = 0;
  const hasBrave = Boolean(braveKey);
  const hasNcp = Boolean(ncpId && ncpKey);
  const search = createMergedResearchSearch([
    ...(braveKey ? [createBraveSearch({ apiKey: braveKey })] : []),
    ...(ncpId && ncpKey ? [createNcpSearch({ apiKeyId: ncpId, apiKey: ncpKey })] : []),
  ]);
  const allowedHosts = new Set<string>();
  const reader = createResearchWebReader({ allowedHosts, allowIpLiterals: false });
  const agentPorts: ResearchAgentPorts = {
    model: {
      complete: (messages, tools, options) => { modelCalls++; return gateway.complete(messages, tools, options); },
    },
    search: async (query, maxResults) => {
      searches++;
      const result = await search.search(query, maxResults);
      if (!result.ok) return result;
      for (const hit of result.value) {
        try { allowedHosts.add(new URL(hit.url).hostname.replace(/\.$/, '')); } catch { /* 잘못된 URL은 무시 */ }
      }
      return { ok: true, value: result.value.map(({ title, url, description }) => ({ title, url, summary: description })) };
    },
    read: async url => {
      const result = await reader.read(url);
      return result.ok ? { ok: true, value: `제목: ${result.value.title || result.value.url}\n주소: ${result.value.url}\n\n${result.value.content}` } : result;
    },
  };
  return { agentPorts, gateway, counts: () => ({ modelCalls, searches }) };
}

describe('Given a live research eval suite', () => {
  it('When the fixed topics are evaluated Then checks and rubric scores are recorded', { skip: !live, timeout: 600_000 }, async t => {
    const started = Date.now();
    const allRuns: EvalRecord[][] = [];
    let lastCounts = { modelCalls: 0, searches: 0 };

    for (let run = 1; run <= runs; run++) {
      const { agentPorts, gateway, counts } = ports();
      const records: EvalRecord[] = [];
      for (const topic of EVAL_TOPICS) {
        const loop = await runResearch(agentPorts, topic);
        assert.equal(loop.ok, true, loop.ok ? '' : `runResearch: ${loop.reason}`);
        if (!loop.ok) return;
        const written = await writeReport(agentPorts, topic, loop.value.notes);
        assert.equal(written.ok, true, written.ok ? '' : `writeReport: ${written.reason}`);
        if (!written.ok) return;

        const citations = checkCitations(written.value, loop.value.steps);
        const effort = checkEffort(loop.value.steps);
        const judged = await gateway.complete(buildRubricMessages(topic, loop.value.notes, written.value), [], {
          temperature: 0, reasoning_effort: 'none', response_format: RUBRIC_FORMAT, ...budget('researchEval'),
        });
        const parsed = judged.ok ? parseRubric(judged.value.content ?? '') : { ok: false as const, reason: judged.ok ? '' : judged.reason };
        assert.equal(parsed.ok, true, parsed.ok ? '' : `rubric: ${parsed.reason}`);
        if (!parsed.ok) return;

        t.diagnostic(`[${topic}] 인용 검증: ${citations.passed ? '통과' : '실패'}(${citations.unread.length}건)`);
        t.diagnostic(`[${topic}] 조사 성실성: ${effort.passed ? '통과' : '실패'} (검색 ${effort.searches}회, 읽기 ${effort.reads}회)`);
        t.diagnostic(`[${topic}] 루브릭: 근거 ${parsed.value.grounded}, 구성 ${parsed.value.structured}, 명료 ${parsed.value.clear}`);
        // 기준선에는 자유 문장(reasons)·본문·URL을 넣지 않는다(점수만).
        records.push({ topic, citations: { passed: citations.passed }, effort: { passed: effort.passed,
          searches: effort.searches, reads: effort.reads },
        scores: { grounded: parsed.value.grounded, structured: parsed.value.structured, clear: parsed.value.clear, reasons: '' },
        unread: citations.unread.length });
      }
      allRuns.push(records);
      lastCounts = counts();
    }

    const candidate = allRuns.at(-1)!;
    for (const topic of EVAL_TOPICS) {
      const passed = allRuns.filter(records => records.some(record => record.topic === topic && codePassed(record))).length;
      t.diagnostic(`통과율 ${topic}: ${passed}/${runs}`);
    }
    t.diagnostic(`research-eval totals: ms=${Date.now() - started} 모델 호출=${lastCounts.modelCalls}회 검색=${lastCounts.searches}회`);

    const out = process.env.RESEARCH_EVAL_OUT?.trim();
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(candidate) + '\n');
      t.diagnostic(`research-eval baseline written: ${out}`);
    }

    const baselinePath = process.env.RESEARCH_EVAL_BASELINE?.trim();
    if (baselinePath) {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalCase[];
      for (const comparison of compareEvalRuns(baseline, candidate)) {
        if (comparison.verdict === 'regression') t.diagnostic(`회귀 발견: ${comparison.topic}`);
        if (comparison.verdict === 'improvement') t.diagnostic(`개선: ${comparison.topic}`);
      }
      const regressions = compareEvalRuns(baseline, candidate).filter(item => item.verdict === 'regression');
      assert.equal(regressions.length, 0, `회귀 ${regressions.length}건`);
    }
  });
});
