import { DomainError, REPORT_GAP_THRESHOLD_DEFAULT, type ShiftReportCheck } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertGapAnswered,
  checkWindow,
  completeFrom,
  explainBy,
  reportCheck,
  validatesByItself,
  withinThreshold,
  type ShiftSalesRead,
} from '../report-check';

const at = (value: string): Date => new Date(value);

/** A shift of 18 h to 24 h in Paris on 20 October (UTC+2), with the default access margin of 15 minutes. */
const SHIFT = { startsAt: at('2026-10-20T16:00:00Z'), endsAt: at('2026-10-20T22:00:00Z'), stoppedAt: null };
const MARGIN = 15;
/** The window ends at 22:15 UTC, the comparison is complete from 22:30 UTC. */
const COMPLETE = at('2026-10-20T22:30:00Z');

const read = (grossInclVatMinor: number, caughtUpAt: Date | null = COMPLETE): ShiftSalesRead => ({
  feed: 'read',
  grossInclVatMinor,
  caughtUpAt,
});

const check = (declaredMinor: number, sales: ShiftSalesRead, now: Date = COMPLETE): ShiftReportCheck | null =>
  reportCheck({
    declaredMinor,
    sales,
    shift: SHIFT,
    marginMinutes: MARGIN,
    threshold: REPORT_GAP_THRESHOLD_DEFAULT,
    now,
  });

describe('the window a report is compared over (ADR 0073 § 2)', () => {
  it('is the shift’s access window, then a quarter of an hour for the late lines', () => {
    expect(checkWindow(SHIFT, MARGIN)).toEqual({
      from: at('2026-10-20T15:45:00Z'),
      to: at('2026-10-20T22:15:00Z'),
    });
    expect(completeFrom(SHIFT, MARGIN)).toEqual(COMPLETE);
  });

  it('leaves its member 48 hours after the shift’s end to answer a gap (§ 5)', () => {
    expect(explainBy(SHIFT)).toEqual(at('2026-10-22T22:00:00Z'));
  });
});

describe('the threshold (ADR 0073 § 3)', () => {
  it('holds a gap at most 1 % of what was read, or at most 5 €, exactly at the bound', () => {
    // 1 % of 1 000,00 € is 10,00 €: exactly at it is within, a cent more is not.
    expect(withinThreshold(-1_000, 100_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(true);
    expect(withinThreshold(-1_001, 100_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(false);
    // Under 500,00 € read, the 5 € win: 5,00 € is within, 5,01 € is not.
    expect(withinThreshold(-500, 10_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(true);
    expect(withinThreshold(-501, 10_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(false);
  });

  it('reads nothing negative as a base: a register in refund gives the euros only', () => {
    expect(withinThreshold(-400, -2_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(true);
    expect(withinThreshold(-600, -2_000, REPORT_GAP_THRESHOLD_DEFAULT)).toBe(false);
  });

  it('is the owner’s, to the basis point and the cent', () => {
    expect(withinThreshold(-10, 1_000, { bps: 0, minor: 10 })).toBe(true);
    expect(withinThreshold(-11, 1_000, { bps: 0, minor: 10 })).toBe(false);
    expect(withinThreshold(-50, 1_000, { bps: 500, minor: 0 })).toBe(true);
  });
});

describe('a report against the platform (ADR 0073 § 2, § 4, § 5, § 7)', () => {
  it('compares nothing on an account whose platform has no register read', () => {
    expect(check(10_000, { feed: 'none' })).toBeNull();
  });

  it('says why it cannot compare: a cut feed, an unlinked model, an unlinked chatter', () => {
    expect(check(10_000, { feed: 'off' })).toEqual({ state: 'unavailable', reason: 'feed_off' });
    expect(check(10_000, { feed: 'model_unlinked' })).toEqual({
      state: 'unavailable',
      reason: 'model_unlinked',
    });
    expect(check(10_000, { feed: 'chatter_unlinked' })).toEqual({
      state: 'unavailable',
      reason: 'chatter_unlinked',
    });
  });

  it('stays provisional before the quarter of an hour, or until a read reached the register’s end after it', () => {
    expect(check(10_000, read(10_000), at('2026-10-20T22:29:59Z'))).toEqual({
      state: 'provisional',
      readMinor: 10_000,
    });
    expect(check(10_000, read(10_000, null))).toEqual({ state: 'provisional', readMinor: 10_000 });
    expect(check(10_000, read(10_000, at('2026-10-20T22:29:00Z')))).toEqual({
      state: 'provisional',
      readMinor: 10_000,
    });
  });

  it('is within when the report is at or under the platform, in the threshold', () => {
    expect(check(10_000, read(10_000))).toEqual({
      state: 'complete',
      readMinor: 10_000,
      gapMinor: 0,
      verdict: 'within',
      explainBy: null,
    });
    expect(check(9_600, read(10_000))).toMatchObject({ verdict: 'within', gapMinor: -400 });
  });

  it('is a gap a cent above the platform, even inside the threshold (§ 4)', () => {
    expect(check(10_001, read(10_000))).toEqual({
      state: 'complete',
      readMinor: 10_000,
      gapMinor: 1,
      verdict: 'gap',
      explainBy: '2026-10-22T22:00:00.000Z',
    });
  });

  it('is a gap under the platform out of the threshold (§ 5)', () => {
    expect(check(9_000, read(10_000))).toMatchObject({ verdict: 'gap', gapMinor: -1_000 });
  });

  it('validates by itself only when complete and within', () => {
    expect(validatesByItself(check(10_000, read(10_000)))).toBe(true);
    expect(validatesByItself(check(10_001, read(10_000)))).toBe(false);
    expect(validatesByItself(check(10_000, read(10_000), at('2026-10-20T22:00:00Z')))).toBe(false);
    expect(validatesByItself(check(10_000, { feed: 'off' }))).toBe(false);
    expect(validatesByItself(null)).toBe(false);
  });
});

describe('a person’s validation against a gap (ADR 0073 § 5)', () => {
  const gap = check(10_001, read(10_000));
  const codeOf = (explanation: string | null, now: Date): string | null => {
    try {
      assertGapAnswered(gap, explanation, now);
    } catch (error) {
      return error instanceof DomainError ? error.code : 'unexpected';
    }
    return null;
  };

  it('waits for the member until they explain it or the 48 hours pass', () => {
    expect(codeOf(null, at('2026-10-21T10:00:00Z'))).toBe('shift_report_gap_conflict');
    expect(codeOf('Une vente notée deux fois, je corrige demain.', at('2026-10-21T10:00:00Z'))).toBeNull();
    expect(codeOf(null, at('2026-10-22T22:00:00Z'))).toBeNull();
  });

  it('blocks nothing the comparison cannot say: provisional, unavailable, no register', () => {
    for (const nothing of [
      check(10_001, read(10_000), at('2026-10-20T22:00:00Z')),
      check(10_001, { feed: 'off' }),
      null,
    ]) {
      expect(() => {
        assertGapAnswered(nothing, null, at('2026-10-21T10:00:00Z'));
      }).not.toThrow();
    }
  });
});
