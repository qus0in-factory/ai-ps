import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedLabel, evaluationSummary, runSummary, stepDetail, stepOutcome, stepTitle, topicProblem, visibleSources } from '../../../../src/ui/widgets/research/research-view.ts';
import type { ResearchStep } from '../../../../src/ui/widgets/research/types.ts';

const search: ResearchStep = { tool: 'search_web', args: { query: '국내 전기차 보조금' }, ok: true };
const read: ResearchStep = { tool: 'read_webpage', args: { url: 'https://example.com/report' }, ok: false };

describe('Given a research topic input', () => {
  it('When it is blank or longer than 200 characters Then explains the 1~200 limit', () => {
    assert.match(topicProblem('') ?? '', /1~200/);
    assert.match(topicProblem('   ') ?? '', /1~200/);
    assert.match(topicProblem('x'.repeat(201)) ?? '', /1~200/);
  });
  it('When it is a normal topic Then there is no problem', () => {
    assert.equal(topicProblem('해양 플라스틱 재활용 동향'), null);
    assert.equal(topicProblem('x'.repeat(200)), null);
  });
});

describe('Given tool calls recorded during research', () => {
  it('When listed Then shows a Korean tool name and its single-line argument', () => {
    assert.equal(stepTitle(search), '웹 검색');
    assert.equal(stepDetail(search), '국내 전기차 보조금');
    assert.equal(stepTitle(read), '페이지 읽기');
    assert.equal(stepDetail(read), 'https://example.com/report');
    assert.equal(stepOutcome(search), '성공');
    assert.equal(stepOutcome(read), '실패');
  });
  it('When an argument contains newlines or is very long Then the visible detail stays short and single-line', () => {
    const messy: ResearchStep = { tool: 'search_web', args: { query: `첫 줄\n둘째 줄 ${'x'.repeat(400)}` }, ok: true };
    const detail = stepDetail(messy);
    assert.doesNotMatch(detail, /[\r\n]/);
    assert.ok(detail.length <= 120);
  });
  it('When the argument is missing Then shows an empty detail instead of throwing', () => {
    assert.equal(stepDetail({ tool: 'search_web', args: {}, ok: true }), '');
    assert.equal(stepDetail({ tool: 'read_webpage', args: { url: 7 }, ok: true }), '');
  });
});

describe('Given research sources', () => {
  it('When listed Then keeps only unique http(s) links and shows the host', () => {
    const sources = visibleSources([
      'https://example.com/a', 'javascript:alert(1)', 'ftp://example.com/file',
      'https://example.com/a', 'not a url', 'http://news.example.org/b',
    ]);
    assert.deepEqual(sources, [
      { url: 'https://example.com/a', host: 'example.com' },
      { url: 'http://news.example.org/b', host: 'news.example.org' },
    ]);
  });
  it('When sources are empty or all invalid Then returns an empty list', () => {
    assert.deepEqual(visibleSources([]), []);
    assert.deepEqual(visibleSources(['javascript:alert(1)']), []);
  });
});

describe('Given a finished research run', () => {
  it('When summarised Then shows iterations and tool calls, with a limit notice when capped', () => {
    assert.equal(runSummary({ steps: [search, read], iterations: 3, capped: false }), '3회 반복 · 도구 2회');
    assert.match(runSummary({ steps: [search], iterations: 10, capped: true }), /한도/);
  });
  it('When elapsed time grows Then shows a minute-aware progress line', () => {
    assert.match(elapsedLabel(0), /조사 중/);
    assert.match(elapsedLabel(5), /5초/);
    assert.match(elapsedLabel(65), /1분 5초/);
    assert.match(elapsedLabel(-1), /0초/);
  });
  it('When evaluation is present Then formats passed and failed feedback summaries', () => {
    assert.match(evaluationSummary({ passed: true, problems: [] }), /통과/);
    assert.match(evaluationSummary({ passed: false, problems: ['출처 누락', '근거 부족'] }), /2건/);
  });
});
