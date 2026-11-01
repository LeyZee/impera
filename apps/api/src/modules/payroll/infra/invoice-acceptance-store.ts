import {
  AuditEntryIdSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  InvoiceEventIdSchema,
  InvoiceEventKindSchema,
  InvoiceAcceptanceViewSchema,
  InvoiceIdSchema,
  InvoiceKindSchema,
  newId,
  PayAdjustmentIdSchema,
  payPeriodAt,
  TeamMemberIdSchema,
  type InvoiceAcceptanceView,
  type InvoiceEventKind,
  type UserId,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import {
  correctionAdjustments,
  correctionReplayed,
  type ContestedDocument,
} from '../domain/contest-correction';
import {
  InvoiceAcceptanceConflict,
  InvoiceAnswerForbidden,
  InvoiceNotFound,
  PayrollForbidden,
  PayrollOwnForbidden,
} from '../domain/errors';
import {
  acceptanceWrite,
  standingOf,
  type AcceptanceStep,
  type RecordedStep,
} from '../domain/invoice-acceptance';
import type { Actor, PayrollInvoiceAcceptanceStore } from '../domain/ports';

import { enqueueChanged, lockAdjustmentPeriod } from './entry-store';
import { enqueueInvoiceContestAnnounce, enqueueInvoiceLapse } from './invoice-queue';
import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const { auditLog, domainEvents, invoiceEvents, invoices, payAdjustments, teamMembers } = schema;

/** What the acceptance writes in the audit log, entity `invoice`. */
type AcceptanceAction =
  | 'invoice.accept'
  | 'invoice.contest'
  | 'invoice.contest_uphold'
  | 'invoice.contest_refuse'
  | 'invoice.lapse'
  | 'invoice.contest_alert';

const ACTION_OF: Partial<Record<InvoiceEventKind, AcceptanceAction>> = {
  accepted: 'invoice.accept',
  contested: 'invoice.contest',
  contest_upheld: 'invoice.contest_uphold',
  contest_refused: 'invoice.contest_refuse',
  lapsed: 'invoice.lapse',
};

/** What credit notes took off an invoice, a sum of integers that Postgres gives as text. */
const CreditedSchema = z.coerce.number().int().nonnegative();

/** The document as the writer reads it (its policy applies under `withMember`), with the database's clock on its delay. */
interface Document {
  readonly id: string;
  readonly kind: string;
  readonly memberId: string;
  readonly number: string;
  /** The invoice a credit note cites, `null` on an invoice. */
  readonly creditedInvoiceId: string | null;
  readonly deadline: Date;
  /** `now() < acceptance_deadline`, on the clock the trigger of `invoice_events` checks. */
  readonly open: boolean;
}

async function documentOf(tx: Transaction, invoiceId: string): Promise<Document | null> {
  const [row] = await tx
    .select({
      id: invoices.id,
      kind: invoices.kind,
      memberId: invoices.memberId,
      number: invoices.number,
      creditedInvoiceId: invoices.creditedInvoiceId,
      deadline: invoices.acceptanceDeadline,
      open: sql<boolean>`now() < ${invoices.acceptanceDeadline}`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return row ?? null;
}

/** One write at a time on a document's acceptance: an answer, a refusal, the lapse, the alert. */
async function lockDocument(tx: Transaction, invoiceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`invoices.acceptance:${invoiceId}`}, 0))`,
  );
}

async function stepsOf(tx: Transaction, invoiceId: string) {
  return tx
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, invoiceId))
    .orderBy(invoiceEvents.createdAt, invoiceEvents.id);
}

const recorded = (rows: Awaited<ReturnType<typeof stepsOf>>): RecordedStep[] =>
  rows.map((row) => ({ kind: InvoiceEventKindSchema.parse(row.kind), reason: row.reason }));

async function viewOf(tx: Transaction, document: Document): Promise<InvoiceAcceptanceView> {
  const rows = await stepsOf(tx, document.id);
  const standing = standingOf(recorded(rows));
  return InvoiceAcceptanceViewSchema.parse({
    invoiceId: document.id,
    kind: InvoiceKindSchema.parse(document.kind),
    memberId: document.memberId,
    number: document.number,
    acceptance: { state: standing.state, deadline: document.deadline.toISOString(), reason: standing.reason },
    events: rows.map((row) => ({
      id: row.id,
      invoiceId: row.invoiceId,
      kind: row.kind,
      reason: row.reason,
      statementId: row.statementId,
      by: row.by,
      at: row.createdAt.toISOString(),
    })),
  });
}

/**
 * Writes `step` on the document unless the very same step is recorded already, under the document's lock: the event,
 * its line of `audit_log`, and what follows it (the owner's alert for a contest). The trigger of `invoice_events` checks
 * the order and the delay again on the same clock.
 */
async function writeStep(
  tx: Transaction,
  document: Document,
  step: AcceptanceStep,
  by: Actor | null,
  details: Readonly<Record<string, unknown>> = {},
): Promise<'written' | 'replay'> {
  const decision = acceptanceWrite(recorded(await stepsOf(tx, document.id)), step, document.open);
  if (decision.kind === 'replay') return 'replay';
  await tx.insert(invoiceEvents).values({
    id: newId(InvoiceEventIdSchema),
    invoiceId: document.id,
    kind: decision.event,
    reason: decision.reason,
    by: by?.userId ?? null,
  });
  const action = ACTION_OF[decision.event];
  if (action !== undefined) {
    await tx.insert(auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: by?.userId ?? null,
      action,
      entity: 'invoice',
      entityId: document.id,
      details: {
        number: document.number,
        ...(decision.reason === null ? {} : { reason: decision.reason }),
        ...details,
      },
      ip: by?.ip ?? null,
    });
  }
  if (decision.event === 'contested')
    await enqueueInvoiceContestAnnounce(tx, InvoiceIdSchema.parse(document.id));
  return 'written';
}

/**
 * The contested document as its correction reads it (ADR 0039 § 3), and the statement each adjustment of it corrects:
 * the member's statement of the document's period, which a credit note on it keeps (`keep_contest_correction`). That
 * is an invoice's own statement, the cited invoice's for a credit note, and for a corrective invoice, issued by a later
 * statement, the statement of the period it bills again (ADR 0040). What the invoice has left is its total excluding
 * VAT less what its issued credit notes took off.
 */
async function contestedOf(
  tx: Transaction,
  document: Document,
): Promise<{ readonly document: ContestedDocument; readonly correctsStatementId: string }> {
  const kind = InvoiceKindSchema.parse(document.kind);
  const invoiceId = kind === 'invoice' ? document.id : document.creditedInvoiceId;
  if (invoiceId === null) throw new Error(`Credit note ${document.number} cites no invoice`);
  const [cited] = await tx
    .select({
      number: invoices.number,
      issuedOn: invoices.issuedOn,
      // Written by hand with the outer table named: Drizzle leaves a column of a one-table select unqualified, and
      // inside the subquery it would name the subquery's own row.
      statementId: sql<string | null>`(
        select s.id from commission_statements s
        where s.member_id = invoices.member_id and s.period = invoices.period
      )`,
      exclVatMinor: invoices.exclVatMinor,
      creditedMinor: sql<string>`coalesce((
        select -sum(n.excl_vat_minor) from invoices n
        where n.credited_invoice_id = invoices.id and n.kind = 'credit_note'
      ), 0)::text`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (cited === undefined || cited.statementId === null)
    throw new Error(`Invoice of ${document.number} has no statement`);
  return {
    document: {
      kind,
      invoice: {
        number: cited.number,
        issuedOn: cited.issuedOn,
        leftMinor: cited.exclVatMinor - CreditedSchema.parse(cited.creditedMinor),
      },
    },
    correctsStatementId: cited.statementId,
  };
}

/** The adjustments that corrected the document's contest, negative first, as `correctionReplayed` compares them. */
async function correctionOf(tx: Transaction, invoiceId: string) {
  return tx
    .select({ amountMinor: payAdjustments.amountMinor, reason: payAdjustments.reason })
    .from(payAdjustments)
    .where(eq(payAdjustments.contestedInvoiceId, invoiceId))
    .orderBy(payAdjustments.amountMinor, payAdjustments.id);
}

/** Is `userId` the contractor the document is in the name of? */
async function isContractor(tx: Transaction, document: Document, userId: UserId): Promise<boolean> {
  const [member] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.id, document.memberId), eq(teamMembers.userId, userId)));
  return member !== undefined;
}

/** A document's acceptance (EQ-06 lot 6, ADR 0039): see `PayrollInvoiceAcceptanceStore`. */
export function createDrizzlePayrollInvoiceAcceptanceStore(
  db: Database,
  adminDb: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollInvoiceAcceptanceStore {
  return {
    read: (userId, invoiceId) =>
      withMember(db, userId, async (tx) => {
        const document = await documentOf(tx, invoiceId);
        return document === null ? null : viewOf(tx, document);
      }),

    answer: (actor, invoiceId, answer) =>
      withMember(db, actor.userId, async (tx) => {
        const document = await documentOf(tx, invoiceId);
        if (document === null) throw new InvoiceNotFound();
        if (!(await isContractor(tx, document, actor.userId))) throw new InvoiceAnswerForbidden();
        await lockDocument(tx, document.id);
        await writeStep(tx, document, answer, actor);
        return viewOf(tx, document);
      }),

    refuseContest: (actor, invoiceId, reason) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const document = await documentOf(tx, invoiceId);
        if (document === null) throw new InvoiceNotFound();
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        // The owner never decides on a document in their own name (the policy `owner_step` refuses it too).
        if (await isContractor(tx, document, actor.userId)) throw new PayrollOwnForbidden();
        await lockDocument(tx, document.id);
        await writeStep(tx, document, { kind: 'refuse', reason }, actor);
        return viewOf(tx, document);
      }),

    upholdContest: (actor, invoiceId, reason, correction) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const document = await documentOf(tx, invoiceId);
        if (document === null) throw new InvoiceNotFound();
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        // The owner never decides on a document in their own name (the policy `owner_step` refuses it too).
        if (await isContractor(tx, document, actor.userId)) throw new PayrollOwnForbidden();
        await lockDocument(tx, document.id);
        const step = { kind: 'uphold', reason } as const;
        const contested = await contestedOf(tx, document);
        // Upheld already with this reason: the same correction gives the view back, another one is a conflict. Asked
        // before the correction is computed again, which the cancel issued since would no longer allow.
        if (
          acceptanceWrite(recorded(await stepsOf(tx, document.id)), step, document.open).kind === 'replay'
        ) {
          if (
            !correctionReplayed(contested.document, correction, reason, await correctionOf(tx, document.id))
          ) {
            throw new InvoiceAcceptanceConflict('contest_upheld');
          }
          return viewOf(tx, document);
        }
        const adjustments = correctionAdjustments(contested.document, correction, reason);
        const memberId = TeamMemberIdSchema.parse(document.memberId);
        const current = payPeriodAt(now(), await reads.agencyTimeZone(tx));
        const period = await lockAdjustmentPeriod(tx, reads, memberId, current);
        const rows = await tx
          .insert(payAdjustments)
          .values(
            adjustments.map((one) => ({
              id: newId(PayAdjustmentIdSchema),
              memberId,
              period,
              amountMinor: one.amountMinor,
              reason: one.reason,
              correctsStatementId: contested.correctsStatementId,
              contestedInvoiceId: document.id,
              createdBy: actor.userId,
            })),
          )
          .returning({ id: payAdjustments.id });
        for (const row of rows) {
          await audit(
            tx,
            actor,
            'pay_adjustment.create',
            { kind: 'pay_adjustment', id: row.id },
            { period, contestedInvoiceId: document.id },
          );
        }
        // Checked again at the commit, both ways: the uphold and the adjustments that name the document.
        await writeStep(tx, document, step, actor, {
          correction: correction.kind,
          adjustmentIds: rows.map((row) => row.id),
          period,
        });
        await enqueueChanged(tx, period, period, current);
        return viewOf(tx, document);
      }),

    lapseUnscoped: (invoiceId) =>
      withAdmin(adminDb, async (tx) => {
        await lockDocument(tx, invoiceId);
        const document = await documentOf(tx, invoiceId);
        if (document === null) return 'not_found';
        if (standingOf(recorded(await stepsOf(tx, invoiceId))).state !== 'pending') return 'answered';
        if (document.open) {
          // Run before the deadline by another clock: waits for it again, under the same key.
          await enqueueInvoiceLapse(tx, invoiceId, document.deadline);
          return 'early';
        }
        await writeStep(tx, document, { kind: 'lapse' }, null);
        return 'lapsed';
      }),

    announceContestUnscoped: (invoiceId) =>
      withAdmin(adminDb, async (tx) => {
        await lockDocument(tx, invoiceId);
        const document = await documentOf(tx, invoiceId);
        if (document === null) return 'not_found';
        const steps = recorded(await stepsOf(tx, invoiceId));
        if (!steps.some((step) => step.kind === 'contested')) return 'not_contested';
        const [said] = await tx
          .select({ id: domainEvents.id })
          .from(domainEvents)
          .where(
            and(
              eq(domainEvents.type, 'invoice_contested'),
              sql`${domainEvents.payload}->>'invoiceId' = ${invoiceId}`,
            ),
          )
          .limit(1);
        if (said !== undefined) return 'already';
        // Ended before its alert went out (refused, say, while the job waited): the owner, who ended it, knows.
        if (standingOf(steps).state !== 'contested') return 'closed';
        const payload = EVENT_PAYLOADS.invoice_contested.parse({
          invoiceId,
          memberId: document.memberId,
          number: document.number,
          document: document.kind,
        });
        await tx.insert(domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'invoice_contested',
          payload,
          actor: 'system',
          correlationId: `invoice_contest:${invoiceId}`,
        });
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'invoice.contest_alert',
          entity: 'invoice',
          entityId: invoiceId,
          details: payload,
          ip: null,
        });
        return 'published';
      }),

    dueUnscoped: (limit) =>
      withAdmin(adminDb, async (tx) => {
        const answered = sql`exists (select 1 from ${invoiceEvents} where ${invoiceEvents.invoiceId} = ${invoices.id}
          and ${invoiceEvents.kind} in ('accepted', 'contested', 'lapsed'))`;
        const unanswered = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(sql`${invoices.acceptanceDeadline} <= now()`, sql`not ${answered}`))
          .orderBy(invoices.acceptanceDeadline, invoices.id)
          .limit(limit);
        const unannounced = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              sql`exists (select 1 from ${invoiceEvents} where ${invoiceEvents.invoiceId} = ${invoices.id}
                and ${invoiceEvents.kind} = 'contested')`,
              sql`not exists (select 1 from ${invoiceEvents} where ${invoiceEvents.invoiceId} = ${invoices.id}
                and ${invoiceEvents.kind} in ('contest_upheld', 'contest_refused'))`,
              sql`not exists (select 1 from ${domainEvents} where ${domainEvents.type} = 'invoice_contested'
                and ${domainEvents.payload}->>'invoiceId' = ${invoices.id}::text)`,
            ),
          )
          .orderBy(invoices.issuedAt, invoices.id)
          .limit(limit);
        return {
          unanswered: unanswered.map((row) => InvoiceIdSchema.parse(row.id)),
          unannounced: unannounced.map((row) => InvoiceIdSchema.parse(row.id)),
        };
      }),
  };
}
