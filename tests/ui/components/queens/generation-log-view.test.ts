import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateView, feedbackView, HIDDEN_VALUE, redactCoordinates, validationView,
} from '../../../../src/ui/components/queens/generation-log-view.ts';
import type { PuzzleValidation } from '../../../../src/domain/queens/types.ts';

const coordinates = /\(\s*-?\d+\s*,\s*-?\d+\s*\)|"row"\s*:\s*-?\d+/;

const twoAnswers = [
  [{ row: 0, column: 1 }, { row: 1, column: 3 }],
  [{ row: 0, column: 3 }, { row: 1, column: 1 }],
];

describe('Given a validation report that found several answers', () => {
  it('When the log entry is prepared Then masks every solution and the quoted coordinates while keeping the failure reason', () => {
    const report: PuzzleValidation = {
      valid: false,
      solutionStatus: 'multiple',
      nodesVisited: 42,
      solutions: twoAnswers,
      issues: [{
        code: 'MULTIPLE_SOLUTIONS',
        solutions: twoAnswers,
        message: `정답이 유일하지 않습니다. 서로 다른 두 정답(행·열은 0부터 시작): ${JSON.stringify(twoAnswers[0])} / ${JSON.stringify(twoAnswers[1])}`,
      }],
    };
    const view = validationView(report);
    assert.equal(view.summary, '검증 실패 · MULTIPLE_SOLUTIONS');
    assert.doesNotMatch(view.detail, coordinates);
    assert.ok(view.detail.includes(HIDDEN_VALUE));
    assert.ok(view.detail.includes('MULTIPLE_SOLUTIONS'));
    assert.ok(view.detail.includes('정답이 유일하지 않습니다.'));
    assert.equal(view.detail.includes('42'), true);
    assert.equal(view.spoiler, JSON.stringify(report, null, 2));
    assert.match(view.spoiler ?? '', coordinates);
  });
});

describe('Given a validation report whose single answer is the hidden solution', () => {
  it('When the log entry is prepared Then announces one answer in the summary and keeps the coordinates only behind the spoiler', () => {
    const report: PuzzleValidation = {
      valid: true, solutionStatus: 'unique', nodesVisited: 7,
      solutions: [[{ row: 0, column: 1 }, { row: 1, column: 3 }]], issues: [],
    };
    const view = validationView(report);
    assert.equal(view.summary, '검증 통과 · 정답 1개');
    assert.doesNotMatch(view.detail, coordinates);
    assert.equal(view.detail.includes('"solutions"'), true);
    assert.match(view.spoiler ?? '', coordinates);
  });
});

describe('Given a validation report without any answer coordinates', () => {
  it('When the log entry is prepared Then shows the reason as is and offers no spoiler section', () => {
    const report: PuzzleValidation = {
      valid: false, solutionStatus: 'invalid', nodesVisited: 0, solutions: [],
      issues: [{ code: 'REGION_TOO_SMALL', region: 3, message: '색상 영역 3은 최소 2칸이어야 합니다. 현재 1칸입니다.' }],
    };
    const view = validationView(report);
    assert.equal(view.summary, '검증 실패 · REGION_TOO_SMALL');
    assert.ok(view.detail.includes('색상 영역 3은 최소 2칸이어야 합니다.'));
    assert.equal(view.spoiler, undefined);
  });
});

describe('Given a retry feedback message that quotes the conflicting answers', () => {
  it('When the log entry is prepared Then hides the quoted coordinates behind a spoiler but keeps the rest of the message', () => {
    const message = 'MULTIPLE_SOLUTIONS: 정답이 유일하지 않습니다. [{"row":0,"column":1}] / [{"row":0,"column":3}]';
    const view = feedbackView(message);
    assert.doesNotMatch(view.detail, coordinates);
    assert.ok(view.detail.includes('MULTIPLE_SOLUTIONS'));
    assert.ok(view.detail.includes(HIDDEN_VALUE));
    assert.equal(view.spoiler, message);
  });
  it('When the feedback message carries no coordinates Then shows it unchanged without a spoiler', () => {
    const message = 'QUEEN_COUNT: 퀸은 정확히 5개여야 합니다.';
    const view = feedbackView(message);
    assert.equal(view.detail, message);
    assert.equal(view.spoiler, undefined);
  });
});

describe('Given a region design candidate', () => {
  it('When the log entry is prepared Then shows the region matrix unchanged without a spoiler', () => {
    const regions = [[0, 0, 1], [0, 1, 1], [2, 2, 1]];
    const view = candidateView(regions);
    assert.equal(view.detail, JSON.stringify(regions, null, 2));
    assert.equal(view.spoiler, undefined);
  });
  it('When the candidate is unparsable Then still renders something instead of throwing', () => {
    const view = candidateView(null);
    assert.equal(view.detail, 'null');
    assert.equal(view.spoiler, undefined);
  });
});

describe('Given a placement style coordinate list', () => {
  it('When the coordinates are redacted Then every pair is replaced with the hidden marker', () => {
    assert.equal(redactCoordinates('(0, 1), (1, 3)'), `${HIDDEN_VALUE}, ${HIDDEN_VALUE}`);
    assert.equal(redactCoordinates('(0,1)'), HIDDEN_VALUE);
  });
});
