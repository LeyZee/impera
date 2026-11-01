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
  type InvoiceAcceptanceView,
  type InvoiceEventKind,
  type UserId,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@nirvana/db';

import {
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

import { enqueueInvoiceContestAnnounce, enqueueInvoiceLapse } from './invoice-queue';

const { auditLog, domainEvents, invoiceEvents, invoices, teamMembers } = schema;

/** What the acceptance writes in the audit log, entity `invoice`. */
type AcceptanceAction =
  'invoice.accept' | 'invoice.contest' | 'invoice.contest_refuse' | 'invoice.lapse' | 'invoice.contest_alert';

const ACTION_OF: Partial<Record<InvoiceEventKind, AcceptanceAction>> = {
  accepted: 'invoice.accept',
  contested: 'invoice.contest',
  contest_refused: 'invoice.contest_refuse',
  lapsed: 'invoice.lapse',
};

/** The document as the writer reads it (its policy applies under `withMember`), with the database's clock on its delay. */
interface Document {
  readonly id: string;
  readonly kind: string;
  readonly memberId: string;
  readonly number: string;
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
      details: { number: document.number, ...(decision.reason === null ? {} : { reason: decision.reason }) },
      ip: by?.ip ?? null,
    });
  }
  if (decision.event === 'contested')
    await enqueueInvoiceContestAnnounce(tx, InvoiceIdSchema.parse(document.id));
  return 'written';
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
                and ${invoiceEvents.kind} in ('credited', 'contest_refused'))`,
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
