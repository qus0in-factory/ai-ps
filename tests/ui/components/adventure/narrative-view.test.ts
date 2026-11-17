import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deltaLine, diceLine, isIntro, rejectedLabel, streamingView,
} from '../../../../src/ui/components/adventure/narrative-view.ts';
import type { AppliedChanges } from '../../../../src/domain/adventure/types.ts';

const applied = (patch: Partial<AppliedChanges> = {}): AppliedChanges => ({
  stats: { health: 0, warmth: 0, focus: 0 },
  added: [], removed: [], repaired: [], rejected: [], slept: false,
  ...patch,
});

describe('Given a dice roll shown in the narrative log', () => {
  it('When the roll succeeds Then the line shows the die, roll, difficulty and result', () => {
    assert.equal(
      diceLine({ sides: 20, difficulty: 12, roll: 14, success: true }),
      '🎲 d20=14 ≥ 12 성공',
    );
  });
  it('When the roll fails Then the line says 실패', () => {
    assert.equal(diceLine({ sides: 6, difficulty: 5, roll: 2, success: false }), '🎲 d6=2 ≥ 5 실패');
  });
});

describe('Given the changes a turn applied', () => {
  it('When stats and items changed Then only non-zero changes are listed', () => {
    assert.equal(
      deltaLine(applied({ stats: { health: 15, warmth: -6, focus: 0 }, added: ['spare-lens'] })),
      '체력 +15 · 온기 -6 · 획득 예비 렌즈',
    );
  });
  it('When items were lost or the player moved Then the display names are used', () => {
    assert.equal(
      deltaLine(applied({ removed: ['matches'], moved: 'boathouse' })),
      '잃음 성냥 · 이동 보트 창고',
    );
  });
  it('When nothing changed Then the line says 변화 없음', () => {
    assert.equal(deltaLine(applied()), '변화 없음');
  });
  it('When a repair is rejected Then the reason is shown in Korean', () => {
    assert.equal(deltaLine(applied({ rejected: ['repair:no-part'] })), '거부 부품 없음');
  });
});

describe('Given a rejected change code', () => {
  it('When mapping a known code Then returns the Korean label', () => {
    assert.equal(rejectedLabel('repair:no-part'), '부품 없음');
    assert.equal(rejectedLabel('sleep:not-quarters'), '숙소가 아님');
  });
  it('When a stat value was clamped Then the raw code is not shown', () => {
    assert.equal(rejectedLabel('stat:warmth:clamped'), '변화량 상한 적용');
    assert.equal(rejectedLabel('stat:health:invalid'), '변화량 조정');
  });
  it('When the code is unknown Then returns the code as is', () => {
    assert.equal(rejectedLabel('weird:code'), 'weird:code');
  });
});

describe('Given an in-progress stream', () => {
  it('When only the action arrived Then the entry is still visible', () => {
    const view = streamingView({ action: '창고를 뒤진다', text: '', dice: [], fragments: [] });
    assert.equal(view.visible, true);
    assert.equal(view.action, '창고를 뒤진다');
    assert.equal(view.text, '');
  });
  it('When a dice result arrived before the narrative Then it is visible too', () => {
    const view = streamingView({
      action: '절벽을 오른다', text: '', fragments: [],
      dice: [{ sides: 20, difficulty: 15, roll: 9, success: false }],
    });
    assert.equal(view.visible, true);
    assert.equal(view.dice.length, 1);
  });
  it('When no stream exists Then nothing is shown', () => {
    assert.equal(streamingView(undefined).visible, false);
  });
});

describe('Given a log entry', () => {
  it('When the action is empty Then it is the intro scene and hides action/delta lines', () => {
    assert.equal(isIntro({ action: '' }), true);
    assert.equal(isIntro({ action: '창고를 뒤진다' }), false);
  });
});
