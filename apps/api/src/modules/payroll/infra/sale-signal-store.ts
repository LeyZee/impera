import {
  CurrencySchema,
  MySalesSchema,
  PayPeriodSchema,
  PaySaleSignalSchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleDecisionOutcomeSchema,
  SaleEventSchema,
  SaleSignalKindSchema,
  type MySales,
  type PayPeriod,
  type PaySaleSignal,
  type SaleSignalKind,
  type TeamMemberId,
} from '@nirvana/contracts';
import {
  and,
  eq,
  lockPayrollClose,
  schema,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
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
} = schema;

/** A line as a statement stores it (`StatementSale`): its instant only on a statement written since CRM-03 lot b4c. */
const StoredSaleSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  event: SaleEventSchema,
  netMinor: z.number().int(),
  lateFrom: PayPeriodSchema.nullish(),
  occurredAt: z.iso.datetime().nullish(),
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
  open: line.open,
});

/**
 * A member's own lines on the platform's net and their signals (CRM-03 lot b4c, ADR 0050 §§ 5, 10), as the member
 * (`withMember`). The reads take the member's own statement, signals, registry rows and decisions on their sales: the
 * policies give nothing else, and the register (`platform_sales`) is never read here, its policy being by creator. A
 * signal changes no amount and computes nothing again; the trigger keeps it on the member's own statement as it stands.
 */
export function createDrizzleSaleSignalStore(db: Database, reads: PayInputReads): PayrollSaleSignalStore {
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
        const lines = myLines({
          statement,
          signals,
          excluded: await excludedAmong(tx, left),
          registered: await ownRegistered(tx, member, query.period),
          closed,
        });
        const page = pageOfLines(lines, after, query.limit);
        return MySalesSchema.parse({
          period: query.period,
          closed,
          days: myDays(lines, await reads.agencyTimeZone(tx)),
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
