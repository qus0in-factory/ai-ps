import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';

// The policy for RequestInit literals is documented in docs/providers.md.
const FORBIDDEN = new Set(['integrity', 'keepalive', 'priority']);

function violations(source: string) {
  const hits: string[] = [];
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('type' in value && value.type === 'ObjectProperty' && 'key' in value && 'value' in value && 'computed' in value) {
      const property = value as { key: { type: string; name?: string; value?: string };
        value: { type: string; value?: string }; computed: boolean; loc?: { start: { line: number } } };
      const key = property.key.type === 'StringLiteral' ? property.key.value
        : property.key.type === 'Identifier' && !property.computed ? property.key.name : undefined;
      const literal = property.value.type === 'StringLiteral' ? property.value.value : undefined;
      if (key && (FORBIDDEN.has(key) || (key === 'cache' || key === 'mode') && literal !== undefined
        || key === 'redirect' && literal === 'error')) {
        hits.push(`${property.loc?.start.line ?? '?'}: ${key}${literal === undefined ? '' : ` = ${literal}`}`);
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(ast.program);
  return hits;
}

describe('Given the Workers fetch option policy', () => {
  it('When linting infra literals Then finds forbidden options and ignores comments, strings and cache metadata', () => {
    const source = [
      "// redirect: 'error'",
      "const message = \"integrity: 'test'\";",
      "const log = { cache: entry.cache };",
      "fetch(url, { redirect: 'manual', credentials: 'omit' });",
      'fetch(url, { ["redirect"]: "error" });',
      "new Request(url, { cache: 'no-store', mode: 'cors', integrity: hash, keepalive: true, priority: level });",
    ].join('\n');
    assert.deepEqual(violations(source), [
      '5: redirect = error', '6: cache = no-store', '6: mode = cors', '6: integrity', '6: keepalive', '6: priority',
    ]);
  });

  it('When inspecting src/infra Then finds no forbidden RequestInit literals', () => {
    const offenders = readdirSync('src/infra', { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
      .flatMap(entry => {
        const path = join(entry.parentPath, entry.name);
        return violations(readFileSync(path, 'utf8')).map(hit => `${path}:${hit}`);
      });
    assert.deepEqual(offenders, []);
  });
});
