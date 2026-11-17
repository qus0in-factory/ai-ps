import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { phaseLabel, draftHint } from '../../../../src/ui/components/talk/phase-label.ts';
import { initialState } from '../../../../src/app/talk/session-store.ts';
describe('Given the text practice controls', () => {
  it('When waiting, cancelled or ended Then describes the available action without audio controls', () => {
    assert.match(phaseLabel('thinking'), /답/); assert.match(phaseLabel('reporting'), /보고서/);
    assert.match(phaseLabel('ended'), /완료/); assert.match(draftHint(initialState()), /500/);
  });
});
