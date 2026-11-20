import { describe, expect, it } from 'vitest';

import { refusalMove, REFUSAL_SESSION_MS, type RefusalMoment } from '../refusal';
import { openScriptRun, type ScriptRun } from '../script-run';

const ENDED = new Date('2026-11-20T20:00:00Z');
const REFUSED: ScriptRun = {
  ...openScriptRun('script-1', new Date('2026-11-20T19:30:00Z')),
  status: 'refused',
  endedAt: ENDED,
};
const moment = (herAnswersSince: number, over: Partial<RefusalMoment> = {}) =>
  refusalMove({
    now: new Date(ENDED.getTime() + 10 * 60_000),
    run: REFUSED,
    herAnswersSince,
    flags: {},
    care: false,
    ...over,
  });

describe('her moves after his refusal (ADR 0156 § 3)', () => {
  it('asks why, insists once, sulks once, then lets go', () => {
    expect([0, 1, 2, 3, 4].map((n) => moment(n))).toEqual(['ask_why', 'insist', 'sulk', null, null]);
  });

  it('only asks why to a fan she may not push: sales frozen, fragile, nobody may write to, or in care', () => {
    const pushedNot: Partial<RefusalMoment>[] = [
      { flags: { fragile: true } },
      { flags: { doNotContact: true } },
      { flags: { salesFrozen: { reason: 'distress', since: '2026-11-20T18:00:00Z' } } },
      { care: true },
    ];
    for (const over of pushedNot) {
      expect([0, 1, 2].map((n) => moment(n, over))).toEqual(['ask_why', null, null]);
    }
  });

  it('never whines at a fan who already paid a step of this script: she only asks why (Charles, 20/11)', () => {
    const at = new Date('2026-11-20T19:40:00Z');
    const paid: ScriptRun = {
      ...REFUSED,
      steps: [
        { stepIndex: 0, kind: 'paid', outcome: 'bought', priceMinor: 1_500, sentAt: at, at },
        { stepIndex: 1, kind: 'paid', outcome: 'refused', priceMinor: 2_000, sentAt: at, at: ENDED },
      ],
    };
    expect([0, 1, 2].map((n) => moment(n, { run: paid }))).toEqual(['ask_why', null, null]);
  });

  it('holds nothing past the session of the refusal, nor without a refused run', () => {
    expect(moment(1, { now: new Date(ENDED.getTime() + REFUSAL_SESSION_MS + 1) })).toBeNull();
    expect(moment(0, { run: { ...REFUSED, status: 'stalled' } })).toBeNull();
    expect(moment(0, { run: null })).toBeNull();
  });
});
