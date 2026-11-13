import {
  calendarDayAt,
  CurrencySchema,
  MySalesSchema,
  nextPayPeriod,
  payPeriodOfDay,
  PayPeriodSchema,
  PaySaleSignalSchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleDecisionOutcomeSchema,
  SaleEventSchema,
  SaleSignalKindSchema,
  TeamMemberIdSchema,
  type MySales,
  type PayPeriod,
  type PaySaleSignal,
  type SaleSignalKind,
  type TeamMemberId,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  lockPayrollClose,
  or,
  schema,
  sql,
  withAdmin,
  withMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import {
  PayEntryConflict,
  PayPeriodClosed,
  PayPeriodCursorInvalid,
  PaySaleSignalNotFound,
  PaySaleSignalStateConflict,
} from '../domain/errors';
import {
  myDays,
  myLines,
  pageOfLines,
  type MyLine,
  type MyLinesAfter,
  type OwnGift,
  type OwnSignal,
  type OwnStatementSale,
} from '../domain/my-sales';
import type { PayrollSaleSignalStore } from '../domain/ports';
import { saleIdOf, saleKeyOf, type SaleKey } from '../domain/sales';

import { ownMemberOf } from './sale-decision-store';
import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const {
  commissionStatementLines,
  commissionStatements,
  payPeriodClosings,
  payPeriodSales,
  paySaleDecisions,
  paySaleSignals,
  teamMembers,
} = schema;

/** A line as a statement stores it (`StatementSale`): its instant only on a statement written since CRM-03 lot b4c. */
const StoredSaleSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  event: SaleEventSchema,
  netMinor: z.number().int(),
  lateFrom: PayPeriodSchema.nullish(),
  occurredAt: z.iso.datetime().nullish(),
  shareBp: z.number().int().nullish(),
});

const SignalRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  event: SaleEventSchema,
  revision: z.number().int().min(1),
  kind: SaleSignalKindSchema,
  note: z.string().nullable(),
  createdAt: z.date(),
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  netMinor: z.number().int(),
  occurredAt: z.date().nullable(),
});

const signalOfRow = (row: typeof paySaleSignals.$inferSelect): PaySaleSignal =>
  PaySaleSignalSchema.parse({
    id: row.id,
    period: row.period,
    platform: row.platform,
    platformSaleId: row.platformSaleId,
    event: row.event,
    memberId: row.memberId,
    revision: row.revision,
    kind: row.kind,
    platformAccountId: row.platformAccountId,
    currency: row.currency,
    netMinor: row.netMinor,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  });

/** The cursor of a page of one's sales: where the last line given stands (`compareMine`), opaque to the reader. */
const CursorSchema = z.object({ occurredAt: z.number().int().nullable(), key: z.string().min(1) });

const encodeCursor = (after: MyLinesAfter): string =>
  Buffer.from(JSON.stringify(after)).toString('base64url');

function decodeCursor(cursor: string | undefined): MyLinesAfter | null {
  if (cursor === undefined) return null;
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: refused below like any cursor this route did not give.
  }
  throw new PayPeriodCursorInvalid();
}

/** Whether a closing closed `period`. */
async function isClosed(tx: Transaction, period: PayPeriod): Promise<boolean> {
  const [closing] = await tx
    .select({ period: payPeriodClosings.period })
    .from(payPeriodClosings)
    .where(eq(payPeriodClosings.period, period));
  return closing !== undefined;
}

/**
 * The lines of the platform's net on the member's own statement of `period`, at its revision, as it stores them: the
 * account and currency of their statement line, the net, the period it comes late from and its instant.
 */
async function ownStatementSales(
  tx: Transaction,
  memberId: TeamMemberId,
  period: PayPeriod,
): Promise<OwnStatementSale[]> {
  const rows = await tx
    .select({
      platformAccountId: commissionStatementLines.platformAccountId,
      currency: commissionStatementLines.currency,
      sales: commissionStatementLines.sales,
    })
    .from(commissionStatements)
    .innerJoin(
      commissionStatementLines,
      and(
        eq(commissionStatementLines.statementId, commissionStatements.id),
        eq(commissionStatementLines.revision, commissionStatements.revision),
      ),
    )
    .where(
      and(
        eq(commissionStatements.memberId, memberId),
        eq(commissionStatements.period, period),
        eq(commissionStatementLines.base, 'platform_net'),
      ),
    );
  return rows.flatMap((row) => {
    const platformAccountId = PlatformAccountIdSchema.parse(row.platformAccountId);
    const currency = CurrencySchema.parse(row.currency);
    return z
      .array(StoredSaleSchema)
      .parse(row.sales)
      .map((one) => ({
        platform: one.platform,
        platformSaleId: one.platformSaleId,
        event: one.event,
        platformAccountId,
        currency,
        netMinor: one.netMinor,
        lateFrom: one.lateFrom ?? null,
        occurredAt: one.occurredAt == null ? null : new Date(one.occurredAt),
        shareBp: one.shareBp ?? null,
      }));
  });
}

/** The member's latest signal on each line of `period`, withdrawn or not, with what it kept of the line. */
async function ownSignals(tx: Transaction, memberId: TeamMemberId, period: PayPeriod): Promise<OwnSignal[]> {
  const rows = await tx
    .selectDistinctOn([paySaleSignals.platform, paySaleSignals.platformSaleId, paySaleSignals.event], {
      platform: paySaleSignals.platform,
      platformSaleId: paySaleSignals.platformSaleId,
      event: paySaleSignals.event,
      revision: paySaleSignals.revision,
      kind: paySaleSignals.kind,
      note: paySaleSignals.note,
      createdAt: paySaleSignals.createdAt,
      platformAccountId: paySaleSignals.platformAccountId,
      currency: paySaleSignals.currency,
      netMinor: paySaleSignals.netMinor,
      occurredAt: paySaleSignals.occurredAt,
    })
    .from(paySaleSignals)
    .where(and(eq(paySaleSignals.memberId, memberId), eq(paySaleSignals.period, period)))
    .orderBy(
      paySaleSignals.platform,
      paySaleSignals.platformSaleId,
      paySaleSignals.event,
      sql`${paySaleSignals.revision} desc`,
    );
  return rows.map((row) => {
    const one = SignalRowSchema.parse(row);
    return {
      platform: one.platform,
      platformSaleId: one.platformSaleId,
      event: one.event,
      kind: one.kind,
      note: one.note,
      createdAt: one.createdAt,
      platformAccountId: one.platformAccountId,
      currency: one.currency,
      netMinor: one.netMinor,
      occurredAt: one.occurredAt,
    };
  });
}

/** The latest revision and kind of the member's signals on one line of `period` (`null`: none yet). */
async function latestSignal(
  tx: Transaction,
  memberId: TeamMemberId,
  period: PayPeriod,
  line: SaleKey,
): Promise<{ readonly revision: number; readonly kind: SaleSignalKind } | null> {
  const [row] = await tx
    .select({ revision: paySaleSignals.revision, kind: paySaleSignals.kind })
    .from(paySaleSignals)
    .where(
      and(
        eq(paySaleSignals.memberId, memberId),
        eq(paySaleSignals.period, period),
        eq(paySaleSignals.platform, line.platform),
        eq(paySaleSignals.platformSaleId, line.platformSaleId),
        eq(paySaleSignals.event, line.event),
      ),
    )
    .orderBy(sql`${paySaleSignals.revision} desc`)
    .limit(1);
  return row === undefined ? null : { revision: row.revision, kind: SaleSignalKindSchema.parse(row.kind) };
}

/** The member's own lines a closing counted in `period` (the registry's rows they read), by `saleKeyOf`. */
async function ownRegistered(
  tx: Transaction,
  memberId: TeamMemberId,
  period: PayPeriod,
): Promise<Set<string>> {
  const rows = await tx
    .select({
      platform: payPeriodSales.platform,
      platformSaleId: payPeriodSales.platformSaleId,
      event: payPeriodSales.event,
    })
    .from(payPeriodSales)
    .where(and(eq(payPeriodSales.memberId, memberId), eq(payPeriodSales.period, period)));
  return new Set(
    rows.map((row) =>
      saleKeyOf({
        platform: PlatformSchema.parse(row.platform),
        platformSaleId: row.platformSaleId,
        event: SaleEventSchema.parse(row.event),
      }),
    ),
  );
}

const DecisionRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  outcome: SaleDecisionOutcomeSchema,
});

/**
 * Among `sales`, those whose latest decision the member reads excludes them, by `saleIdOf`: the policies give them the
 * decisions made on their own sales only, which is all that matters here.
 */
async function excludedAmong(tx: Transaction, sales: readonly SaleKey[]): Promise<Set<string>> {
  if (sales.length === 0) return new Set();
  const named = [...new Map(sales.map((one) => [saleIdOf(one), one])).values()].map(
    (one) => sql`(${one.platform}, ${one.platformSaleId})`,
  );
  const rows = await tx
    .selectDistinctOn([paySaleDecisions.platform, paySaleDecisions.platformSaleId], {
      platform: paySaleDecisions.platform,
      platformSaleId: paySaleDecisions.platformSaleId,
      outcome: paySaleDecisions.outcome,
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
  return new Set(
    rows
      .map((row) => DecisionRowSchema.parse(row))
      .filter((one) => one.outcome === 'exclude')
      .map((one) => saleIdOf(one)),
  );
}

const GiftRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  outcome: SaleDecisionOutcomeSchema,
  authorMemberId: TeamMemberIdSchema.nullable(),
  recipientMemberId: TeamMemberIdSchema.nullable(),
  shareBp: z.number().int().nullable(),
  note: z.string().nullable(),
  platformAccountId: PlatformAccountIdSchema,
  saleCurrency: CurrencySchema.nullable(),
  saleNetMinor: z.number().int().nullable(),
  saleOccurredAt: z.date().nullable(),
});

/**
 * The display names of `memberIds`, on the admin connection: a member's policies show them their own row alone. Read
 * only for the other side of a gift the member's policies already gave them (ADR 0101 § 6): a name, nothing else.
 */
async function namesUnscoped(
  adminDb: Database,
  memberIds: readonly TeamMemberId[],
): Promise<Map<TeamMemberId, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await withAdmin(adminDb, (tx) =>
    tx
      .select({ id: teamMembers.id, displayName: teamMembers.displayName })
      .from(teamMembers)
      .where(inArray(teamMembers.id, [...memberIds])),
  );
  return new Map(rows.map((row) => [TeamMemberIdSchema.parse(row.id), row.displayName]));
}

/**
 * The latest decision the member reads on each sale they made or received that gives it (ADR 0101), by `saleIdOf`:
 * on the sales of `named`, and on their own sales given whole whose instant is in `period` (the agency's zone). The
 * policies give a member the decisions on their own sales and those given to them; a withdrawal or another decision
 * written since ends a gift.
 */
async function ownGifts(
  tx: Transaction,
  adminDb: Database,
  member: TeamMemberId,
  period: PayPeriod,
  named: readonly SaleKey[],
  timeZone: string,
): Promise<Map<string, OwnGift>> {
  const day = 24 * 60 * 60 * 1000;
  const from = new Date(Date.parse(`${period}T00:00:00.000Z`) - day);
  const to = new Date(Date.parse(`${nextPayPeriod(period)}T00:00:00.000Z`) + day);
  const sales = [...new Map(named.map((one) => [saleIdOf(one), one])).values()];
  const ofNamed =
    sales.length === 0
      ? sql`false`
      : sql`(${paySaleDecisions.platform}, ${paySaleDecisions.platformSaleId}) in (${sql.join(
          sales.map((one) => sql`(${one.platform}, ${one.platformSaleId})`),
          sql`, `,
        )})`;
  // Every decision on the sales concerned, so that the latest of each is known, whatever it is.
  const concerned = tx
    .selectDistinct({ platform: paySaleDecisions.platform, platformSaleId: paySaleDecisions.platformSaleId })
    .from(paySaleDecisions)
    .where(
      or(
        ofNamed,
        and(
          eq(paySaleDecisions.outcome, 'give'),
          eq(paySaleDecisions.authorMemberId, member),
          sql`${paySaleDecisions.saleOccurredAt} >= ${from} and ${paySaleDecisions.saleOccurredAt} < ${to}`,
        ),
      ),
    );
  const rows = await tx
    .selectDistinctOn([paySaleDecisions.platform, paySaleDecisions.platformSaleId], {
      platform: paySaleDecisions.platform,
      platformSaleId: paySaleDecisions.platformSaleId,
      outcome: paySaleDecisions.outcome,
      authorMemberId: paySaleDecisions.authorMemberId,
      recipientMemberId: paySaleDecisions.recipientMemberId,
      shareBp: paySaleDecisions.shareBp,
      note: paySaleDecisions.note,
      platformAccountId: paySaleDecisions.platformAccountId,
      saleCurrency: paySaleDecisions.saleCurrency,
      saleNetMinor: paySaleDecisions.saleNetMinor,
      saleOccurredAt: paySaleDecisions.saleOccurredAt,
    })
    .from(paySaleDecisions)
    .where(
      sql`(${paySaleDecisions.platform}, ${paySaleDecisions.platformSaleId}) in (select * from (${concerned}) c)`,
    )
    .orderBy(
      paySaleDecisions.platform,
      paySaleDecisions.platformSaleId,
      sql`${paySaleDecisions.revision} desc`,
    );
  const gives = rows
    .map((row) => GiftRowSchema.parse(row))
    .flatMap((one) =>
      one.outcome === 'give' &&
      one.recipientMemberId !== null &&
      one.shareBp !== null &&
      one.note !== null &&
      one.saleCurrency !== null &&
      one.saleNetMinor !== null &&
      one.saleOccurredAt !== null
        ? [
            {
              ...one,
              recipientMemberId: one.recipientMemberId,
              shareBp: one.shareBp,
              note: one.note,
              saleCurrency: one.saleCurrency,
              saleNetMinor: one.saleNetMinor,
              saleOccurredAt: one.saleOccurredAt,
            },
          ]
        : [],
    );
  const others = gives.flatMap((one) => {
    if (one.recipientMemberId !== member) return [one.recipientMemberId];
    return one.authorMemberId === null ? [] : [one.authorMemberId];
  });
  const names = await namesUnscoped(adminDb, [...new Set(others)]);
  const gifts = new Map<string, OwnGift>();
  const namedIds = new Set(sales.map((one) => saleIdOf(one)));
  for (const one of gives) {
    const role = one.recipientMemberId === member ? 'recipient' : 'author';
    // Outside the sales named, only the member's own sales of the period given whole away are shown.
    const inPeriod = payPeriodOfDay(calendarDayAt(one.saleOccurredAt, timeZone)) === period;
    if (!namedIds.has(saleIdOf(one)) && !(role === 'author' && inPeriod)) continue;
    const otherId = role === 'author' ? one.recipientMemberId : one.authorMemberId;
    const name = otherId === null ? undefined : names.get(otherId);
    gifts.set(saleIdOf(one), {
      platform: one.platform,
      platformSaleId: one.platformSaleId,
      role,
      recipientShareBp: one.shareBp,
      other: otherId === null ? { kind: 'agent' } : { kind: 'member', displayName: name ?? 'Membre' },
      note: one.note,
      platformAccountId: one.platformAccountId,
      currency: one.saleCurrency,
      netMinor: one.saleNetMinor,
      occurredAt: one.saleOccurredAt,
    });
  }
  return gifts;
}

const toMySale = (line: MyLine): MySales['items'][number] => ({
  platform: line.platform,
  platformSaleId: line.platformSaleId,
  event: line.event,
  platformAccountId: line.platformAccountId,
  currency: line.currency,
  netMinor: line.netMinor,
  occurredAt: line.occurredAt?.toISOString() ?? null,
  lateFrom: line.lateFrom,
  state: line.state,
  signal:
    line.signal === null
      ? null
      : { note: line.signal.note, signalledAt: line.signal.signalledAt.toISOString() },
  given: line.given,
  open: line.open,
});

/**
 * A member's own lines on the platform's net and their signals (CRM-03 lot b4c, ADR 0050 §§ 5, 10), as the member
 * (`withMember`). The reads take the member's own statement, signals, registry rows and decisions on their sales: the
 * policies give nothing else, and the register (`platform_sales`) is never read here, its policy being by creator. A
 * signal changes no amount and computes nothing again; the trigger keeps it on the member's own statement as it stands.
 */
export function createDrizzleSaleSignalStore(
  db: Database,
  adminDb: Database,
  reads: PayInputReads,
): PayrollSaleSignalStore {
  return {
    mySales: (userId, query) =>
      withMember(db, userId, async (tx) => {
        const after = decodeCursor(query.cursor);
        const member = await ownMemberOf(tx, userId);
        const closed = await isClosed(tx, query.period);
        if (member === null) {
          return MySalesSchema.parse({ period: query.period, closed, days: [], items: [], nextCursor: null });
        }
        const statement = await ownStatementSales(tx, member, query.period);
        const signals = await ownSignals(tx, member, query.period);
        const onStatement = new Set(statement.map((one) => saleKeyOf(one)));
        const left = signals.filter((one) => one.kind === 'signal' && !onStatement.has(saleKeyOf(one)));
        const timeZone = await reads.agencyTimeZone(tx);
        const lines = myLines({
          statement,
          signals,
          excluded: await excludedAmong(tx, left),
          registered: await ownRegistered(tx, member, query.period),
          gifts: await ownGifts(tx, adminDb, member, query.period, [...statement, ...left], timeZone),
          closed,
        });
        const page = pageOfLines(lines, after, query.limit);
        return MySalesSchema.parse({
          period: query.period,
          closed,
          days: myDays(lines, timeZone),
          items: page.items.map(toMySale),
          nextCursor: page.next === null ? null : encodeCursor(page.next),
        });
      }),

    signal: (actor, body) =>
      withMember(db, actor.userId, async (tx) => {
        // A closing and a signal never cross, nor a recalculation: the statement read here is the one the trigger sees.
        await lockPayrollClose(tx);
        const [sent] = await tx.select().from(paySaleSignals).where(eq(paySaleSignals.id, body.id));
        if (sent !== undefined) {
          const same =
            sent.period === body.period &&
            sent.platform === body.platform &&
            sent.platformSaleId === body.platformSaleId &&
            sent.event === body.event &&
            sent.kind === body.kind &&
            sent.note === body.note;
          if (!same) throw new PayEntryConflict('pay_sale_signal_conflict');
          return { value: signalOfRow(sent), created: false };
        }

        const member = await ownMemberOf(tx, actor.userId);
        if (member === null) throw new PaySaleSignalNotFound();
        if (await isClosed(tx, body.period)) throw new PayPeriodClosed(body.period);
        const line = (await ownStatementSales(tx, member, body.period)).find(
          (one) => saleKeyOf(one) === saleKeyOf(body),
        );
        if (line === undefined) throw new PaySaleSignalNotFound();
        if ((await ownRegistered(tx, member, body.period)).has(saleKeyOf(body))) {
          throw new PayPeriodClosed(body.period);
        }
        const latest = await latestSignal(tx, member, body.period, body);
        if (body.kind === 'signal' ? latest?.kind === 'signal' : latest?.kind !== 'signal') {
          throw new PaySaleSignalStateConflict(body.kind);
        }
        const [row] = await tx
          .insert(paySaleSignals)
          .values({
            id: body.id,
            platform: body.platform,
            platformSaleId: body.platformSaleId,
            event: body.event,
            memberId: member,
            period: body.period,
            revision: (latest?.revision ?? 0) + 1,
            kind: body.kind,
            platformAccountId: line.platformAccountId,
            currency: line.currency,
            netMinor: line.netMinor,
            occurredAt: line.occurredAt,
            note: body.note,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('A signal was not written');
        await audit(
          tx,
          actor,
          'pay_sale_signal.create',
          { kind: 'pay_sale_signal', id: row.id },
          { period: body.period, kind: body.kind, revision: row.revision },
        );
        return { value: signalOfRow(row), created: true };
      }),
  };
}
