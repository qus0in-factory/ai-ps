import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { parse } from '@babel/parser';

describe('Given the source layers', () => {
  it('When inspecting imports Then dependencies follow the layer boundaries', () => {
    const root = resolve('src');
    const allowed: Record<string, string[]> = {
      ui: ['ui', 'app', 'domain'], app: ['app', 'domain'],
      domain: ['domain'], infra: ['infra', 'domain'],
    };
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = resolve(entry.parentPath, entry.name);
      const layer = relative(root, path).split('/')[0]!;
      if (!allowed[layer]) continue;
      const source = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      for (const statement of source.program.body) {
        if (statement.type !== 'ImportDeclaration') continue;
        const specifier = statement.source.value;
        if (!specifier.startsWith('.')) {
          if (layer === 'app' || layer === 'domain') assert.fail(`${path}: external import ${specifier}`);
          continue;
        }
        const dependency = relative(root, resolve(entry.parentPath, specifier)).split('/')[0]!;
        assert.ok(allowed[layer]!.includes(dependency), `${layer} cannot import ${dependency}`);
        if (layer === 'ui' && dependency === 'domain') {
          assert.equal(statement.importKind, 'type', 'UI domain imports must be type-only');
        }
      }
    }
  });
});
