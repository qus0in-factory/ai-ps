import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT, buildTurnMessages } from '../../../src/domain/adventure/history.ts';
import { createSession, LOCATIONS } from '../../../src/domain/adventure/session.ts';

describe('Given the shared adventure narration prompt', () => {
  it('When starting or taking a turn Then requires the same polite second-person voice', () => {
    const start = buildTurnMessages(createSession(), '첫 장면');
    const turn = buildTurnMessages(createSession(), '둘러보기');
    assert.equal(start[0]!.content, turn[0]!.content);
    assert.match(SYSTEM_PROMPT, /시작.*턴.*당신은 ~합니다/);
    assert.match(SYSTEM_PROMPT, /반말.*사용하지/);
    assert.ok(SYSTEM_PROMPT.includes('당신은 따뜻한 차를 마십니다.'));
    assert.ok(!SYSTEM_PROMPT.includes('"narrative":"너는'));
  });
  it('When items or places occur in narrative Then provides Korean display names while preserving IDs in structured fields', () => {
    for (const id of ['spare-lens','clock-spring','lamp-oil','lantern-handheld','matches','blanket','tea-tin','rope','driftwood','oilskin', ...LOCATIONS]) {
      assert.match(SYSTEM_PROMPT, new RegExp('\\| ' + id + ' \\| [가-힣 ]+ \\|'));
    }
    assert.match(SYSTEM_PROMPT, /narrative.*한국어 표시 이름만/);
    assert.match(SYSTEM_PROMPT, /addItems.*removeItems.*location.*ID/);
    assert.match(SYSTEM_PROMPT, /표에 없는.*한국어/);
  });
});
