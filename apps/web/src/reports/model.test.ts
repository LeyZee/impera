import {
  PAY_RULES_SOURCE_REFUSALS,
  PayPeriodSchema,
  ShiftReportSchema,
  ShiftSchema,
  type Shift,
  type ShiftReport,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  amountInput,
  amountText,
  incidentsOf,
  currencyTyped,
  estimateLine,
  gapWaits,
  hasGap,
  lateFor,
  MEMBER_STATUS,
  parseAmount,
  parsePercent,
  percentText,
  periodAt,
  periodLine,
  periodSums,
  periodTitle,
  refusalText,
  REPORT_ERRORS,
  signedAmountText,
  SOURCE_REFUSAL_TEXTS,
  startablePeriods,
  thresholdText,
  toDoOf,
  uncheckedText,
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
    reviewKind: null,
    explanation: null,
    check: null,
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
    expect(amountInput(-3_005)).toBe('−30,05');
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

describe('a refused « Ventes relevées » (CRM-03, ADR 0050 § 8)', () => {
  const refused = (code: 'pay_rules_source_conflict' | 'pay_rules_conflict', sourceReason: string | null) => {
    const reason = PAY_RULES_SOURCE_REFUSALS.find((known) => known === sourceReason) ?? null;
    return { kind: 'refused', code, shiftReportId: null, opensAt: null, sourceReason: reason } as const;
  };

  it('says the exact reason the server gives, and where it is set', () => {
    expect(refusalText(refused('pay_rules_source_conflict', 'model_unlinked'))).toBe(
      SOURCE_REFUSAL_TEXTS.model_unlinked,
    );
    expect(SOURCE_REFUSAL_TEXTS.model_unlinked).toMatch(/Réglages › Ventes/u);
    expect(SOURCE_REFUSAL_TEXTS.check_missing).toMatch(/vérification de fiabilité/u);
  });

  it('falls back on the code when the server gives no reason', () => {
    expect(refusalText(refused('pay_rules_source_conflict', null))).toBe(
      REPORT_ERRORS.pay_rules_source_conflict,
    );
    expect(refusalText(refused('pay_rules_conflict', null))).toBe(REPORT_ERRORS.pay_rules_conflict);
  });

  it('names no platform, no amount and no key, and no longer says the sales are not read', () => {
    for (const text of [...Object.values(SOURCE_REFUSAL_TEXTS), REPORT_ERRORS.pay_rules_source_conflict]) {
      expect(text).not.toMatch(/reveal|€|\$|\d|clé/iu);
      expect(text).not.toMatch(/pas encore relevées/u);
    }
  });
});

describe('the estimate under a report’s amount (reco 19)', () => {
  it('says whose commission and, for a correction, its sign', () => {
    const plain = (text: string): string => text.replace(/\s/gu, ' ');
    expect(plain(estimateLine(803, false, null))).toBe('Ta commission estimée : 8,03 €');
    expect(plain(estimateLine(-80, true, null))).toBe('Effet estimé sur ta commission : −0,80 €');
    expect(plain(estimateLine(80, true, 'Théo'))).toBe('Effet estimé sur la commission de Théo : +0,80 €');
    expect(plain(estimateLine(803, false, 'Théo'))).toBe('Commission estimée de Théo : 8,03 €');
  });
});

describe('a report against its platform (ADR 0073)', () => {
  const ofShift = shift('01a17ff2-0000-7000-8000-00000000000d', '2026-10-19T08:00:00.000Z');
  const made = report('01a17ff2-0000-7000-8000-0000000000d1', ofShift.id, 11_000, 'submitted');
  const gap = (explanation: string | null = null): ShiftReport => ({
    ...made,
    explanation,
    check: {
      state: 'complete',
      readMinor: 10_000,
      gapMinor: 1_000,
      verdict: 'gap',
      explainBy: '2026-10-21T10:00:00.000Z',
    },
  });
  const BEFORE = new Date('2026-10-21T09:59:59Z');
  const AT = new Date('2026-10-21T10:00:00Z');

  it('waits for its member while a gap is neither explained nor past its 48 hours (§ 5)', () => {
    expect(gapWaits(gap(), BEFORE)).toBe(true);
    expect(gapWaits(gap(), AT)).toBe(false);
    expect(gapWaits(gap('Un pourboire noté deux fois.'), BEFORE)).toBe(false);
    const within: ShiftReport = {
      ...made,
      check: { state: 'complete', readMinor: 11_000, gapMinor: 0, verdict: 'within', explainBy: null },
    };
    expect(gapWaits(within, BEFORE)).toBe(false);
    expect(gapWaits({ ...made, check: { state: 'provisional', readMinor: 3_000 } }, BEFORE)).toBe(false);
    expect(gapWaits(made, BEFORE)).toBe(false);
  });

  it('counts a gap whatever became of it, and nothing the comparison cannot say', () => {
    expect(hasGap(gap('Un pourboire noté deux fois.'))).toBe(true);
    expect(hasGap({ ...gap(), status: 'validated' })).toBe(true);
    expect(hasGap({ ...made, check: { state: 'unavailable', reason: 'feed_off' } })).toBe(false);
  });

  it('leaves to do a gap that waits for its member, given the hour', () => {
    const list = { reports: [gap()], shifts: [ofShift], accounts: [], members: [] };
    expect(toDoOf(list)).toEqual([]);
    expect(toDoOf(list, BEFORE).map((one) => one.report?.id)).toEqual([made.id]);
    expect(toDoOf(list, AT)).toEqual([]);
  });

  it('says the threshold and why nothing is compared, to the agency or to the member', () => {
    expect(plain(thresholdText({ bps: 100, minor: 500 }))).toBe('1 % ou 5,00 €');
    expect(plain(thresholdText({ bps: 250, minor: 1_000 }, 'USD'))).toBe('2,5 % ou 10,00 $US');
    expect(uncheckedText('model_unlinked', 'Reveal', true)).toBe(
      'Ce compte n’est relié à aucun modèle de Reveal : relie-le dans Réglages › Ventes pour comparer ses rapports.',
    );
    expect(uncheckedText('chatter_unlinked', 'Reveal', false)).toBe(
      'Ton compte de chatteur sur Reveal n’est pas encore relié : l’agence relit ton rapport.',
    );
  });
});
