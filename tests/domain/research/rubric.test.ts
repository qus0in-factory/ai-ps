import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRubricMessages, parseRubric, rubricAverage, RUBRIC_FORMAT } from '../../../src/domain/research/rubric.ts';
import { UNTRUSTED_RULE } from '../../../src/domain/untrusted.ts';

describe('Given the harness-only rubric evaluator', () => {
  it('When the rubric format is declared Then it is a strict four-field json_schema', () => {
    assert.equal(RUBRIC_FORMAT.type, 'json_schema');
    assert.equal(RUBRIC_FORMAT.json_schema.name, 'rubric_scores');
    assert.equal(RUBRIC_FORMAT.json_schema.strict, true);
    const schema = RUBRIC_FORMAT.json_schema.schema as {
      additionalProperties: boolean;
      properties: Record<string, { type: string }>;
      required: string[];
    };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties).sort(), ['clear', 'grounded', 'reasons', 'structured']);
    assert.deepEqual(schema.required.sort(), ['clear', 'grounded', 'reasons', 'structured']);
    assert.equal(schema.properties.grounded.type, 'integer');
    assert.equal(schema.properties.structured.type, 'integer');
    assert.equal(schema.properties.clear.type, 'integer');
    assert.equal(schema.properties.reasons.type, 'string');
    assert.match(JSON.stringify(schema), /군더더기 없이/);
  });

  it('When building rubric messages Then the prompt grades by rubric only and carries topic, notes, report and the boundary rule', () => {
    const messages = buildRubricMessages('엣지 컴퓨팅', '노트 줄1', '보고서 줄1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
    const content = messages[0]?.content ?? '';
    assert.match(content, /루브릭 기준만으로/);
    assert.ok(content.includes('엣지 컴퓨팅'));
    assert.ok(content.includes('노트 줄1'));
    assert.ok(content.includes('보고서 줄1'));
    assert.ok(content.includes(UNTRUSTED_RULE));
    for (const criterion of ['grounded', 'structured', 'clear']) assert.ok(content.includes(criterion));
  });

  it('When parsing rubric output Then only three integers from 1 to 5 plus reasons pass', () => {
    const valid = JSON.stringify({ grounded: 1, structured: 5, clear: 3, reasons: '근거' });
    assert.deepEqual(parseRubric(valid), { ok: true, value: { grounded: 1, structured: 5, clear: 3, reasons: '근거' } });
    assert.deepEqual(parseRubric(JSON.stringify({ grounded: 5, structured: 5, clear: 5, reasons: '' })).ok, true);
    for (const raw of [
      JSON.stringify({ grounded: 0, structured: 3, clear: 3, reasons: 'x' }),
      JSON.stringify({ grounded: 6, structured: 3, clear: 3, reasons: 'x' }),
      JSON.stringify({ grounded: 2.5, structured: 3, clear: 3, reasons: 'x' }),
      JSON.stringify({ grounded: 3, structured: 3, clear: 3 }),
      JSON.stringify({ grounded: '3', structured: 3, clear: 3, reasons: 'x' }),
      'not json',
    ]) assert.equal(parseRubric(raw).ok, false, raw);
  });

  it('When averaging rubric scores Then the three criteria get equal weight', () => {
    assert.equal(rubricAverage({ grounded: 4, structured: 5, clear: 3, reasons: '' }), 4);
    assert.equal(rubricAverage({ grounded: 1, structured: 2, clear: 2, reasons: '' }), 5 / 3);
  });
});
