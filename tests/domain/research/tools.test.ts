import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSearchResults,
  formatToolError,
  formatUnknownTool,
  READ_WEBPAGE_TOOL,
  SEARCH_WEB_TOOL,
  truncateWebpage,
  type SearchHit,
} from '../../../src/domain/research/tools.ts';

function properties(definition: { parameters: Record<string, unknown> }): Record<string, Record<string, unknown>> {
  const parameters = definition.parameters as { properties: Record<string, Record<string, unknown>> };
  return parameters.properties;
}

describe('Given the /research agent needs two web tools', () => {
  it('When declaring search_web Then the schema takes a query and documents max_results defaulting to 5', () => {
    assert.equal(SEARCH_WEB_TOOL.name, 'search_web');
    const properties_ = properties(SEARCH_WEB_TOOL);
    assert.equal(properties_.query?.type, 'string');
    assert.deepEqual((SEARCH_WEB_TOOL.parameters as { required: string[] }).required, ['query']);
    assert.match(String(properties_.max_results?.description), /기본값\s*5/);
    assert.equal(SEARCH_WEB_TOOL.parameters.type, 'object');
  });

  it('When declaring search_web Then the description explains what it returns and when to call it', () => {
    assert.match(SEARCH_WEB_TOOL.description, /검색/);
    assert.match(SEARCH_WEB_TOOL.description, /read_webpage/);
    assert.match(SEARCH_WEB_TOOL.description, /제목·주소·요약/);
  });

  it('When declaring read_webpage Then the schema takes a required url and the description relates it to search_web', () => {
    assert.equal(READ_WEBPAGE_TOOL.name, 'read_webpage');
    assert.equal(properties(READ_WEBPAGE_TOOL).url?.type, 'string');
    assert.deepEqual((READ_WEBPAGE_TOOL.parameters as { required: string[] }).required, ['url']);
    assert.match(READ_WEBPAGE_TOOL.description, /search_web/);
    assert.match(READ_WEBPAGE_TOOL.description, /4000자/);
  });

  it('When formatting search hits for the model Then each hit shows title, address, and summary', () => {
    const hits: SearchHit[] = [
      { title: '클라우드플레어 워커란', url: 'https://example.com/workers', summary: '워커 실행 방식 소개' },
      { title: '두 번째 글', url: 'https://example.com/second', summary: '후속 글 요약' },
    ];
    const text = formatSearchResults(hits);
    assert.match(text, /1\. 클라우드플레어 워커란/);
    assert.ok(text.includes('주소: https://example.com/workers'));
    assert.ok(text.includes('요약: 워커 실행 방식 소개'));
    assert.match(text, /2\. 두 번째 글/);
  });

  it('When a search summary is long Then the model receives at most 300 characters of it', () => {
    const text = formatSearchResults([{ title: '긴 글', url: 'https://example.com/long', summary: '가'.repeat(500) }]);
    assert.ok(text.includes('요약: ' + '가'.repeat(300)));
    assert.ok(!text.includes('가'.repeat(301)));
  });

  it('When a search returns no hits Then the model gets a no-results phrase, not an empty string', () => {
    assert.equal(formatSearchResults([]), '검색 결과가 없습니다. 다른 검색어로 다시 시도해보세요.');
  });

  it('When a page body fits within the limit Then truncation keeps it unchanged', () => {
    const body = 'a'.repeat(4000);
    assert.equal(truncateWebpage(body), body);
    assert.equal(truncateWebpage('짧은 본문'), '짧은 본문');
  });

  it('When a page body exceeds 4000 characters Then truncation cuts it and appends an omission notice', () => {
    const body = 'b'.repeat(4001);
    const text = truncateWebpage(body);
    assert.ok(text.startsWith('b'.repeat(4000)));
    assert.ok(!text.startsWith(body));
    assert.match(text, /생략/);
  });

  it('When a tool call fails Then the model receives guidance strings, never exceptions', () => {
    const read = formatToolError('read_webpage', 'HTTP 404');
    assert.match(read, /다른 페이지를 시도해보세요/);
    assert.ok(read.includes('HTTP 404'));
    const search = formatToolError('search_web', 'HTTP 429');
    assert.match(search, /다시 시도해보세요/);
    assert.ok(search.includes('HTTP 429'));
  });

  it('When a tool fails without a reason Then the guidance string has no empty parentheses', () => {
    assert.ok(!formatToolError('read_webpage', '').includes('()'));
    assert.doesNotThrow(() => formatToolError('search_web', ''));
  });

  it('When the model calls an unknown tool Then the guidance string names the two allowed tools', () => {
    assert.match(formatUnknownTool('browse'), /search_web/);
    assert.match(formatUnknownTool('browse'), /read_webpage/);
    assert.ok(formatUnknownTool('browse').includes('browse'));
  });
});
