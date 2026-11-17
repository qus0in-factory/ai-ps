import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generationEventText } from '../../../../src/ui/components/queens/generation-log-view.ts';

describe('Given compact Queens generation progress', () => {
  it('When rendering Then shows placement, model choice, code repair and completion as single lines', () => {
    assert.equal(generationEventText({ kind: 'placement' }), '정답 배치');
    assert.equal(generationEventText({ kind: 'model', path: 'model' }), '모델 제안 반영');
    assert.equal(generationEventText({ kind: 'model', path: 'algorithm', reason: '시간 초과' }), '모델 없이 생성 (시간 초과)');
    assert.equal(generationEventText({ kind: 'model', path: 'model-seed' }), '모델 시드 기반');
    assert.equal(generationEventText({ kind: 'repair', message: '코드 보정 완료' }), '코드 보정 완료');
    assert.equal(generationEventText({ kind: 'complete' }), '완료');
    assert.equal(generationEventText({ kind: 'stopped', reason: '중단' }), '중단');
  });
  it('When a summary contains coordinates or controls Then neither reaches the visible line', () => {
    const text = generationEventText({ kind: 'repair', message: '보정 (0, 1) {"row":2,"column":3}\n완료' });
    assert.doesNotMatch(text, /"row"|\(\d+, ?\d+\)|[\r\n]/);
  });
});
