import {
  earningsBaseOf,
  payRulesFor,
  type Currency,
  type EarningsBase,
  type EarningsSource,
  type PayPeriod,
  type Platform,
  type PlatformAccountId,
  type SaleEvent,
  type SaleStatus,
  type TeamMemberId,
} from '@nirvana/contracts';

/**
 * The sales a platform records, as pay counts them for an account whose rules read them (CRM-03; ADR 0050 §§ 5, 7, 8):
 * pure, without a clock or the database. The connectors give the lines one by one (`salesFeedReadsForPay`), the
 * planning gives the accounts' rules and the shifts; this file says, for each line, whose it is, and which period
 * counts it.
 *
 * Which period counts a line is decided by the registry of counted sales, never by a date, as ADR 0032 decides for
 * the reports: a closed period counts exactly the lines its closing registered, for the member and the link's version
 * the closing saw; an open period counts the lines no closing registered whose sale is in it, and the team's first open
 * period also counts those of an earlier period (late lines: recorded, released from quarantine or linked after a
 * closing, refunded after it). A line is registered once: a link changed after a closing never pays it twice.
 */

/** A line's key at the platform: a sale and its refund share the id. */
export interface SaleKey {
  readonly platform: Platform;
  readonly platformSaleId: string;
  readonly event: SaleEvent;
}

/** One text for one key, the registry's and the order's. */
export const saleKeyOf = (key: SaleKey): string => `${key.platform} ${key.platformSaleId} ${key.event}`;

/** Whose a line is by the owner's link of its platform chatter (a refund is its sale's): only a member is paid. */
export type SaleAuthorForPay =
  | { readonly kind: 'member'; readonly memberId: TeamMemberId; readonly linkVersion: string }
  | { readonly kind: 'agent' }
  | { readonly kind: 'unlinked' }
  | { readonly kind: 'none' };

/** A line of the register as pay reads it: a sale, or the refund of one, never a sum. */
export interface SaleForPay extends SaleKey {
  readonly platformAccountId: PlatformAccountId;
  /** Its status when first read, which it keeps. */
  readonly status: SaleStatus;
  /** The period of the line's own day in the agency's zone: a refund's own, not its sale's. */
  readonly period: PayPeriod;
  /** The sale's instant and its period; `null` for a refund whose sale is older than the register. */
  readonly saleOccurredAt: Date | null;
  readonly salePeriod: PayPeriod | null;
  readonly currency: Currency;
  /** The platform's net in minor units, signed: a refund is negative. */
  readonly netMinor: number;
  readonly author: SaleAuthorForPay;
}

/** Where an account's sales come from from a period on, with its platform (`earningsBaseOf`). */
export interface AccountSourceForPay {
  readonly platformAccountId: PlatformAccountId;
  readonly platform: Platform;
  readonly fromPeriod: PayPeriod;
  readonly earningsSource: EarningsSource;
}

/** A shift as the attribution reads it, cancelled ones left out by the reader. */
export interface ShiftForPay {
  readonly memberId: TeamMemberId;
  readonly platformAccountId: PlatformAccountId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Stopped while under way: no margin after its end (contract `scheduling.ts`). */
  readonly stopped: boolean;
}

/** What a closing registered of a line: the member it counted for and the link's version it saw. */
interface RegisteredSale {
  readonly period: PayPeriod;
  readonly memberId: TeamMemberId;
  readonly linkVersion: string;
}

/** Everything the sales of a period are counted from, read in the same transaction as the rest of the snapshot. */
export interface SalesSnapshot {
  /** The period's own lines, and for the team's first open period the late ones the reader found. */
  readonly lines: readonly SaleForPay[];
  /**
   * Of those lines, the ones a closing registered, by `saleKeyOf`, with the registry of the sale of each refund among
   * them: a refund goes to the member its sale was counted for.
   */
  readonly registered: ReadonlyMap<string, RegisteredSale>;
  /** Every account's dated sources, from its first rules on. */
  readonly sources: readonly AccountSourceForPay[];
  /** The shifts covering the sales' instants, with the margin around them. */
  readonly shifts: readonly ShiftForPay[];
  readonly accessMarginMinutes: number;
}

/** No account reads its sales: what every period had before CRM-03, and has while no account is `detected`. */
export const NO_SALES: SalesSnapshot = {
  lines: [],
  registered: new Map(),
  sources: [],
  shifts: [],
  accessMarginMinutes: 0,
};

/**
 * Why a line that the account's base would pay counts for nobody until someone acts (CRM-03 lot b3 shows them):
 * - `refund_before_register`: a refund whose sale is older than the register;
 * - `refund_before_base`: a refund whose sale was in a period the account was still paid on its reports (ADR 0023's
 *   chain): it is never taken off the platform's net, whose sale it never was (held until Charles decides, 03/11);
 * - `status_unknown`: a status the platform added that Nirvana does not know (ADR 0050 § 3);
 * - `chatter_unlinked`: a chatter the owner has not linked yet (ADR 0050 § 5);
 * - `off_shift`: a member neither on shift nor in their margin at the sale's instant (ADR 0050 § 5, ADR 0025).
 */
type SaleHeldReason =
  'refund_before_register' | 'refund_before_base' | 'status_unknown' | 'chatter_unlinked' | 'off_shift';

/** What a line is for pay. */
export type SaleAttribution =
  /** It counts for the member. */
  | { readonly kind: 'member'; readonly memberId: TeamMemberId; readonly linkVersion: string }
  /** Held, for nobody until someone acts. */
  | { readonly kind: 'held'; readonly reason: SaleHeldReason }
  /** Nobody's, and nothing to act on: the agent's, or without a chatter (ADR 0050 § 8). */
  | { readonly kind: 'nobody' }
  /** Not pay's to count on the platform's net: the account's reports pay that period (`gross_chain`). */
  | { readonly kind: 'outside' };

/** The account's base for `period`: the platform's net only under `detected` rules of a platform that gives one. */
function accountBaseOf(
  sources: readonly AccountSourceForPay[],
  platformAccountId: PlatformAccountId,
  period: PayPeriod,
): EarningsBase {
  const rule = payRulesFor(
    sources.filter((one) => one.platformAccountId === platformAccountId),
    period,
  );
  return rule === null ? 'gross_chain' : earningsBaseOf(rule.platform, rule.earningsSource);
}

const MINUTE_MS = 60_000;

/**
 * Whether the member could have made the sale (ADR 0025, ADR 0050 § 5): one of their shifts on the account covers its
 * instant, widened by the margin on each side, without the margin after the end of a shift stopped while under way.
 * The member's status today is not read: a sale made on shift stays theirs once they are on leave or gone.
 */
function onShiftAt(
  shifts: readonly ShiftForPay[],
  accessMarginMinutes: number,
  memberId: TeamMemberId,
  platformAccountId: PlatformAccountId,
  at: Date,
): boolean {
  const margin = accessMarginMinutes * MINUTE_MS;
  const instant = at.getTime();
  return shifts.some(
    (shift) =>
      shift.memberId === memberId &&
      shift.platformAccountId === platformAccountId &&
      shift.startsAt.getTime() - margin <= instant &&
      instant < shift.endsAt.getTime() + (shift.stopped ? 0 : margin),
  );
}

/**
 * Whose `line` is (ADR 0050 §§ 5, 7, 8), from the account's base at its sale's period, its status, its author and the
 * shifts: a line under the chain of ADR 0023 is the reports' (`outside`), a refund whose sale was never paid on the
 * platform's net is held, an unknown status is held, the agent's or no chatter is nobody's, a chatter not linked is
 * held, a member off shift is held, and a member on shift is paid. A refund follows its sale's author and instant,
 * and once a closing counted its sale, the member and the link's version it was counted for: the refund comes off the
 * commission that sale paid, whatever the link says since (ADR 0050 § 7).
 */
export function saleAttribution(line: SaleForPay, sales: SalesSnapshot): SaleAttribution {
  const atSale =
    line.salePeriod === null ? null : accountBaseOf(sales.sources, line.platformAccountId, line.salePeriod);
  if (atSale !== 'platform_net' || line.saleOccurredAt === null) {
    // A sale's period is its own: only a refund comes here with the platform's net in force on its own day.
    if (accountBaseOf(sales.sources, line.platformAccountId, line.period) !== 'platform_net') {
      return { kind: 'outside' };
    }
    return {
      kind: 'held',
      reason: line.salePeriod === null ? 'refund_before_register' : 'refund_before_base',
    };
  }
  if (line.status === 'other') return { kind: 'held', reason: 'status_unknown' };
  const paid =
    line.event === 'refund' ? sales.registered.get(saleKeyOf({ ...line, event: 'sale' })) : undefined;
  if (paid !== undefined) return { kind: 'member', memberId: paid.memberId, linkVersion: paid.linkVersion };
  const { author } = line;
  if (author.kind === 'agent' || author.kind === 'none') return { kind: 'nobody' };
  if (author.kind === 'unlinked') return { kind: 'held', reason: 'chatter_unlinked' };
  if (
    !onShiftAt(
      sales.shifts,
      sales.accessMarginMinutes,
      author.memberId,
      line.platformAccountId,
      line.saleOccurredAt,
    )
  ) {
    return { kind: 'held', reason: 'off_shift' };
  }
  return { kind: 'member', memberId: author.memberId, linkVersion: author.linkVersion };
}

/** A line a period counts, for whom, under which link's version, and the earlier period it comes late from. */
export interface CountedSale {
  readonly line: SaleForPay;
  readonly memberId: TeamMemberId;
  readonly linkVersion: string;
  /** The sale's period when it is earlier than the period counting the line, `null` otherwise. */
  readonly lateFrom: PayPeriod | null;
}

/** A line the period would count but holds, and why. */
export interface HeldSale {
  readonly line: SaleForPay;
  readonly reason: SaleHeldReason;
}

const byKey = <T extends { readonly line: SaleKey }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => {
    const left = saleKeyOf(a.line);
    const right = saleKeyOf(b.line);
    return left < right ? -1 : left > right ? 1 : 0;
  });

/** Where the sales of `period` stand: closed or not, and the team's first open period. */
interface PeriodPlace {
  readonly period: PayPeriod;
  readonly closed: boolean;
  readonly firstOpen: PayPeriod | null;
}

/** Whether an open period takes a line no closing registered: its own sale, or a late one in the first open period. */
function takes(place: PeriodPlace, line: SaleForPay): boolean {
  if (line.salePeriod === null) {
    // A refund older than the register is held: it shows in the period of its own day, or late in the first open one.
    return line.period === place.period || (place.firstOpen === place.period && line.period < place.period);
  }
  return (
    line.salePeriod === place.period || (place.firstOpen === place.period && line.salePeriod < place.period)
  );
}

const lateFrom = (line: SaleForPay, period: PayPeriod): PayPeriod | null =>
  line.salePeriod !== null && line.salePeriod < period ? line.salePeriod : null;

/**
 * The lines `place.period` counts, in key order (see above): a closed period, exactly what its closing registered
 * there, for the member and the link's version registered; an open one, the lines no closing registered that it
 * takes and that a member is paid for.
 */
export function salesCounted(sales: SalesSnapshot, place: PeriodPlace): CountedSale[] {
  const counted: CountedSale[] = [];
  for (const line of sales.lines) {
    const registered = sales.registered.get(saleKeyOf(line));
    if (place.closed) {
      if (registered?.period === place.period) {
        counted.push({
          line,
          memberId: registered.memberId,
          linkVersion: registered.linkVersion,
          lateFrom: lateFrom(line, place.period),
        });
      }
      continue;
    }
    if (registered !== undefined || !takes(place, line)) continue;
    const attribution = saleAttribution(line, sales);
    if (attribution.kind === 'member') {
      counted.push({
        line,
        memberId: attribution.memberId,
        linkVersion: attribution.linkVersion,
        lateFrom: lateFrom(line, place.period),
      });
    }
  }
  return byKey(counted);
}

/**
 * The lines an open period would take but holds, in key order: what the owner and the validator have to see
 * (CRM-03 lot b3). A closed period holds nothing more: what it did not register goes to the first open period.
 */
export function salesHeld(sales: SalesSnapshot, place: PeriodPlace): HeldSale[] {
  if (place.closed) return [];
  const held: HeldSale[] = [];
  for (const line of sales.lines) {
    if (sales.registered.has(saleKeyOf(line)) || !takes(place, line)) continue;
    const attribution = saleAttribution(line, sales);
    if (attribution.kind === 'held') held.push({ line, reason: attribution.reason });
  }
  return byKey(held);
}

/**
 * Before the team's first closing, the lines of an earlier period than `period` that a member would be paid for and
 * no closing registered: a closing of `period` would leave them behind, as an earlier report (ADR 0032).
 */
export function salesWaitingBefore(sales: SalesSnapshot, period: PayPeriod): CountedSale[] {
  return salesCounted(sales, { period, closed: false, firstOpen: period }).filter(
    (one) => one.lateFrom !== null,
  );
}

/** A counted line as a statement keeps it: its key, its net, the link's version, and where it comes late from. */
export interface StatementSale extends SaleKey {
  readonly netMinor: number;
  readonly linkVersion: string;
  readonly lateFrom?: PayPeriod;
}

/** The counted lines of one account and currency for one member: one line of the statement, on the platform's net. */
export interface SaleLineGroup {
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly sales: readonly StatementSale[];
}

/**
 * A member's counted lines, one group per account and currency, in one order: summed on the account's total for the
 * period, never sale by sale, as the engine rounds an account once (ADR 0023).
 */
export function saleLinesOf(counted: readonly CountedSale[]): SaleLineGroup[] {
  const groups = new Map<
    string,
    { platformAccountId: PlatformAccountId; currency: Currency; sales: CountedSale[] }
  >();
  for (const one of byKey(counted)) {
    const key = `${one.line.platformAccountId} ${one.line.currency}`;
    const group = groups.get(key) ?? {
      platformAccountId: one.line.platformAccountId,
      currency: one.line.currency,
      sales: [],
    };
    group.sales.push(one);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => ({
      platformAccountId: group.platformAccountId,
      currency: group.currency,
      netMinor: group.sales.reduce((total, one) => total + one.line.netMinor, 0),
      sales: group.sales.map((one) => ({
        platform: one.line.platform,
        platformSaleId: one.line.platformSaleId,
        event: one.line.event,
        netMinor: one.line.netMinor,
        linkVersion: one.linkVersion,
        ...(one.lateFrom !== null && { lateFrom: one.lateFrom }),
      })),
    }));
}
