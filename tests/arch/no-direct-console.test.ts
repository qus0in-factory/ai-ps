import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

describe('Given application logs must pass through the redacting loggers', () => {
  it('When scanning src Then only console-logger.ts calls console directly', () => {
    const root = resolve('src');
    const direct: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = resolve(entry.parentPath, entry.name);
      if (relative(root, path) === 'infra/console-logger.ts') continue;
      if (/\bconsole\.(?:log|info|warn|error|debug)\b/.test(readFileSync(path, 'utf8'))) direct.push(relative(root, path));
    }
    assert.deepEqual(direct, []);
  });
});
