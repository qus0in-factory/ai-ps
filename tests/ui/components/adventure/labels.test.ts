import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayName, locationLabels, locationOptions, timeLabels, weatherLabels,
} from '../../../../src/ui/components/adventure/labels.ts';

describe('Given an internal item or location id', () => {
  it('When the shared display table has it Then the Korean label is shown', () => {
    assert.equal(displayName('lantern-handheld'), '휴대용 등불');
    assert.equal(displayName('matches'), '성냥');
    assert.equal(displayName('spare-lens'), '예비 렌즈');
  });
  it('When the id is unknown Then it is shown as is instead of breaking', () => {
    assert.equal(displayName('mystery-item'), 'mystery-item');
  });
});

describe('Given the location choices', () => {
  it('When rendered Then every location uses the shared Korean name', () => {
    assert.deepEqual(locationOptions.map((option) => option.value),
      ['quarters', 'stairwell', 'lantern-room', 'shore', 'boathouse', 'cliff-path']);
    assert.equal(locationLabels['lantern-room'], '등실');
    assert.equal(locationOptions.find((option) => option.value === 'boathouse')?.label, '보트 창고');
  });
  it('When time and weather are shown Then they use Korean labels', () => {
    assert.equal(timeLabels.dusk, '해질녘');
    assert.equal(weatherLabels.storm, '폭풍');
  });
});
