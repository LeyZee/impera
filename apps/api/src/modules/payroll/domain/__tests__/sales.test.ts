import { DomainError, newId, PlatformAccountIdSchema, type PayPeriod } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  closePeriod,
  paysMember,
  periodIsEmpty,
  planPeriod,
  salesCountedIn,
  salesHeldIn,
  statementOf,
  type MemberForPay,
  type PeriodPlan,
  type PeriodSnapshot,
} from '../recalculation';
import {
  NO_SALES,
  saleAttribution,
  saleKeyOf,
  salesWaitingBefore,
  type AccountSourceForPay,
  type SaleAuthorForPay,
  type SaleForPay,
  type SalesSnapshot,
  type ShiftForPay,
} from '../sales';

import { member, P1, P2, P3, report, snapshot, USD } from './fixtures';

/** Invented members, sales and amounts only (ADR 0010). */
const ACCOUNT = newId(PlatformAccountIdSchema);
const detectedFrom = (fromPeriod: PayPeriod): AccountSourceForPay => ({
  platformAccountId: ACCOUNT,
  platform: 'reveal',
  fromPeriod,
  earningsSource: 'detected',
});
const declaredFrom = (fromPeriod: PayPeriod): AccountSourceForPay => ({
  ...detectedFrom(fromPeriod),
  earningsSource: 'declared',
});

const linked = (who: MemberForPay, linkVersion = 'v1'): SaleAuthorForPay => ({
  kind: 'member',
  memberId: who.id,
  linkVersion,
});

let saleNumber = 0;
/** A sale on the account at `at`, in the period of that day (the agency's zone is not read here). */
const sale = (
  author: SaleAuthorForPay,
  at: string,
  netMinor: number,
  patch: Partial<SaleForPay> = {},
): SaleForPay => {
  saleNumber += 1;
  const period: PayPeriod = at < '2025-03-16' ? P1 : at < '2025-04-01' ? P2 : P3;
  return {
    platform: 'reveal',
    platformSaleId: `sale-${String(saleNumber).padStart(3, '0')}`,
    event: 'sale',
    platformAccountId: ACCOUNT,
    status: 'paid',
    period,
    saleOccurredAt: new Date(at),
    salePeriod: period,
    currency: 'EUR',
    netMinor,
    author,
    ...patch,
  };
};

/** The refund of `of`, on its own day: its sale's author, instant and period, a negative net. */
const refundOf = (of: SaleForPay, period: PayPeriod, netMinor: number, author = of.author): SaleForPay => ({
  ...of,
  event: 'refund',
  status: 'refunded',
  period,
  netMinor: -netMinor,
  author,
});

const shift = (who: MemberForPay, startsAt: string, endsAt: string, stopped = false): ShiftForPay => ({
  memberId: who.id,
  platformAccountId: ACCOUNT,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  stopped,
});

const salesOf = (patch: Partial<SalesSnapshot>): SalesSnapshot => ({
  ...NO_SALES,
  sources: [detectedFrom(P1)],
  accessMarginMinutes: 15,
  ...patch,
});

const written = (plan: PeriodPlan) => {
  if (plan.kind !== 'write') throw new Error('nothing written');
  return plan;
};
const contentOf = (plan: PeriodPlan, who: MemberForPay) => {
  const { inserts, updates } = written(plan);
  const found = [...inserts, ...updates].find((draft) => draft.content.memberId === who.id);
  if (found === undefined) throw new Error('no draft');
  return found.content;
};
const keys = (lines: readonly { readonly line: SaleForPay }[]) => lines.map((one) => saleKeyOf(one.line));
/** The keys of some lines, in the order pay keeps them. */
const keysOf = (lines: readonly SaleForPay[]) => lines.map((line) => saleKeyOf(line)).sort();

describe('whose a sale is (ADR 0050 §§ 5, 8)', () => {
  const theo = member();
  const lea = member();
  const morning = shift(theo, '2025-03-17T10:00:00.000Z', '2025-03-17T14:00:00.000Z');
  const sales = salesOf({ shifts: [morning] });
  const at = (instant: string, author = linked(theo)) => saleAttribution(sale(author, instant, 1_000), sales);

  it('is the linked member’s when they were on shift, the margin included on both sides', () => {
    expect(at('2025-03-17T12:00:00.000Z')).toEqual({ kind: 'member', memberId: theo.id, linkVersion: 'v1' });
    expect(at('2025-03-17T09:45:00.000Z').kind).toBe('member');
    expect(at('2025-03-17T14:14:59.999Z').kind).toBe('member');
  });

  it('is held when the member was neither on shift nor in their margin, on that account', () => {
    expect(at('2025-03-17T09:44:59.999Z')).toEqual({ kind: 'held', reason: 'off_shift' });
    expect(at('2025-03-17T14:15:00.000Z')).toEqual({ kind: 'held', reason: 'off_shift' });
    expect(at('2025-03-17T12:00:00.000Z', linked(lea))).toEqual({ kind: 'held', reason: 'off_shift' });
    const elsewhere = { ...morning, platformAccountId: newId(PlatformAccountIdSchema) };
    expect(
      saleAttribution(
        sale(linked(theo), '2025-03-17T12:00:00.000Z', 1_000),
        salesOf({ shifts: [elsewhere] }),
      ),
    ).toEqual({ kind: 'held', reason: 'off_shift' });
  });

  it('gives no margin after a shift stopped while under way', () => {
    const stopped = salesOf({ shifts: [{ ...morning, stopped: true }] });
    expect(saleAttribution(sale(linked(theo), '2025-03-17T13:59:59.999Z', 1_000), stopped).kind).toBe(
      'member',
    );
    expect(saleAttribution(sale(linked(theo), '2025-03-17T14:00:00.000Z', 1_000), stopped)).toEqual({
      kind: 'held',
      reason: 'off_shift',
    });
    // Its margin before the start stays.
    expect(saleAttribution(sale(linked(theo), '2025-03-17T09:45:00.000Z', 1_000), stopped).kind).toBe(
      'member',
    );
  });

  it('is held for a chatter not linked yet or a status Nirvana does not know, and nobody’s for the agent or none', () => {
    expect(at('2025-03-17T12:00:00.000Z', { kind: 'unlinked' })).toEqual({
      kind: 'held',
      reason: 'chatter_unlinked',
    });
    expect(at('2025-03-17T12:00:00.000Z', { kind: 'agent' })).toEqual({ kind: 'nobody' });
    expect(at('2025-03-17T12:00:00.000Z', { kind: 'none' })).toEqual({ kind: 'nobody' });
    expect(
      saleAttribution(sale(linked(theo), '2025-03-17T12:00:00.000Z', 1_000, { status: 'other' }), sales),
    ).toEqual({ kind: 'held', reason: 'status_unknown' });
    // A refund asked still counts (ADR 0050 § 7).
    expect(
      saleAttribution(
        sale(linked(theo), '2025-03-17T12:00:00.000Z', 1_000, { status: 'refund_asked' }),
        sales,
      ).kind,
    ).toBe('member');
  });

  it('stays outside while the account is paid on its reports: declared, without rules, or before its detected rules', () => {
    const line = sale(linked(theo), '2025-03-17T12:00:00.000Z', 1_000);
    const outside = { kind: 'outside' };
    expect(saleAttribution(line, salesOf({ shifts: [morning], sources: [declaredFrom(P1)] }))).toEqual(
      outside,
    );
    expect(saleAttribution(line, salesOf({ shifts: [morning], sources: [] }))).toEqual(outside);
    expect(saleAttribution(line, salesOf({ shifts: [morning], sources: [detectedFrom(P3)] }))).toEqual(
      outside,
    );
    const onlyfans = { ...detectedFrom(P1), platform: 'onlyfans' as const };
    expect(saleAttribution(line, salesOf({ shifts: [morning], sources: [onlyfans] }))).toEqual(outside);
  });

  it('holds a refund whose sale was never paid on the platform’s net, without taking it off anyone (03/11)', () => {
    const fromP2 = salesOf({ shifts: [morning], sources: [detectedFrom(P2)] });
    const before = sale(linked(theo), '2025-03-10T12:00:00.000Z', 1_000);
    expect(saleAttribution(refundOf(before, P2, 1_000), fromP2)).toEqual({
      kind: 'held',
      reason: 'refund_before_base',
    });
    const unknown = refundOf(before, P2, 1_000);
    expect(saleAttribution({ ...unknown, saleOccurredAt: null, salePeriod: null }, fromP2)).toEqual({
      kind: 'held',
      reason: 'refund_before_register',
    });
    // On a day still under the reports, it is theirs.
    expect(saleAttribution(refundOf(before, P1, 1_000), fromP2)).toEqual({ kind: 'outside' });
  });

  it('takes a refund off the member its sale was counted for, whatever the link says since', () => {
    const counted = sale(linked(theo), '2025-03-17T12:00:00.000Z', 1_000);
    const registered = new Map([[saleKeyOf(counted), { period: P2, memberId: theo.id, linkVersion: 'v1' }]]);
    const refund = refundOf(counted, P3, 1_000, linked(lea, 'v2'));
    expect(saleAttribution(refund, salesOf({ registered }))).toEqual({
      kind: 'member',
      memberId: theo.id,
      linkVersion: 'v1',
    });
  });
});

describe('the sales a period counts (ADR 0032, ADR 0050 § 5)', () => {
  const theo = member();
  const lea = member();
  const shifts = [
    shift(theo, '2025-03-10T10:00:00.000Z', '2025-03-10T14:00:00.000Z'),
    shift(theo, '2025-03-17T10:00:00.000Z', '2025-03-17T14:00:00.000Z'),
    shift(theo, '2025-04-02T10:00:00.000Z', '2025-04-02T14:00:00.000Z'),
  ];
  const counted = sale(linked(theo), '2025-03-10T11:00:00.000Z', 3_000);
  const late = sale(linked(theo), '2025-03-10T12:00:00.000Z', 2_000);
  const own = sale(linked(theo), '2025-03-17T11:00:00.000Z', 5_000);
  const later = sale(linked(theo), '2025-04-02T11:00:00.000Z', 7_000);
  const offShift = sale(linked(theo), '2025-03-17T20:00:00.000Z', 900);
  const lines = [counted, late, own, later, offShift];
  const registered = new Map([[saleKeyOf(counted), { period: P1, memberId: theo.id, linkVersion: 'v1' }]]);
  const sales = salesOf({ lines, registered, shifts });

  it('counts in the team’s first open period its own sales and the late ones no closing registered', () => {
    const open = snapshot({ period: P2, firstClosed: P1, lastClosed: P1, sales });
    expect(keys(salesCountedIn(open))).toEqual(keysOf([late, own]));
    expect(salesCountedIn(open).find((one) => one.line === late)?.lateFrom).toBe(P1);
    expect(salesCountedIn(open).find((one) => one.line === own)?.lateFrom).toBeNull();
    expect(salesHeldIn(open)).toEqual([{ line: offShift, reason: 'off_shift' }]);
  });

  it('counts in a later open period its own sales only: a late one goes to the first open one', () => {
    const open = snapshot({ period: P3, firstClosed: P1, lastClosed: P1, sales });
    expect(keys(salesCountedIn(open))).toEqual(keysOf([later]));
  });

  it('counts in a closed period exactly what its closing registered, for the member it registered', () => {
    const relinked = salesOf({
      lines: lines.map((line) => ({ ...line, author: linked(lea, 'v2') })),
      registered,
      shifts,
    });
    const closed = snapshot({
      period: P1,
      closing: { teamNetMinor: 0, collective: null, exchangeRates: [] },
      firstClosed: P1,
      lastClosed: P1,
      sales: relinked,
    });
    expect(salesCountedIn(closed).map((one) => [saleKeyOf(one.line), one.memberId, one.linkVersion])).toEqual(
      [[saleKeyOf(counted), theo.id, 'v1']],
    );
    expect(salesHeldIn(closed)).toEqual([]);
  });

  it('never counts a registered sale again after its chatter is linked to someone else', () => {
    const relinked = salesOf({ lines: [{ ...counted, author: linked(lea, 'v2') }], registered, shifts });
    const open = snapshot({ period: P2, firstClosed: P1, lastClosed: P1, sales: relinked });
    expect(salesCountedIn(open)).toEqual([]);
  });

  it('counts every sale in its own period before any closing, and a closing waits for an earlier one', () => {
    const first = snapshot({ period: P2, sales: salesOf({ lines: [late, own], shifts }) });
    expect(keys(salesCountedIn(first))).toEqual(keysOf([own]));
    expect(keys(salesWaitingBefore(first.sales, P2))).toEqual(keysOf([late]));
    expect(() => closePeriod({ ...first, members: [theo] })).toThrow('An earlier period');
  });
});

describe('a statement on the platform’s net (ADR 0050 § 8)', () => {
  const theo = member();
  const lea = member();
  const shifts = [
    shift(theo, '2025-03-17T10:00:00.000Z', '2025-03-17T14:00:00.000Z'),
    shift(lea, '2025-03-18T10:00:00.000Z', '2025-03-18T14:00:00.000Z'),
  ];
  const open = (lines: readonly SaleForPay[], patch: Partial<PeriodSnapshot> = {}) =>
    snapshot({
      period: P2,
      firstClosed: P1,
      lastClosed: P1,
      members: [theo, lea],
      sales: salesOf({ lines, shifts }),
      ...patch,
    });

  it('pays the rate on the net, on a line of its own after the reports’ lines, with the sales it counts', () => {
    const one = sale(linked(theo), '2025-03-17T11:00:00.000Z', 10_000);
    const plan = planPeriod(open([one], { reports: [report(theo, P2, 10_000)] }));
    const content = contentOf(plan, theo);
    expect(
      content.lines.map((line) => [
        line.base,
        line.vatBps,
        line.platformFeeBps,
        line.netMinor,
        line.commissionMinor,
      ]),
    ).toEqual([
      [undefined, 0, 2_000, 8_000, 1_600],
      ['platform_net', 0, 0, 10_000, 2_000],
    ]);
    expect(content.lines[1]?.sales).toEqual([
      {
        platform: 'reveal',
        platformSaleId: one.platformSaleId,
        event: 'sale',
        netMinor: 10_000,
        linkVersion: 'v1',
      },
    ]);
    expect(content.lines[1]?.shiftReportIds).toEqual([]);
    expect(content.netMinor).toBe(18_000);
    expect(content.teamNetMinor).toBe(18_000);
  });

  it('keeps a statement without sales as it was: no base, no sales on its lines', () => {
    const content = contentOf(planPeriod(open([], { reports: [report(theo, P2, 10_000)] })), theo);
    expect(content.lines).toHaveLength(1);
    expect(content.lines[0]).not.toHaveProperty('base');
    expect(content.lines[0]).not.toHaveProperty('sales');
  });

  it('takes a refund off on the same line, negative, and leaves the agent’s sales to nobody', () => {
    const one = sale(linked(theo), '2025-03-17T11:00:00.000Z', 10_000);
    const agents = sale({ kind: 'agent' }, '2025-03-17T12:00:00.000Z', 50_000);
    const plan = planPeriod(open([one, refundOf(one, P2, 4_000), agents]));
    const content = contentOf(plan, theo);
    expect(content.lines.map((line) => [line.grossMinor, line.commissionMinor])).toEqual([[6_000, 1_200]]);
    // In the order of their keys: a refund before its sale.
    expect(content.lines[0]?.sales?.map((line) => [line.event, line.netMinor])).toEqual([
      ['refund', -4_000],
      ['sale', 10_000],
    ]);
    expect(content.teamNetMinor).toBe(6_000);
    expect(written(plan).inserts.map((draft) => draft.content.memberId)).toEqual([theo.id]);
  });

  it('converts a sale in dollars at the latest rate of the period’s last day, and refuses one without a rate', () => {
    const dollars = sale(linked(theo), '2025-03-17T11:00:00.000Z', 10_000, { currency: 'USD' });
    const content = contentOf(planPeriod(open([dollars], { latestRates: [USD] })), theo);
    expect(content.rules.exchangeRates).toEqual([USD]);
    // 100 $ at 0.92: 92 € of net, nothing more taken off.
    expect(content.netMinor).toBe(9_200);
    expect(() => planPeriod(open([dollars]))).toThrow(DomainError);
  });

  it('pays each member their own sales, and a member with sales only gets a statement', () => {
    const plan = planPeriod(
      open([
        sale(linked(theo), '2025-03-17T11:00:00.000Z', 1_000),
        sale(linked(lea), '2025-03-18T11:00:00.000Z', 2_000),
      ]),
    );
    expect(contentOf(plan, theo).netMinor).toBe(1_000);
    expect(contentOf(plan, lea).netMinor).toBe(2_000);
    expect(paysMember(open([sale(linked(lea), '2025-03-18T11:00:00.000Z', 2_000)]), lea.id)).toBe(true);
    expect(periodIsEmpty(open([sale(linked(lea), '2025-03-18T11:00:00.000Z', 2_000)]))).toBe(false);
    expect(periodIsEmpty(open([sale(linked(lea), '2025-03-18T20:00:00.000Z', 2_000)]))).toBe(true);
  });

  it('refuses a sale counted for someone the period does not know, never paying it to nobody', () => {
    const stranger = member();
    const sales = salesOf({
      lines: [sale(linked(stranger), '2025-03-17T11:00:00.000Z', 1_000)],
      shifts: [shift(stranger, '2025-03-17T10:00:00.000Z', '2025-03-17T14:00:00.000Z')],
    });
    expect(() => planPeriod(open([], { sales }))).toThrow('has no member');
  });
});

describe('the closing of a period with sales (ADR 0032, ADR 0050 § 7)', () => {
  const theo = member();
  const lea = member();
  const shifts = [shift(theo, '2025-03-17T10:00:00.000Z', '2025-03-17T14:00:00.000Z')];
  const one = sale(linked(theo), '2025-03-17T11:00:00.000Z', 10_000);
  const open = snapshot({
    period: P2,
    firstClosed: P1,
    lastClosed: P1,
    members: [theo, lea],
    sales: salesOf({ lines: [one], shifts }),
  });

  it('registers the sales it counts, for the member and the link’s version it saw, and freezes them', () => {
    const { closing, closed } = closePeriod(open);
    expect(keys(closing.countedSales)).toEqual(keysOf([one]));
    expect(closing.teamNetMinor).toBe(10_000);
    expect(closed.sales.registered.get(saleKeyOf(one))).toEqual({
      period: P2,
      memberId: theo.id,
      linkVersion: 'v1',
    });
    expect(statementOf(closed, theo.id).inputsHash).toBe(statementOf(open, theo.id).inputsHash);
    // Linked to Léa after the closing: the closed period still gives Théo’s statement, the same.
    const relinked: PeriodSnapshot = {
      ...closed,
      sales: { ...closed.sales, lines: [{ ...one, author: linked(lea, 'v2') }] },
    };
    expect(statementOf(relinked, theo.id).inputsHash).toBe(statementOf(open, theo.id).inputsHash);
  });

  it('takes a refund after the closing off the first open period, for the member the sale paid', () => {
    const { closed } = closePeriod(open);
    const refund = refundOf(one, P3, 10_000, linked(lea, 'v2'));
    const next = snapshot({
      period: P3,
      firstClosed: P1,
      lastClosed: P2,
      members: [theo, lea],
      sales: { ...closed.sales, lines: [{ ...one, author: linked(lea, 'v2') }, refund] },
    });
    const counted = salesCountedIn(next);
    expect(counted.map((line) => [line.line.event, line.memberId, line.lateFrom])).toEqual([
      ['refund', theo.id, P2],
    ]);
    const content = contentOf(planPeriod(next), theo);
    expect(content.lines.map((line) => [line.netMinor, line.commissionMinor])).toEqual([[-10_000, -2_000]]);
    expect(content.lines[0]?.sales).toEqual([
      {
        platform: 'reveal',
        platformSaleId: one.platformSaleId,
        event: 'refund',
        netMinor: -10_000,
        linkVersion: 'v1',
        lateFrom: P2,
      },
    ]);
    expect(paysMember(next, lea.id)).toBe(false);
  });
});
