import {
  calendarDayAt,
  CurrencySchema,
  earningsBaseOf,
  nextPayPeriod,
  payPeriodOfDay,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SALE_WHOLE_BP,
  SaleDecisionOutcomeSchema,
  SaleEventSchema,
  SaleExcludeReasonSchema,
  TeamMemberIdSchema,
  type Currency,
  type PayPeriod,
  type Platform,
  type PlatformAccountId,
  type SaleStatus,
  type TeamMemberId,
} from '@impera/contracts';
import { enterCreator, eq, schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import {
  NO_SALES,
  saleIdOf,
  saleKeyOf,
  salesCounted,
  salesLeftHeld,
  salesWaitingBefore,
  type AccountSourceForPay,
  type RegisteredSale,
  type SaleAuthorForPay,
  type SaleDecisionForPay,
  type SaleForPay,
  type SaleKey,
  type SalesSnapshot,
  type ShiftForPay,
} from '../domain/sales';

const { payPeriodClosings, payPeriodSales, paySaleDecisions } = schema;

/** A line of the platform's register as the sales feed gives it to pay (connectors' `PaySaleLine`, CRM-03). */
interface SaleLineRead extends SaleKey {
  readonly status: SaleStatus;
  readonly platformAccountId: PlatformAccountId;
  /** When the line happened: a sale's instant, or the refund's own. */
  readonly occurredAt: Date;
  /** The sale's instant and its day in the zone given; `null` for a refund whose sale is older than the register. */
  readonly saleOccurredAt: Date | null;
  readonly saleDay: string | null;
  readonly currency: Currency;
  /** Signed: a refund is negative. */
  readonly netMinor: number;
  /** Whose it is by the owner's link (a refund is its sale's); more fields may come with it, pay keeps these. */
  readonly author:
    | {
        readonly kind: 'member';
        readonly memberId: TeamMemberId;
        readonly platformChatterId: string;
        readonly linkVersion: string;
      }
    | { readonly kind: 'agent'; readonly platformChatterId: string; readonly linkVersion: string }
    | { readonly kind: 'unlinked'; readonly platformChatterId: string }
    | { readonly kind: 'none' };
}

/** Which lines a read takes: some accounts, and a range `[from, to)` of instants (connectors' `PaySalesRange`). */
interface SaleLinesRange {
  readonly platformAccountIds: readonly PlatformAccountId[];
  readonly from: Date;
  readonly to: Date;
  readonly timeZone: string;
}

type ReadLines = (tx: Transaction, range: SaleLinesRange) => Promise<readonly SaleLineRead[]>;

/** Which lines a read by sale takes: some accounts, and some sales with their refunds (connectors' `PaySalesOfKeys`). */
interface SaleLinesOfKeys {
  readonly platformAccountIds: readonly PlatformAccountId[];
  readonly sales: readonly { readonly platform: Platform; readonly platformSaleId: string }[];
  readonly timeZone: string;
}

/**
 * What pay reads of the planning and of the sales feed to count the platform's sales (CRM-03, ADR 0050 §§ 5, 7, 8), in
 * its own transaction and under its policies, given by the composition root from their `index.ts`: every account's
 * dated rules with its platform, the shifts on some accounts over a range, the access margin, and the register's lines
 * by the day of their sale, by the instant they were recorded, and by the instant their chatter's link got its version.
 */
export interface PaySalesReads {
  readonly accountSources: (tx: Transaction) => Promise<readonly AccountSourceForPay[]>;
  readonly shifts: (
    tx: Transaction,
    platformAccountIds: readonly PlatformAccountId[],
    from: Date,
    to: Date,
  ) => Promise<readonly ShiftForPay[]>;
  readonly accessMarginMinutes: (tx: Transaction) => Promise<number>;
  readonly linesOfSalesBetween: ReadLines;
  readonly linesRecordedBetween: ReadLines;
  readonly linesRelinkedBetween: ReadLines;
  readonly linesOfSales: (tx: Transaction, keys: SaleLinesOfKeys) => Promise<readonly SaleLineRead[]>;
}

/** Whose policies a read runs under: the job's admin connection, or the validating member creator by creator. */
export type PayReadScope =
  { readonly kind: 'admin' } | { readonly kind: 'member'; readonly creatorIds: readonly string[] };

/** A period's sales, and the creator of each account they were read in (the registry is written in it). */
export interface PeriodSales {
  readonly sales: SalesSnapshot;
  readonly creatorOfAccount: ReadonlyMap<PlatformAccountId, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Wider than the longest access margin (120 minutes, contract `scheduling.ts`). */
const SHIFT_SLACK_MS = 3 * 60 * 60 * 1000;
/** Longer than any transaction: a line recorded by one still open while a closing ran is read again after it. */
const LATE_SLACK_MS = DAY_MS;
const EVER = new Date(0);
const NEVER = new Date('9999-12-31T00:00:00.000Z');

/**
 * The accounts whose sales pay counts on the platform's net in `period` or an earlier one (ADR 0050 § 8): rules in
 * force from then on, `detected`, of a platform that gives a net. An account paid on its reports alone is never read.
 */
function netAccounts(sources: readonly AccountSourceForPay[], period: PayPeriod): PlatformAccountId[] {
  const accounts = new Set<PlatformAccountId>();
  for (const source of sources) {
    if (
      source.fromPeriod <= period &&
      earningsBaseOf(source.platform, source.earningsSource) === 'platform_net'
    ) {
      accounts.add(source.platformAccountId);
    }
  }
  return [...accounts].sort();
}

function authorOf(author: SaleLineRead['author']): SaleAuthorForPay {
  switch (author.kind) {
    case 'member':
      return { kind: 'member', memberId: author.memberId, linkVersion: author.linkVersion };
    case 'agent':
      return { kind: 'agent', linkVersion: author.linkVersion };
    case 'unlinked':
    case 'none':
      return { kind: author.kind };
  }
}

/** A line as the attribution reads it: the period of its own day and of its sale's, in the agency's zone. */
function saleForPayOf(line: SaleLineRead, timeZone: string): SaleForPay {
  return {
    platform: line.platform,
    platformSaleId: line.platformSaleId,
    event: line.event,
    platformAccountId: line.platformAccountId,
    status: line.status,
    occurredAt: line.occurredAt,
    period: payPeriodOfDay(calendarDayAt(line.occurredAt, timeZone)),
    saleOccurredAt: line.saleOccurredAt,
    salePeriod: line.saleDay === null ? null : payPeriodOfDay(line.saleDay),
    currency: line.currency,
    netMinor: line.netMinor,
    author: authorOf(line.author),
    platformChatterId: line.author.kind === 'none' ? null : line.author.platformChatterId,
  };
}

const RegisteredRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string(),
  event: SaleEventSchema,
  period: PayPeriodSchema,
  memberId: TeamMemberIdSchema,
  linkVersion: z.string(),
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  netMinor: z.number().int(),
  salePeriod: PayPeriodSchema,
  shareBp: z.number().int(),
  shareRole: z.enum(['author', 'recipient']).nullable(),
});

/** A registry row as the domain reads it, its key and what a statement takes from it. */
const registeredOfRow = (row: typeof payPeriodSales.$inferSelect): RegisteredSale => {
  const one = RegisteredRowSchema.parse(row);
  return {
    platform: one.platform,
    platformSaleId: one.platformSaleId,
    event: one.event,
    platformAccountId: one.platformAccountId,
    currency: one.currency,
    netMinor: one.netMinor,
    salePeriod: one.salePeriod,
    memberId: one.memberId,
    linkVersion: one.linkVersion,
    part: one.shareRole === null ? null : { shareBp: one.shareBp, role: one.shareRole },
    period: one.period,
  };
};

/** The registry's rows by line: one for a line counted whole, two for a shared one (ADR 0101), by member. */
function byKeyOf(rows: readonly (typeof payPeriodSales.$inferSelect)[]): Map<string, RegisteredSale[]> {
  const byKey = new Map<string, RegisteredSale[]>();
  for (const row of rows) {
    const one = registeredOfRow(row);
    const key = saleKeyOf(one);
    byKey.set(
      key,
      [...(byKey.get(key) ?? []), one].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    );
  }
  return byKey;
}

/** The registry's entries of `lines`, and of the sale of each refund among them: both events of each sale read. */
async function registeredAmong(
  tx: Transaction,
  lines: readonly SaleKey[],
): Promise<Map<string, RegisteredSale[]>> {
  if (lines.length === 0) return new Map();
  const sales = [...new Map(lines.map((line) => [`${line.platform} ${line.platformSaleId}`, line])).values()];
  const rows = await tx
    .select()
    .from(payPeriodSales)
    .where(
      sql`(${payPeriodSales.platform}, ${payPeriodSales.platformSaleId}) in (${sql.join(
        sales.map((one) => sql`(${one.platform}, ${one.platformSaleId})`),
        sql`, `,
      )})`,
    );
  return byKeyOf(rows);
}

const DecisionRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string(),
  outcome: SaleDecisionOutcomeSchema,
  authorMemberId: TeamMemberIdSchema.nullable(),
  linkVersion: z.string().nullable(),
  recipientMemberId: TeamMemberIdSchema.nullable(),
  shareBp: z.number().int().nullable(),
  excludeReason: SaleExcludeReasonSchema.nullable(),
  note: z.string().nullable(),
});

/** Sales named in one query at most: a longer list is read in several. */
const SALES_PER_QUERY = 500;

/**
 * The decision in force on the sale of each of `lines` (CRM-03 lot b3), by `saleIdOf`: its refunds follow it. The
 * latest decision counts, and a `withdraw` leaves none.
 */
async function decisionsAmong(
  tx: Transaction,
  lines: readonly SaleKey[],
): Promise<Map<string, SaleDecisionForPay>> {
  const sales = [...new Map(lines.map((line) => [saleIdOf(line), line])).values()];
  const decisions = new Map<string, SaleDecisionForPay>();
  for (let start = 0; start < sales.length; start += SALES_PER_QUERY) {
    const named = sales
      .slice(start, start + SALES_PER_QUERY)
      .map((one) => sql`(${one.platform}, ${one.platformSaleId})`);
    const rows = await tx
      .selectDistinctOn([paySaleDecisions.platform, paySaleDecisions.platformSaleId], {
        platform: paySaleDecisions.platform,
        platformSaleId: paySaleDecisions.platformSaleId,
        outcome: paySaleDecisions.outcome,
        authorMemberId: paySaleDecisions.authorMemberId,
        linkVersion: paySaleDecisions.linkVersion,
        recipientMemberId: paySaleDecisions.recipientMemberId,
        shareBp: paySaleDecisions.shareBp,
        excludeReason: paySaleDecisions.excludeReason,
        note: paySaleDecisions.note,
      })
      .from(paySaleDecisions)
      .where(
        sql`(${paySaleDecisions.platform}, ${paySaleDecisions.platformSaleId}) in (${sql.join(named, sql`, `)})`,
      )
      .orderBy(
        paySaleDecisions.platform,
        paySaleDecisions.platformSaleId,
        sql`${paySaleDecisions.revision} desc`,
      );
    for (const row of rows) {
      const one = DecisionRowSchema.parse(row);
      if (one.outcome === 'withdraw') continue;
      decisions.set(saleIdOf(one), {
        outcome: one.outcome,
        linkVersion: one.linkVersion,
        memberId:
          one.outcome === 'count'
            ? one.authorMemberId
            : one.outcome === 'give'
              ? one.recipientMemberId
              : null,
        shareBp: one.outcome === 'give' ? (one.shareBp ?? SALE_WHOLE_BP) : SALE_WHOLE_BP,
        note: one.note,
        excludeReason: one.excludeReason,
      });
    }
  }
  return decisions;
}

const PendingRowSchema = z.object({ platform: PlatformSchema, platform_sale_id: z.string().min(1) });

/**
 * The sales pay keeps reading in the team's first open period although no range would take them (CRM-03 lot b3), on
 * some accounts: those with a line a closing left held, and those the validator decided, whatever the decision, until
 * a closing counts them. The domain says what each one is now: a decision taken back, or made on a link's version the
 * chatter no longer has, gives the sale back to the rules.
 */
async function pendingSales(
  tx: Transaction,
  accounts: readonly PlatformAccountId[],
): Promise<{ readonly platform: Platform; readonly platformSaleId: string }[]> {
  const ids = sql.join(
    accounts.map((one) => sql`${one}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    select p.platform, p.platform_sale_id
      from (
        select h.platform, h.platform_sale_id, h.platform_account_id
          from pay_period_held_sales h
         where not exists (select 1 from pay_period_sales r where r.platform = h.platform
                             and r.platform_sale_id = h.platform_sale_id and r.event = h.event)
        union
        select d.platform, d.platform_sale_id, d.platform_account_id
          from pay_sale_decisions d
         where not exists (select 1 from pay_period_sales r where r.platform = d.platform
                             and r.platform_sale_id = d.platform_sale_id)
      ) p
     where p.platform_account_id in (${ids})
     group by p.platform, p.platform_sale_id
     order by p.platform, p.platform_sale_id`);
  return result.rows.map((row) => {
    const one = PendingRowSchema.parse(row);
    return { platform: one.platform, platformSaleId: one.platform_sale_id };
  });
}

/** What the closing of `period` registered: a closed period counts it again without reading the register. */
async function registeredIn(tx: Transaction, period: PayPeriod): Promise<Map<string, RegisteredSale[]>> {
  return byKeyOf(await tx.select().from(payPeriodSales).where(eq(payPeriodSales.period, period)));
}

/** From when the team's first open period reads late lines: the last closing, less a day (`LATE_SLACK_MS`). */
async function lateSince(tx: Transaction, lastClosed: PayPeriod): Promise<Date> {
  const [closing] = await tx
    .select({ closedAt: payPeriodClosings.closedAt })
    .from(payPeriodClosings)
    .where(eq(payPeriodClosings.period, lastClosed));
  if (closing === undefined) throw new Error(`Period ${lastClosed} has no closing`);
  return new Date(closing.closedAt.getTime() - LATE_SLACK_MS);
}

/**
 * The sales `period` counts from (`sales.ts`), in the caller's transaction:
 * - closed, the registry its closing wrote, the register left unread;
 * - open, the lines whose sale is around the period (a day on each side, `takes` keeps its own), every earlier one
 *   too before the team's first closing (a closing waits for them, ADR 0032); for the team's first open period, the
 *   late lines as well, recorded or linked again since the last closing. With the registry of every sale read, the
 *   accounts' rules, the shifts around the sales and the margin. The team's first open period also reads again, by
 *   sale, the lines a closing left held and the sales the validator decided (`pendingSales`), with the decision in
 *   force on every sale.
 * Only the accounts the platform's net pays are read: while none is, nothing is (`NO_SALES`).
 */
export async function readPeriodSales(
  tx: Transaction,
  reads: PaySalesReads,
  period: PayPeriod,
  place: { readonly closed: boolean; readonly lastClosed: PayPeriod | null },
  scope: PayReadScope,
  timeZone: string,
): Promise<PeriodSales> {
  if (place.closed) {
    return {
      sales: { ...NO_SALES, registered: await registeredIn(tx, period) },
      creatorOfAccount: new Map(),
    };
  }
  const firstOpen = place.lastClosed === null ? null : nextPayPeriod(place.lastClosed);
  const late =
    firstOpen === period && place.lastClosed !== null ? await lateSince(tx, place.lastClosed) : null;
  const periodStart = Date.parse(`${period}T00:00:00.000Z`);
  const own = {
    from: place.lastClosed === null ? EVER : new Date(periodStart - DAY_MS),
    to: new Date(Date.parse(`${nextPayPeriod(period)}T00:00:00.000Z`) + DAY_MS),
  };

  const lines = new Map<string, SaleForPay>();
  const sources: AccountSourceForPay[] = [];
  const shifts: ShiftForPay[] = [];
  const creatorOfAccount = new Map<PlatformAccountId, string>();
  const passes: readonly (string | null)[] = scope.kind === 'admin' ? [null] : scope.creatorIds;
  for (const creatorId of passes) {
    if (creatorId !== null && scope.kind === 'member') await enterCreator(tx, creatorId, scope.creatorIds);
    const mine = await reads.accountSources(tx);
    sources.push(...mine);
    const accounts = netAccounts(mine, period);
    if (accounts.length === 0) continue;
    if (creatorId !== null) for (const account of accounts) creatorOfAccount.set(account, creatorId);
    const range = (from: Date, to: Date): SaleLinesRange => ({
      platformAccountIds: accounts,
      from,
      to,
      timeZone,
    });
    const read = [...(await reads.linesOfSalesBetween(tx, range(own.from, own.to)))];
    if (late !== null) {
      read.push(
        ...(await reads.linesRecordedBetween(tx, range(late, NEVER))),
        ...(await reads.linesRelinkedBetween(tx, range(late, NEVER))),
      );
      const pending = await pendingSales(tx, accounts);
      if (pending.length > 0) {
        read.push(
          ...(await reads.linesOfSales(tx, { platformAccountIds: accounts, sales: pending, timeZone })),
        );
      }
    }
    const instants: number[] = [];
    for (const one of read) {
      const line = saleForPayOf(one, timeZone);
      lines.set(saleKeyOf(line), line);
      if (line.saleOccurredAt !== null) instants.push(line.saleOccurredAt.getTime());
    }
    if (instants.length > 0) {
      const from = new Date(Math.min(...instants) - SHIFT_SLACK_MS);
      const to = new Date(Math.max(...instants) + SHIFT_SLACK_MS);
      shifts.push(...(await reads.shifts(tx, accounts, from, to)));
    }
  }
  if (
    lines.size === 0 &&
    sources.every((one) => earningsBaseOf(one.platform, one.earningsSource) !== 'platform_net')
  ) {
    return { sales: NO_SALES, creatorOfAccount };
  }
  const ordered = [...lines.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, line]) => line);
  return {
    sales: {
      lines: ordered,
      registered: await registeredAmong(tx, ordered),
      decisions: await decisionsAmong(tx, ordered),
      sources,
      shifts,
      accessMarginMinutes: await reads.accessMarginMinutes(tx),
    },
    creatorOfAccount,
  };
}

/**
 * The keys of the lines a member would be paid for in `periods` and no closing registered, read on the admin
 * connection: in each period on its own sales, late lines in the team's first open period, and before the team's first
 * closing the earlier periods' too (`salesWaitingBefore`); with the lines each period's closing would leave held
 * (`salesLeftHeld`). A closing compares them with what the validating member read, so that a line he may not read stops
 * it instead of being left behind (as `pay_period_reports_unread_conflict`).
 */
export async function waitingSaleKeysUnscoped(
  tx: Transaction,
  reads: PaySalesReads,
  periods: readonly PayPeriod[],
  lastClosed: PayPeriod | null,
  timeZone: string,
): Promise<Set<string>> {
  const firstOpen = lastClosed === null ? null : nextPayPeriod(lastClosed);
  const keys = new Set<string>();
  for (const period of periods) {
    const { sales } = await readPeriodSales(
      tx,
      reads,
      period,
      { closed: false, lastClosed },
      { kind: 'admin' },
      timeZone,
    );
    for (const one of salesCounted(sales, { period, closed: false, firstOpen })) keys.add(saleKeyOf(one));
    if (lastClosed === null) for (const one of salesWaitingBefore(sales, period)) keys.add(saleKeyOf(one));
    // What its closing would leave held: kept by the closing, so it must be read by the validator too.
    for (const one of salesLeftHeld(sales, period)) keys.add(saleKeyOf(one.line));
  }
  return keys;
}

/**
 * Before the team's first closing, the earliest period of a line a member would be paid for and no closing registered,
 * read on the admin connection: the hourly job computes from there, as from the earliest waiting report.
 */
export async function earliestWaitingSalePeriodUnscoped(
  tx: Transaction,
  reads: PaySalesReads,
  period: PayPeriod,
  timeZone: string,
): Promise<PayPeriod | null> {
  const { sales } = await readPeriodSales(
    tx,
    reads,
    period,
    { closed: false, lastClosed: null },
    { kind: 'admin' },
    timeZone,
  );
  const periods = salesWaitingBefore(sales, period)
    .map((one) => one.salePeriod)
    .sort();
  return periods[0] ?? null;
}
