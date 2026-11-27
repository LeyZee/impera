import { ShiftReportSchema, type ShiftReport, type ShiftReportCheck } from '@impera/contracts';

/** End-of-shift reports for the tests: invented amounts and ids (ADR 0010). */

let next = 0;

/** A sent report the reader may review, with what its platform read. */
export function sent(check: ShiftReportCheck | null, explanation: string | null = null): ShiftReport {
  next += 1;
  const tail = String(next).padStart(3, '0');
  return ShiftReportSchema.parse({
    id: `01a17ff2-0000-7000-8000-000000000${tail}`,
    shiftId: `01a17ff2-0000-7000-8000-000000001${tail}`,
    creatorId: '01a17ff2-0000-7000-8000-000000000a01',
    platformAccountId: '01a17ff2-0000-7000-8000-000000000a02',
    memberId: '01a17ff2-0000-7000-8000-000000000a03',
    period: '2026-10-16',
    correctsId: null,
    amount: { amountMinor: 18_400, currency: 'EUR' },
    comment: null,
    incident: null,
    status: 'submitted',
    version: 1,
    byAgency: false,
    reviewKind: null,
    earningsSource: 'declared',
    explanation,
    check,
    canReview: true,
    submittedAt: '2026-10-26T22:05:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-10-26T22:05:00.000Z',
  });
}

const gap = (explainBy: string): ShiftReportCheck => ({
  state: 'complete',
  readMinor: 17_200,
  gapMinor: 1_200,
  verdict: 'gap',
  explainBy,
});
/** A gap whose member may still explain it. */
export const WAITING = gap('2099-01-01T00:00:00.000Z');
/** A gap whose delay to explain has passed: the agency decides. */
export const PAST = gap('2020-01-01T00:00:00.000Z');
/** A report its platform confirms: the automatic check validates it, no one decides. */
export const WITHIN: ShiftReportCheck = {
  state: 'complete',
  readMinor: 18_400,
  gapMinor: 0,
  verdict: 'within',
  explainBy: null,
};
