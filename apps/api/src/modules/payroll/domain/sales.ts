import {
  calendarDayAt,
  earningsBaseOf,
  payRulesFor,
  SALE_WHOLE_BP,
  type Currency,
  type EarningsBase,
  type EarningsSource,
  type PayPeriod,
  type Platform,
  type PlatformAccountId,
  type SaleDecisionInForce,
  type SaleDecisionOutcome,
  type SaleEvent,
  type SaleExcludeReason,
  type SaleHeldReason,
  type SaleStatus,
  type TeamMemberId,
} from '@impera/contracts';

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

/** One text for a sale, its own line and its refunds alike: what a decision is on. */
export const saleIdOf = (key: Omit<SaleKey, 'event'>): string => `${key.platform} ${key.platformSaleId}`;

/**
 * What the validator decided on a sale (CRM-03 lot b3, ADR 0050 § 5, ADR 0101), for its own line and its refunds: it
 * counts for the member its chatter is linked to (`count`), for nobody (`exclude`), or for another member who was
 * decisive (`give`), whole or shared with its author. A decision holds while the chatter's link keeps the version it was
 * made on: linked elsewhere since, the sale follows the rules again and comes back to decide.
 */
export interface SaleDecisionForPay {
  readonly outcome: SaleDecisionInForce;
  /** The link's version of the sale's chatter when it was decided, `null` for a chatter not linked or none. */
  readonly linkVersion: string | null;
  /**
   * For `count`, the member it counts for, the one the link gave then; for `give`, the member who receives it; `null`
   * for `exclude`.
   */
  readonly memberId: TeamMemberId | null;
  /** For `give`, the recipient's share in basis points, `SALE_WHOLE_BP` for the whole sale; `SALE_WHOLE_BP` otherwise. */
  readonly shareBp: number;
  /** The validator's note; required on a `give` (ADR 0101 § 3). */
  readonly note: string | null;
  /** For `exclude`, why (ADR 0101 § 8); `null` otherwise or on an exclusion made before it. */
  readonly excludeReason: SaleExcludeReason | null;
}

/**
 * Whose a line is by the owner's link of its platform chatter (a refund is its sale's): only a member is paid. The
 * agent's link keeps its version too: a sale of the agent given to a member holds while it does (ADR 0101 § 1).
 */
export type SaleAuthorForPay =
  | { readonly kind: 'member'; readonly memberId: TeamMemberId; readonly linkVersion: string }
  | { readonly kind: 'agent'; readonly linkVersion: string }
  | { readonly kind: 'unlinked' }
  | { readonly kind: 'none' };

/** A line of the register as pay reads it: a sale, or the refund of one, never a sum. */
export interface SaleForPay extends SaleKey {
  readonly platformAccountId: PlatformAccountId;
  /** Its status when first read, which it keeps. */
  readonly status: SaleStatus;
  /** When the line happened: a sale's instant, or the refund's own. */
  readonly occurredAt: Date;
  /** The period of the line's own day in the agency's zone: a refund's own, not its sale's. */
  readonly period: PayPeriod;
  /** The sale's instant and its period; `null` for a refund whose sale is older than the register. */
  readonly saleOccurredAt: Date | null;
  readonly salePeriod: PayPeriod | null;
  readonly currency: Currency;
  /** The platform's net in minor units, signed: a refund is negative. */
  readonly netMinor: number;
  readonly author: SaleAuthorForPay;
  /**
   * The platform's account that made the line (a refund's is its sale's), linked or not, `null` for none (a
   * subscription): what the validator reads of a chatter not linked.
   */
  readonly platformChatterId: string | null;
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

/**
 * A member's part of a line the validator shared (ADR 0101 §§ 11–14): their share in basis points, and whether they
 * made the sale (`author`, who takes the rest) or received it (`recipient`, whose part is rounded once).
 */
interface SalePart {
  readonly shareBp: number;
  readonly role: 'author' | 'recipient';
}

/**
 * A line as a period counts it: its key, its account, currency and net, its sale's period, the member it counts for
 * and the link's version that gave it to them; for a shared line, the member's part (`part`), and the net is theirs.
 */
export interface CountedSaleLine extends SaleKey {
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly salePeriod: PayPeriod;
  readonly memberId: TeamMemberId;
  readonly linkVersion: string;
  readonly part: SalePart | null;
}

/**
 * What a closing registered of a line: all a statement takes from it, so that a closed period counts again exactly
 * what its closing saw without reading the register (ADR 0032).
 */
export interface RegisteredSale extends CountedSaleLine {
  readonly period: PayPeriod;
}

/** The fields of a counted line alone, from a registry entry or a counted sale, in one order. */
const countedLineOf = (one: CountedSaleLine): CountedSaleLine => ({
  platform: one.platform,
  platformSaleId: one.platformSaleId,
  event: one.event,
  platformAccountId: one.platformAccountId,
  currency: one.currency,
  netMinor: one.netMinor,
  salePeriod: one.salePeriod,
  memberId: one.memberId,
  linkVersion: one.linkVersion,
  part: one.part,
});

/** What the closing of `period` registers of a line it counts. */
export const registeredIn = (period: PayPeriod, one: CountedSaleLine): RegisteredSale => ({
  ...countedLineOf(one),
  period,
});

/** Everything the sales of a period are counted from, read in the same transaction as the rest of the snapshot. */
export interface SalesSnapshot {
  /**
   * An open period's own lines, and for the team's first open period the late ones the reader found; nothing for a
   * closed period, which counts its registry.
   */
  readonly lines: readonly SaleForPay[];
  /**
   * By `saleKeyOf`: for an open period, the lines a closing registered among those, with the registry of the sale of
   * each refund among them (a refund goes to the member its sale was counted for, or to its two members with the same
   * parts); for a closed period, what its closing registered. A line counted whole has one entry, a shared line two.
   */
  readonly registered: ReadonlyMap<string, readonly RegisteredSale[]>;
  /**
   * By `saleIdOf`: the validator's latest decision on each sale read (CRM-03 lot b3), which its refunds follow.
   */
  readonly decisions: ReadonlyMap<string, SaleDecisionForPay>;
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
  decisions: new Map(),
  sources: [],
  shifts: [],
  accessMarginMinutes: 0,
};

/** A member a line counts for, with the link's version that gave it to them. */
interface SaleHolder {
  readonly memberId: TeamMemberId;
  readonly linkVersion: string;
}

/** What a line is for pay. */
export type SaleAttribution =
  /** It counts for the member. */
  | { readonly kind: 'member'; readonly memberId: TeamMemberId; readonly linkVersion: string }
  /** The validator shared it (ADR 0101 §§ 11–14): the recipient takes their share, rounded once, the author the rest. */
  | {
      readonly kind: 'shared';
      readonly author: SaleHolder;
      readonly recipient: SaleHolder;
      readonly recipientShareBp: number;
    }
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
 * Whether `shift` covers the instant on the account (ADR 0025): widened by the margin on each side, without the
 * margin after the end of a shift stopped while under way.
 */
function covers(
  shift: ShiftForPay,
  accessMarginMinutes: number,
  platformAccountId: PlatformAccountId,
  at: Date,
): boolean {
  const margin = accessMarginMinutes * MINUTE_MS;
  const instant = at.getTime();
  return (
    shift.platformAccountId === platformAccountId &&
    shift.startsAt.getTime() - margin <= instant &&
    instant < shift.endsAt.getTime() + (shift.stopped ? 0 : margin)
  );
}

/**
 * Whether the member could have made the sale (ADR 0025, ADR 0050 § 5): one of their shifts on the account covers its
 * instant. The member's status today is not read: a sale made on shift stays theirs once they are on leave or gone.
 */
function onShiftAt(
  shifts: readonly ShiftForPay[],
  accessMarginMinutes: number,
  memberId: TeamMemberId,
  platformAccountId: PlatformAccountId,
  at: Date,
): boolean {
  return shifts.some(
    (shift) => shift.memberId === memberId && covers(shift, accessMarginMinutes, platformAccountId, at),
  );
}

/** The link's version of the line's chatter: a member's or the agent's, `null` for a chatter not linked or none. */
const linkVersionOf = (author: SaleAuthorForPay): string | null =>
  author.kind === 'member' || author.kind === 'agent' ? author.linkVersion : null;

/**
 * The validator's decision on `line`'s sale, while it holds: made on the link's version the chatter has now (`null`
 * for a chatter not linked or none). A refund follows its sale's decision.
 */
function decisionOn(line: SaleForPay, sales: SalesSnapshot): SaleDecisionForPay | null {
  const decision = sales.decisions.get(saleIdOf(line));
  if (decision === undefined) return null;
  return decision.linkVersion === linkVersionOf(line.author) ? decision : null;
}

/**
 * The recipient's part of a net (ADR 0101 § 13): their share of its magnitude, rounded once, half away from zero, with
 * the net's sign. The author takes the rest, so that the parts always sum to the net; a refund shared with the same
 * shares as its sale takes back exactly what the sale gave each of them.
 */
export function recipientPartOf(netMinor: number, recipientShareBp: number): number {
  const magnitude = Math.floor((Math.abs(netMinor) * recipientShareBp + SALE_WHOLE_BP / 2) / SALE_WHOLE_BP);
  return netMinor < 0 && magnitude > 0 ? -magnitude : magnitude;
}

/**
 * The members `give` may name on `line`'s sale (ADR 0101 § 2): those with a shift on its account that covers its
 * instant, access margin included, other than its author; in one order. A give is on a sale's own line, of a member or
 * of the agent; its refunds follow it. The validator and the members who left with a validated final statement are
 * left out by the reader, who knows them.
 */
export function recipientsOf(line: SaleForPay, sales: SalesSnapshot): TeamMemberId[] {
  const { author } = line;
  if (line.event !== 'sale' || line.saleOccurredAt === null) return [];
  if (author.kind !== 'member' && author.kind !== 'agent') return [];
  const at = line.saleOccurredAt;
  const members = new Set<TeamMemberId>();
  for (const shift of sales.shifts) {
    if (covers(shift, sales.accessMarginMinutes, line.platformAccountId, at)) members.add(shift.memberId);
  }
  if (author.kind === 'member') members.delete(author.memberId);
  return [...members].sort();
}

/**
 * What a `give` in force makes of a sale of a member or of the agent (ADR 0101 §§ 1, 5, 11): the whole sale for its
 * recipient, on the author's link's version, or, for a member's sale, the recipient's share and the rest to the author.
 * A share of the agent's sale is never written (the base refuses it): it would give the agent's part to nobody, so the
 * sale stays the agent's.
 */
function givenAttribution(
  author: Extract<SaleAuthorForPay, { kind: 'member' | 'agent' }>,
  recipientMemberId: TeamMemberId,
  shareBp: number,
): SaleAttribution {
  if (shareBp >= SALE_WHOLE_BP) {
    return { kind: 'member', memberId: recipientMemberId, linkVersion: author.linkVersion };
  }
  if (author.kind === 'agent') return { kind: 'nobody' };
  return {
    kind: 'shared',
    author: { memberId: author.memberId, linkVersion: author.linkVersion },
    recipient: { memberId: recipientMemberId, linkVersion: author.linkVersion },
    recipientShareBp: shareBp,
  };
}

/**
 * Whose the refund of a sale a closing counted is (ADR 0050 § 7, ADR 0101 § 14): the member and the link's version the
 * sale was counted for, whatever the link says since and whatever is decided; for a sale counted in two parts, its two
 * members with the same shares.
 */
function registeredAttribution(paid: readonly RegisteredSale[]): SaleAttribution | null {
  const author = paid.find((one) => one.part?.role === 'author');
  const recipient = paid.find((one) => one.part?.role === 'recipient');
  if (author !== undefined && recipient?.part != null) {
    return {
      kind: 'shared',
      author: { memberId: author.memberId, linkVersion: author.linkVersion },
      recipient: { memberId: recipient.memberId, linkVersion: recipient.linkVersion },
      recipientShareBp: recipient.part.shareBp,
    };
  }
  const [whole] = paid;
  return whole === undefined
    ? null
    : { kind: 'member', memberId: whole.memberId, linkVersion: whole.linkVersion };
}

/**
 * Whose `line` is (ADR 0050 §§ 5, 7, 8, ADR 0101), from the account's base at its sale's period, its status, its
 * author, the shifts and the validator's decision:
 * - a line under the chain of ADR 0023 is the reports' (`outside`);
 * - a refund whose sale was never paid on the platform's net is held, or nobody's once the validator excludes it (no
 *   deduction, until Charles decides, 03/11);
 * - once a closing counted a sale, its refund comes off the member and the link's version it was counted for, or off
 *   its two members with the same shares, whatever the link says since and whatever is decided (ADR 0050 § 7);
 * - no chatter is nobody's;
 * - a sale of a member or of the agent given in force goes to its recipient, whole or shared with its author;
 * - the agent's is nobody's otherwise;
 * - the validator's decision comes next: excluded, nobody's; counted, the member it was counted for, while the link
 *   still gives that member;
 * - then a chatter not linked is held, a member off shift is held, an unknown status is held, and a member on shift
 *   is paid.
 * A refund follows its sale's author, instant and decision.
 */
export function saleAttribution(line: SaleForPay, sales: SalesSnapshot): SaleAttribution {
  const atSale =
    line.salePeriod === null ? null : accountBaseOf(sales.sources, line.platformAccountId, line.salePeriod);
  if (atSale !== 'platform_net' || line.saleOccurredAt === null) {
    // A sale's period is its own: only a refund comes here with the platform's net in force on its own day.
    if (accountBaseOf(sales.sources, line.platformAccountId, line.period) !== 'platform_net') {
      return { kind: 'outside' };
    }
    if (decisionOn(line, sales)?.outcome === 'exclude') return { kind: 'nobody' };
    return {
      kind: 'held',
      reason: line.salePeriod === null ? 'refund_before_register' : 'refund_before_base',
    };
  }
  const paid =
    line.event === 'refund' ? sales.registered.get(saleKeyOf({ ...line, event: 'sale' })) : undefined;
  const fromPaid = paid === undefined ? null : registeredAttribution(paid);
  if (fromPaid !== null) return fromPaid;
  const { author } = line;
  if (author.kind === 'none') return { kind: 'nobody' };
  const decision = decisionOn(line, sales);
  if (
    decision?.outcome === 'give' &&
    decision.memberId !== null &&
    (author.kind === 'member' || author.kind === 'agent')
  ) {
    return givenAttribution(author, decision.memberId, decision.shareBp);
  }
  if (author.kind === 'agent') return { kind: 'nobody' };
  if (decision?.outcome === 'exclude') return { kind: 'nobody' };
  if (author.kind === 'unlinked') return { kind: 'held', reason: 'chatter_unlinked' };
  if (decision?.outcome === 'count' && decision.memberId === author.memberId) {
    return { kind: 'member', memberId: author.memberId, linkVersion: author.linkVersion };
  }
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
  if (line.status === 'other') return { kind: 'held', reason: 'status_unknown' };
  return { kind: 'member', memberId: author.memberId, linkVersion: author.linkVersion };
}

/**
 * What the validator may decide now on the sale of `line` in an open period (CRM-03 lot b3, ADR 0101). Without a
 * decision in force: `count`, `exclude` and `give` on a line held because its member was off shift or its status is
 * unknown, `exclude` alone on any other held line (a chatter not linked, a refund never paid on this net: no deduction
 * until Charles decides, 03/11), `exclude` and `give` on a line a member is paid for but no closing counted yet
 * (wrongly given to them), `give` alone on a sale of the agent. `give` only on a sale's own line, while a member may
 * receive it (`recipientsOf`). With a decision in force: the other outcomes among those, `give` again to change the
 * recipient or the share, and `withdraw`, which gives the sale back to the rules: no decision is final before a closing
 * counts the sale. Nothing on a refund whose sale a closing counted, on no chatter, or outside the platform's net.
 */
export function saleDecisionsOpen(line: SaleForPay, sales: SalesSnapshot): readonly SaleDecisionOutcome[] {
  const undecided = saleAttribution(line, { ...sales, decisions: new Map() });
  const giving: readonly SaleDecisionOutcome[] = recipientsOf(line, sales).length > 0 ? ['give'] : [];
  let open: readonly SaleDecisionOutcome[];
  if (undecided.kind === 'held') {
    open =
      undecided.reason === 'off_shift' || undecided.reason === 'status_unknown'
        ? ['count', 'exclude', ...giving]
        : ['exclude'];
  } else if (undecided.kind === 'member' || undecided.kind === 'shared') {
    const paid = line.event === 'refund' && sales.registered.has(saleKeyOf({ ...line, event: 'sale' }));
    if (paid) return [];
    open = ['exclude', ...giving];
  } else if (undecided.kind === 'nobody' && line.author.kind === 'agent') {
    open = giving;
  } else {
    return [];
  }
  const inForce = decisionOn(line, sales);
  if (inForce === null) return open;
  return [...open.filter((one) => one !== inForce.outcome || one === 'give'), 'withdraw'];
}

/**
 * A member's signal in force on a line of their statement (CRM-03 lot b4c): « ce n'est pas ma vente », with their
 * note. It changes no amount; the validator sees it while the line would pay that member.
 */
export interface SaleSignalForPay {
  readonly memberId: TeamMemberId;
  readonly note: string | null;
  readonly signalledAt: Date;
}

/** The signals in force of a period, by `saleKeyOf` and member: a line is signalled by the member it pays. */
export type SaleSignals = ReadonlyMap<string, readonly SaleSignalForPay[]>;

/**
 * A sale the validator may decide on in an open period: the line shown, why it is held without a decision (`null`: a
 * member would be paid for it, or it is the agent's), the decision in force (`null`: none), the outcomes, the members
 * `give` may name, and the signal in force of the member the line would pay without a decision (`null`: none).
 */
export interface SaleToDecide {
  readonly line: SaleForPay;
  readonly reason: SaleHeldReason | null;
  readonly decision: SaleDecisionForPay | null;
  readonly outcomes: readonly SaleDecisionOutcome[];
  readonly recipients: readonly TeamMemberId[];
  readonly signal: SaleSignalForPay | null;
}

function toDecide(line: SaleForPay, sales: SalesSnapshot, signals: SaleSignals): SaleToDecide {
  const undecided = saleAttribution(line, { ...sales, decisions: new Map() });
  // A signal counts while the line would pay the member who made it: linked again elsewhere, it has no effect.
  const signal =
    undecided.kind === 'member'
      ? (signals.get(saleKeyOf(line))?.find((one) => one.memberId === undecided.memberId) ?? null)
      : null;
  const outcomes = saleDecisionsOpen(line, sales);
  return {
    line,
    reason: undecided.kind === 'held' ? undecided.reason : null,
    decision: decisionOn(line, sales),
    outcomes,
    recipients: outcomes.includes('give') ? recipientsOf(line, sales) : [],
    signal,
  };
}

/**
 * The sale `sale` names as an open period's decision reads it (CRM-03 lot b3): its own line if the period takes it,
 * a refund's otherwise (a refund older than the register), no closing having counted it, with what may be decided now
 * (`saleDecisionsOpen`). `null` when the period does not take it or nothing may be decided on it.
 */
export function saleToDecide(
  sales: SalesSnapshot,
  place: PeriodPlace,
  sale: Omit<SaleKey, 'event'>,
): SaleToDecide | null {
  if (place.closed) return null;
  const lines = sales.lines.filter(
    (line) =>
      saleIdOf(line) === saleIdOf(sale) && !sales.registered.has(saleKeyOf(line)) && takes(place, line),
  );
  const line = lines.find((one) => one.event === 'sale') ?? lines[0];
  if (line === undefined) return null;
  const found = toDecide(line, sales, new Map());
  return found.outcomes.length === 0 ? null : found;
}

/**
 * What an open period shows the owner and the validator (CRM-03 lots b3, b4c, ADR 0101), in key order: the lines it
 * takes that no closing counted and that are held without a decision, settled by a decision in force, or signalled by
 * the member they would pay (`signals`), so that every decision can be seen and taken back, and every signal answered.
 * A sale of the agent shows once given; before, it is one of many and is found where the agent's sales are read. A
 * closed period shows nothing: what it did not register goes to the first open period.
 */
export function salesToDecide(
  sales: SalesSnapshot,
  place: PeriodPlace,
  signals: SaleSignals = new Map(),
): SaleToDecide[] {
  if (place.closed) return [];
  const shown: SaleToDecide[] = [];
  for (const line of sales.lines) {
    if (sales.registered.has(saleKeyOf(line)) || !takes(place, line)) continue;
    const one = toDecide(line, sales, signals);
    if (one.reason !== null || one.decision !== null || one.signal !== null) shown.push(one);
  }
  return byKey(shown, (one) => one.line);
}

/**
 * The sales of `day`, in the agency's `timeZone`, that an open period takes and that `give` may name a member on (ADR
 * 0101 §§ 1, 2): where the validator finds a sale nobody signalled, a member's or the agent's, to give it to the member
 * who was decisive. Each comes with its decision in force and its signal, so that a sale already given reads as given;
 * in the order of their instants. A closed period gives none.
 */
export function salesToGive(
  sales: SalesSnapshot,
  place: PeriodPlace,
  day: string,
  timeZone: string,
  signals: SaleSignals = new Map(),
): SaleToDecide[] {
  if (place.closed) return [];
  const found: SaleToDecide[] = [];
  for (const line of sales.lines) {
    if (line.event !== 'sale' || sales.registered.has(saleKeyOf(line)) || !takes(place, line)) continue;
    if (calendarDayAt(line.occurredAt, timeZone) !== day) continue;
    const one = toDecide(line, sales, signals);
    if (one.outcomes.includes('give')) found.push(one);
  }
  return found.sort(
    (a, b) =>
      a.line.occurredAt.getTime() - b.line.occurredAt.getTime() ||
      (saleKeyOf(a.line) < saleKeyOf(b.line) ? -1 : 1),
  );
}

/** A line a period counts, and the earlier period it comes late from. */
export interface CountedSale extends CountedSaleLine {
  /** The sale's period when it is earlier than the period counting the line, `null` otherwise. */
  readonly lateFrom: PayPeriod | null;
  /** The line's own instant, for its member to read (CRM-03 lot b4c); `null` from a closing's registry. */
  readonly occurredAt: Date | null;
}

/** A line the period would count but holds, and why. */
export interface HeldSale {
  readonly line: SaleForPay;
  readonly reason: SaleHeldReason;
}

const byKey = <T>(items: readonly T[], keyOf: (item: T) => SaleKey): T[] =>
  [...items].sort((a, b) => {
    const left = saleKeyOf(keyOf(a));
    const right = saleKeyOf(keyOf(b));
    return left < right ? -1 : left > right ? 1 : 0;
  });

/** Counted lines in key order, the two parts of a shared line by their member: one order, whatever the read gave. */
const byOrder = <T extends SaleKey & { readonly memberId: TeamMemberId }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => {
    const left = `${saleKeyOf(a)} ${a.memberId}`;
    const right = `${saleKeyOf(b)} ${b.memberId}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });

/** Where the sales of `period` stand: closed or not, and the team's first open period. */
export interface PeriodPlace {
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

const lateFrom = (salePeriod: PayPeriod, period: PayPeriod): PayPeriod | null =>
  salePeriod < period ? salePeriod : null;

/**
 * The lines `place.period` counts, in key order (see above): a closed period, exactly what its closing registered
 * there, for the member and the link's version registered; an open one, the lines no closing registered that it
 * takes and that a member is paid for.
 */
export function salesCounted(sales: SalesSnapshot, place: PeriodPlace): CountedSale[] {
  const counted: CountedSale[] = [];
  if (place.closed) {
    for (const parts of sales.registered.values()) {
      for (const registered of parts) {
        if (registered.period !== place.period) continue;
        counted.push({
          ...countedLineOf(registered),
          lateFrom: lateFrom(registered.salePeriod, place.period),
          occurredAt: null,
        });
      }
    }
    return byOrder(counted);
  }
  for (const line of sales.lines) {
    if (sales.registered.has(saleKeyOf(line)) || !takes(place, line)) continue;
    const attribution = saleAttribution(line, sales);
    // A member is paid only for a sale of a period on the platform's net, so its period is known.
    if (line.salePeriod === null) continue;
    const { salePeriod } = line;
    const one = (holder: SaleHolder, netMinor: number, part: SalePart | null): CountedSale => ({
      platform: line.platform,
      platformSaleId: line.platformSaleId,
      event: line.event,
      platformAccountId: line.platformAccountId,
      currency: line.currency,
      netMinor,
      salePeriod,
      memberId: holder.memberId,
      linkVersion: holder.linkVersion,
      part,
      lateFrom: lateFrom(salePeriod, place.period),
      occurredAt: line.occurredAt,
    });
    if (attribution.kind === 'member') {
      counted.push(one(attribution, line.netMinor, null));
    } else if (attribution.kind === 'shared') {
      const given = recipientPartOf(line.netMinor, attribution.recipientShareBp);
      counted.push(
        one(attribution.author, line.netMinor - given, {
          shareBp: SALE_WHOLE_BP - attribution.recipientShareBp,
          role: 'author',
        }),
        one(attribution.recipient, given, { shareBp: attribution.recipientShareBp, role: 'recipient' }),
      );
    }
  }
  return byOrder(counted);
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
  return byKey(held, (one) => one.line);
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

/**
 * The lines the closing of `period` leaves held (CRM-03 lot b3): those it would take and holds, the earlier periods'
 * too before the team's first closing. The closing keeps them (`pay_period_held_sales`): a decision, a new link or a
 * shift entered after it still brings them into the first open period, where they show until decided.
 */
export function salesLeftHeld(sales: SalesSnapshot, period: PayPeriod): HeldSale[] {
  return salesHeld(sales, { period, closed: false, firstOpen: period });
}

/**
 * A counted line as a statement keeps it: its key, its net, the link's version, where it comes late from, and for a
 * shared line the member's share (ADR 0101 § 13), absent on a whole line so that every statement written before keeps
 * its content and its `inputsHash`.
 */
export interface StatementSale extends SaleKey {
  readonly netMinor: number;
  readonly linkVersion: string;
  readonly lateFrom?: PayPeriod;
  readonly shareBp?: number;
  /**
   * The line's own instant, in ISO, for its member to read and signal it (CRM-03 lot b4c): kept on the statement, out
   * of its `inputsHash` (`inputsHashOf`), absent on a statement written before it and on a closed period's.
   */
  readonly occurredAt?: string;
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
  for (const one of byOrder(counted)) {
    const key = `${one.platformAccountId} ${one.currency}`;
    const group = groups.get(key) ?? {
      platformAccountId: one.platformAccountId,
      currency: one.currency,
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
      netMinor: group.sales.reduce((total, one) => total + one.netMinor, 0),
      sales: group.sales.map((one) => ({
        platform: one.platform,
        platformSaleId: one.platformSaleId,
        event: one.event,
        netMinor: one.netMinor,
        linkVersion: one.linkVersion,
        ...(one.lateFrom !== null && { lateFrom: one.lateFrom }),
        ...(one.part !== null && { shareBp: one.part.shareBp }),
        ...(one.occurredAt !== null && { occurredAt: one.occurredAt.toISOString() }),
      })),
    }));
}
