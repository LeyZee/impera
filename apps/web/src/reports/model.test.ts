import {
  PayPeriodSchema,
  ShiftReportSchema,
  ShiftSchema,
  type Shift,
  type ShiftReport,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  amountInput,
  amountText,
  incidentsOf,
  currencyTyped,
  lateFor,
  MEMBER_STATUS,
  parseAmount,
  parsePercent,
  percentText,
  periodAt,
  periodLine,
  periodSums,
  periodTitle,
  signedAmountText,
  startablePeriods,
  toDoOf,
  validatedTotal,
} from './model';

const period = (day: string) => PayPeriodSchema.parse(day);
const NBSP = '\u00a0';
const NNBSP = '\u202f';
/** Intl's French spaces, made plain for the comparison. */
const plain = (text: string): string => text.replaceAll(NBSP, ' ').replaceAll(NNBSP, ' ');

const shift = (id: string, startsAt: string): Shift =>
  ShiftSchema.parse({
    id,
    creatorId: '01a17ff2-0000-7000-8000-000000000001',
    platformAccountId: '01a17ff2-0000-7000-8000-000000000002',
    memberId: '01a17ff2-0000-7000-8000-000000000003',
    startsAt,
    endsAt: startsAt.replace('T08', 'T10'),
    templateId: null,
    stoppedAt: null,
  });

const report = (
  id: string,
  shiftId: string,
  amountMinor: number,
  status: ShiftReport['status'],
  correctsId: string | null = null,
): ShiftReport =>
  ShiftReportSchema.parse({
    id,
    shiftId,
    creatorId: '01a17ff2-0000-7000-8000-000000000001',
    platformAccountId: '01a17ff2-0000-7000-8000-000000000002',
    memberId: '01a17ff2-0000-7000-8000-000000000003',
    period: period('2026-10-16'),
    correctsId,
    amount: { amountMinor, currency: 'EUR' },
    comment: null,
    incident: null,
    status,
    version: 1,
    byAgency: false,
    canReview: false,
    submittedAt: '2026-10-20T10:00:00.000Z',
    reviewedAt: status === 'submitted' ? null : '2026-10-20T11:00:00.000Z',
    reviewNote: status === 'rejected' ? 'Le pourboire' : null,
    createdAt: '2026-10-20T10:00:00.000Z',
  });

describe('the currency typed with an amount', () => {
  it('reads a symbol or a code, and nothing in a bare figure', () => {
    expect(currencyTyped('50 €')).toBe('EUR');
    expect(currencyTyped('50 eur')).toBe('EUR');
    expect(currencyTyped('$50')).toBe('USD');
    expect(currencyTyped('50 USD')).toBe('USD');
    expect(currencyTyped('50,25')).toBeNull();
  });
});

describe('an amount typed in a report', () => {
  it('reads French and plain figures, in minor units', () => {
    expect(parseAmount('1 234,56')).toBe(123_456);
    expect(parseAmount('1234.5')).toBe(123_450);
    expect(parseAmount(' 12 € ')).toBe(1_200);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount(`1${NBSP}000`)).toBe(100_000);
  });

  it('refuses letters, three decimals, a sign on a report and more than the slip guard', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('douze')).toBeNull();
    expect(parseAmount('1,234')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('50000,01')).toBeNull();
    expect(parseAmount('50000')).toBe(5_000_000);
    expect(parseAmount('150 000', false, 100_000_000)).toBe(15_000_000);
  });

  it('takes a sign on a correction', () => {
    expect(parseAmount('-30', true)).toBe(-3_000);
    expect(parseAmount('−12,5', true)).toBe(-1_250);
    expect(parseAmount('+5', true)).toBe(500);
  });

  it('shows back what was typed, and reads in its currency', () => {
    expect(amountInput(123_456)).toBe('1234,56');
    expect(amountInput(-3_005)).toBe('-30,05');
    expect(plain(amountText(123_456, 'EUR'))).toBe('1 234,56 €');
    expect(plain(amountText(8_000, 'USD'))).toBe('80,00 $US');
    expect(plain(amountText(-3_000, 'EUR'))).toBe('−30,00 €');
    expect(plain(signedAmountText(-3_000, 'EUR'))).toBe('−30,00 €');
    expect(plain(signedAmountText(500, 'EUR'))).toBe('+5,00 €');
    expect(plain(signedAmountText(-123_456, 'USD'))).toBe('−1 234,56 $US');
    // A zero is a zero, whatever its sign: never « −0,00 € ».
    expect(plain(amountText(-0, 'EUR'))).toBe('0,00 €');
    expect(plain(signedAmountText(-0, 'EUR'))).toBe('0,00 €');
  });
});

describe('a period', () => {
  it('reads as a sentence and as a title', () => {
    expect(periodLine(period('2026-10-01'))).toBe('du 1er au 15 octobre');
    expect(periodLine(period('2026-02-16'))).toBe('du 16 au 28 février');
    expect(periodTitle(period('2026-10-16'))).toBe('16 – 31 octobre 2026');
  });

  it('is the agency’s, read in its zone', () => {
    // 23:30 UTC on 15 November is 00:30 on the 16th in Paris.
    expect(periodAt(new Date('2026-11-15T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-16');
    expect(periodAt(new Date('2026-11-15T23:30:00Z'), 'UTC')).toBe('2026-11-01');
  });

  it('offers the current period for an account’s first rules only, then the next ones', () => {
    expect(startablePeriods(period('2026-12-16'), true, 3)).toEqual([
      '2026-12-16',
      '2027-01-01',
      '2027-01-16',
    ]);
    expect(startablePeriods(period('2026-12-16'), false, 2)).toEqual(['2027-01-01', '2027-01-16']);
  });
});

describe('what a period’s list says', () => {
  const first = shift('01a17ff2-0000-7000-8000-00000000000a', '2026-10-17T08:00:00.000Z');
  const second = shift('01a17ff2-0000-7000-8000-00000000000b', '2026-10-18T08:00:00.000Z');
  const third = shift('01a17ff2-0000-7000-8000-00000000000c', '2026-10-16T08:00:00.000Z');
  const firstReport = '01a17ff2-0000-7000-8000-0000000000a1';
  const reports = [
    report(firstReport, first.id, 10_000, 'validated'),
    report('01a17ff2-0000-7000-8000-0000000000a2', first.id, -2_000, 'validated', firstReport),
    report('01a17ff2-0000-7000-8000-0000000000a3', first.id, 500, 'submitted', firstReport),
    report('01a17ff2-0000-7000-8000-0000000000b1', second.id, 4_000, 'rejected'),
  ];

  it('leaves to do the shifts without a report, then those sent back, oldest first', () => {
    const list = { reports, shifts: [first, second, third], accounts: [], members: [] };
    expect(toDoOf(list).map((one) => [one.shift.id, one.report?.status ?? null])).toEqual([
      [third.id, null],
      [second.id, 'rejected'],
    ]);
  });

  it('adds up a shift’s validated report and corrections', () => {
    expect(validatedTotal(reports, first.id)).toBe(8_000);
    expect(validatedTotal(reports, second.id)).toBe(0);
  });

  it('gathers the incidents shift by shift, in the order they were said', () => {
    const said = (one: ShiftReport, incident: string, createdAt: string): ShiftReport => ({
      ...one,
      incident,
      createdAt,
    });
    const report = reports.find((one) => one.id === firstReport);
    const correction = reports.find((one) => one.status === 'submitted');
    if (report === undefined || correction === undefined) throw new Error('no fixture');
    const incidents = incidentsOf([
      said(correction, 'Puis un fan insistant', '2026-10-21T09:00:00.000Z'),
      said(report, 'Reveal a coupé', '2026-10-20T10:00:00.000Z'),
      ...reports.filter((one) => one.shiftId === second.id),
    ]);
    expect([...incidents]).toEqual([[first.id, ['Reveal a coupé', 'Puis un fan insistant']]]);
  });

  it('sums what is validated, what waits for the agency and what came back to its member, per currency', () => {
    expect(periodSums(reports)).toEqual([
      {
        currency: 'EUR',
        validatedMinor: 8_000,
        validated: 2,
        waitingMinor: 500,
        waiting: 1,
        sentBackMinor: 4_000,
        sentBack: 1,
      },
    ]);
  });
});

describe('a rate', () => {
  it('reads and is typed in percent, kept in basis points', () => {
    expect(plain(percentText(2_000))).toBe('20 %');
    expect(plain(percentText(550))).toBe('5,5 %');
    expect(parsePercent('20')).toBe(2_000);
    expect(parsePercent('5,5 %')).toBe(550);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('100,01')).toBeNull();
    expect(parsePercent('1000')).toBeNull();
    expect(parsePercent('120', 100_000)).toBe(12_000);
    expect(parsePercent('vingt')).toBeNull();
  });
});

describe('a late report (EQ-14, EQ-21)', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  it('says since when its shift ended, in minutes, hours, then days', () => {
    expect(lateFor('2026-10-28T11:35:00Z', now)).toBe('depuis 25\u00a0min');
    expect(lateFor('2026-10-28T04:00:00Z', now)).toBe('depuis 8\u00a0h');
    expect(lateFor('2026-10-27T10:00:00Z', now)).toBe('depuis 1 jour');
    expect(lateFor('2026-10-25T12:00:00Z', now)).toBe('depuis 3 jours');
  });

  it('calls a report sent and not yet read « En attente », as the figure above it does', () => {
    expect(MEMBER_STATUS.submitted).toBe('En attente');
  });
});
