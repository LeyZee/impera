import { describe, expect, it } from 'vitest';

import {
  CreateShiftReportBodySchema,
  mayReviewShiftReport,
  RejectShiftReportBodySchema,
  SHIFT_REPORT_BATCH_MAX,
  SHIFT_REPORT_ERROR_CODES,
  SHIFT_REPORT_MAX_MINOR,
  ShiftReportListSchema,
  ShiftReportQuerySchema,
  ShiftReportSchema,
  UpdateShiftReportBodySchema,
  ValidateShiftReportsBodySchema,
  ValidateShiftReportsResultSchema,
  validatedTotalWith,
} from './shift-reports';

const REPORT = '0199f2a0-0000-7000-8000-0000000000b1';
const CORRECTION = '0199f2a0-0000-7000-8000-0000000000b2';
const SHIFT = '0199f2a0-0000-7000-8000-0000000000f1';

const report = {
  id: REPORT,
  shiftId: SHIFT,
  correctsId: null,
  amountMinor: 18_450,
  currency: 'EUR',
  comment: 'Deux packs vendus, un fan nouveau',
  incident: null,
};

const correction = {
  ...report,
  id: CORRECTION,
  correctsId: REPORT,
  amountMinor: -2_000,
  comment: 'Remboursé',
};

const stored = {
  id: REPORT,
  shiftId: SHIFT,
  creatorId: '0199f2a0-0000-7000-8000-0000000000c1',
  platformAccountId: '0199f2a0-0000-7000-8000-0000000000a1',
  memberId: '0199f2a0-0000-7000-8000-0000000000e1',
  period: '2026-10-16',
  correctsId: null,
  amount: { amountMinor: 18_450, currency: 'EUR' },
  comment: null,
  incident: 'Le compte a été déconnecté vingt minutes',
  status: 'submitted',
  version: 1,
  byAgency: false,
  canReview: true,
  submittedAt: '2026-10-29T04:58:00Z',
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-10-29T04:58:00Z',
};

describe('end-of-shift reports (EQ-03)', () => {
  it('declares a gross of 0 or more, in whole minor units, under the slip guard', () => {
    expect(CreateShiftReportBodySchema.safeParse(report).success).toBe(true);
    expect(CreateShiftReportBodySchema.safeParse({ ...report, amountMinor: 0 }).success).toBe(true);
    expect(CreateShiftReportBodySchema.safeParse({ ...report, amountMinor: -1 }).success).toBe(false);
    expect(CreateShiftReportBodySchema.safeParse({ ...report, amountMinor: 184.5 }).success).toBe(false);
    expect(
      CreateShiftReportBodySchema.safeParse({ ...report, amountMinor: SHIFT_REPORT_MAX_MINOR + 1 }).success,
    ).toBe(false);
  });

  it('reads an empty comment or incident as none, and a missing correction as a report', () => {
    const parsed = CreateShiftReportBodySchema.parse({
      id: REPORT,
      shiftId: SHIFT,
      amountMinor: 0,
      currency: 'EUR',
      comment: '   ',
      incident: '',
    });
    expect(parsed).toMatchObject({ correctsId: null, comment: null, incident: null });
  });

  it('corrects a validated report by adding or taking off, never by 0, and without an incident', () => {
    expect(CreateShiftReportBodySchema.safeParse(correction).success).toBe(true);
    expect(CreateShiftReportBodySchema.safeParse({ ...correction, amountMinor: 0 }).success).toBe(false);
    expect(CreateShiftReportBodySchema.safeParse({ ...correction, incident: 'Panne' }).success).toBe(false);
  });

  it('keeps the shift’s period and its incident, and holds a correction to the same rules', () => {
    expect(ShiftReportSchema.parse(stored).period).toBe('2026-10-16');
    expect(ShiftReportSchema.safeParse({ ...stored, period: '2026-10-17' }).success).toBe(false);
    expect(
      ShiftReportSchema.safeParse({ ...stored, amount: { amountMinor: -5, currency: 'EUR' } }).success,
    ).toBe(false);
    expect(
      ShiftReportSchema.safeParse({
        ...stored,
        id: CORRECTION,
        correctsId: REPORT,
        incident: null,
        amount: { amountMinor: -5, currency: 'EUR' },
      }).success,
    ).toBe(true);
  });

  it('sends a rejected report again as it is with its version alone', () => {
    expect(UpdateShiftReportBodySchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(UpdateShiftReportBodySchema.safeParse({ amountMinor: 100 }).success).toBe(false);
  });

  it('validates each report once, by the version read, within one batch', () => {
    const one = { id: REPORT, version: 1 };
    expect(ValidateShiftReportsBodySchema.safeParse({ reports: [one] }).success).toBe(true);
    expect(ValidateShiftReportsBodySchema.safeParse({ reports: [] }).success).toBe(false);
    expect(ValidateShiftReportsBodySchema.safeParse({ reports: [one, { ...one, version: 2 }] }).success).toBe(
      false,
    );
    const many = Array.from({ length: SHIFT_REPORT_BATCH_MAX + 1 }, (_, index) => ({
      id: `0199f2a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
      version: 1,
    }));
    expect(ValidateShiftReportsBodySchema.safeParse({ reports: many }).success).toBe(false);
  });

  it('answers each report of a batch on its own', () => {
    const result = ValidateShiftReportsResultSchema.parse({
      results: [
        {
          outcome: 'validated',
          report: { ...stored, status: 'validated', reviewedAt: '2026-10-29T09:00:00Z' },
        },
        { outcome: 'refused', id: CORRECTION, code: 'shift_report_total_conflict' },
      ],
    });
    expect(result.results.map((one) => one.outcome)).toEqual(['validated', 'refused']);
    expect(
      ValidateShiftReportsResultSchema.safeParse({
        results: [{ outcome: 'refused', id: CORRECTION, code: 'leave_decided_conflict' }],
      }).success,
    ).toBe(false);
  });

  it('checks the validated total again at validation: two corrections can each pass alone', () => {
    const euros = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });
    const shiftReport = { id: REPORT, status: 'validated' as const, amount: euros(10_000) };
    const first = { id: CORRECTION, status: 'submitted' as const, amount: euros(-8_000) };
    const second = {
      id: '0199f2a0-0000-7000-8000-0000000000b3',
      status: 'submitted' as const,
      amount: euros(-6_000),
    };
    // Each correction, made while only the report is validated, keeps the total at 0 or more.
    expect(validatedTotalWith([shiftReport], first)).toBe(2_000);
    expect(validatedTotalWith([shiftReport, first], second)).toBe(4_000);
    // Once the first is validated, the second would take it below 0: its validation is refused.
    const validated = { ...first, status: 'validated' as const };
    expect(validatedTotalWith([shiftReport, validated, second], second)).toBe(-4_000);
    // The report being validated counts once, even when the list already holds it.
    expect(validatedTotalWith([shiftReport, validated], validated)).toBe(2_000);
  });

  it('never lets anyone review their own shift, nor a manager a correction they made', () => {
    const review = {
      status: 'submitted' as const,
      readerIsAgency: true,
      readerIsOwner: false,
      readerIsShiftMember: false,
      readerMadeIt: false,
    };
    expect(mayReviewShiftReport(review)).toBe(true);
    expect(mayReviewShiftReport({ ...review, readerIsShiftMember: true })).toBe(false);
    expect(mayReviewShiftReport({ ...review, readerMadeIt: true })).toBe(false);
    // The owner reviews a correction they made: nobody reviews for them.
    expect(mayReviewShiftReport({ ...review, readerIsOwner: true, readerMadeIt: true })).toBe(true);
    expect(mayReviewShiftReport({ ...review, readerIsAgency: false })).toBe(false);
    expect(mayReviewShiftReport({ ...review, status: 'rejected' })).toBe(false);
  });

  it('sends a report back with a note that says what to look at', () => {
    expect(
      RejectShiftReportBodySchema.safeParse({ version: 1, note: 'Le pack de 40 € manque' }).success,
    ).toBe(true);
    expect(RejectShiftReportBodySchema.safeParse({ version: 1, note: '  ' }).success).toBe(false);
  });

  it('lists a period, or what is still open without one', () => {
    expect(ShiftReportQuerySchema.parse({})).toEqual({});
    expect(ShiftReportQuerySchema.safeParse({ period: '2026-10-20' }).success).toBe(false);
    expect(
      ShiftReportListSchema.safeParse({ reports: [stored], shifts: [], accounts: [], members: [] }).success,
    ).toBe(true);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of SHIFT_REPORT_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|forbidden)$/u);
    }
  });
});
