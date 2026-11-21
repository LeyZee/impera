import { describe, expect, it } from 'vitest';

import { abandonTease, isAbandon, type AbandonInput } from '../abandon';
import type { ScriptRun } from '../script-run';

const NOW = new Date('2026-11-20T21:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const run = (
  last: { kind: 'paid' | 'free'; outcome: 'sent' | 'opened' | 'bought' | 'refused' },
  status: ScriptRun['status'] = 'stalled',
  endedAt: Date | null = ago(48),
): ScriptRun => ({
  scriptRef: 'soir',
  status,
  steps: [
    { stepIndex: 0, kind: 'free', outcome: 'sent', priceMinor: null, sentAt: ago(49), at: ago(49) },
    { stepIndex: 1, ...last, priceMinor: last.kind === 'paid' ? 1500 : null, sentAt: ago(49), at: ago(49) },
  ],
  ignoredMessages: 0,
  startedAt: ago(49),
  endedAt: status === 'open' ? null : endedAt,
});

const left = run({ kind: 'paid', outcome: 'sent' });

const input = (change: Partial<AbandonInput>): AbandonInput => ({
  now: NOW,
  latest: left,
  earlier: [],
  teased: 0,
  hot: true,
  held: false,
  ...change,
});

describe('he left in the middle of a script: she teases him when he comes back hot (Charles 20/11)', () => {
  it('reads as left only a run gone cold with a paid step waiting, sent or opened', () => {
    expect(isAbandon(left)).toBe(true);
    expect(isAbandon(run({ kind: 'paid', outcome: 'opened' }))).toBe(true);
    expect(isAbandon(run({ kind: 'paid', outcome: 'bought' }))).toBe(false);
    expect(isAbandon(run({ kind: 'paid', outcome: 'refused' }, 'refused'))).toBe(false);
    expect(isAbandon(run({ kind: 'free', outcome: 'sent' }))).toBe(false);
    expect(isAbandon(run({ kind: 'paid', outcome: 'sent' }, 'open'))).toBe(false);
    expect(isAbandon(run({ kind: 'paid', outcome: 'sent' }, 'closed_by_human'))).toBe(false);
  });

  it('teases him once, the first time he left', () => {
    expect(abandonTease(input({}))).toBe('first');
    expect(abandonTease(input({ teased: 1 }))).toBeNull();
  });

  it('is vexed after a second run he left, up to three times', () => {
    const again = input({ earlier: [left] });
    expect(abandonTease(again)).toBe('again');
    expect(abandonTease({ ...again, teased: 2 })).toBe('again');
    expect(abandonTease({ ...again, teased: 3 })).toBeNull();
    // An earlier run he bought out or refused is no abandon.
    expect(abandonTease(input({ earlier: [run({ kind: 'paid', outcome: 'bought' }, 'bought_out')] }))).toBe(
      'first',
    );
  });

  it('waits for him to come back hot, never at the message the run went cold', () => {
    expect(abandonTease(input({ hot: false }))).toBeNull();
    expect(
      abandonTease(input({ latest: run({ kind: 'paid', outcome: 'sent' }, 'stalled', NOW) })),
    ).toBeNull();
  });

  it('never teases a fan she must not sell to', () => {
    expect(abandonTease(input({ held: true }))).toBeNull();
  });

  it('says nothing when his latest run is not one he left', () => {
    expect(abandonTease(input({ latest: null }))).toBeNull();
    expect(
      abandonTease(input({ latest: run({ kind: 'paid', outcome: 'bought' }, 'bought_out') })),
    ).toBeNull();
  });
});
