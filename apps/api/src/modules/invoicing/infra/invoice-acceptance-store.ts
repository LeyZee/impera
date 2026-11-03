import {
  AuditEntryIdSchema,
  calendarDayAt,
  CommissionStatementIdSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  InvoiceEventIdSchema,
  InvoiceEventKindSchema,
  InvoiceAcceptanceViewSchema,
  InvoiceIdSchema,
  InvoiceKindSchema,
  InvoiceListSchema,
  InvoiceSettlementKindSchema,
  newId,
  TeamMemberIdSchema,
  type InvoiceAcceptanceView,
  type InvoiceEventKind,
  type InvoiceList,
  type InvoiceListQuery,
  type InvoiceSettlement,
  type UserId,
} from '@nirvana/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withAdmin,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import { PayrollForbidden } from '../../contractors/pure';
import type { Actor } from '../../contractors/pure';
import {
  payReadsForInvoicing as payReads,
  PayrollOwnForbidden,
  type ContestCorrectionWrite,
} from '../../payroll';
import {
  correctionAdjustments,
  correctionReplayed,
  type ContestedDocument,
} from '../domain/contest-correction';
import { InvoiceAcceptanceConflict, InvoiceAnswerForbidden, InvoiceNotFound } from '../domain/errors';
import {
  acceptanceWrite,
  standingOf,
  type AcceptanceStep,
  type RecordedStep,
} from '../domain/invoice-acceptance';
import { invoiceDueState } from '../domain/invoices';
import type { PayrollInvoiceAcceptanceStore } from '../domain/ports';

import { enqueueInvoiceContestAnnounce, enqueueInvoiceLapse } from './invoice-queue';
import type { InvoicingReads } from './ports';

const { auditLog, domainEvents, invoiceEvents, invoicePdfs, invoices, teamMembers } = schema;

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

/** A condition of a query, as `sql` builds it. */
type SQL = ReturnType<typeof sql>;

/** A settlement step: its kind ends a document's debt (EQ-06 lot 7a). */
const SETTLEMENT_KINDS = sql.raw(`('paid', 'imputed', 'compensated')`);
/** A step after which a document's acceptance is final: neither `pending` nor `contested` any more. */
const FINAL_ANSWERS = sql.raw(`('accepted', 'lapsed', 'contest_upheld', 'contest_refused')`);

const hasStep = (kinds: SQL): SQL =>
  sql`exists (select 1 from ${invoiceEvents} e where e.invoice_id = ${invoices.id} and e.kind in ${kinds})`;

/**
 * What the base narrows before the list's rules run (`InvoiceListQuerySchema`): the member, the quinzaine, the days of
 * issue, and for a filter on documents still waiting, those without a settlement or without a final answer, so that
 * a list without dates stays bounded. The exact filters on `due` and `acceptance` are applied after, on the computed
 * states. `ofPeriod` holds the statements of the quinzaine asked, as pay gives them.
 */
function listConditions(query: InvoiceListQuery, ofPeriod: readonly string[]): SQL[] {
  const conditions: SQL[] = [];
  if (query.memberId !== undefined) conditions.push(eq(invoices.memberId, query.memberId));
  // A quinzaine's documents are those its statements issued: a credit note or a corrective invoice counts with the
  // statement that owed it, not with the period it corrects and prints; one without a statement, with that period.
  // A document's statement is always there (its foreign key) and readable wherever the document is (the same policy).
  if (query.period !== undefined) {
    const withoutStatement = and(sql`${invoices.statementId} is null`, eq(invoices.period, query.period));
    conditions.push(
      ofPeriod.length === 0
        ? sql`(${withoutStatement})`
        : sql`(${inArray(invoices.statementId, [...ofPeriod])} or (${withoutStatement}))`,
    );
  }
  if (query.from !== undefined && query.to !== undefined)
    conditions.push(sql`${invoices.issuedOn} between ${query.from} and ${query.to}`);
  if (query.due !== undefined && !query.due.includes('settled'))
    conditions.push(sql`not ${hasStep(SETTLEMENT_KINDS)}`);
  if (query.acceptance?.every((state) => state === 'pending' || state === 'contested') === true)
    conditions.push(sql`not ${hasStep(FINAL_ANSWERS)}`);
  return conditions;
}

/**
 * The documents of the list with their steps, the transfer day of the statements that settled them and whether their
 * PDF is rendered: four reads, whatever the number of documents.
 */
async function listOf(
  tx: Transaction,
  query: InvoiceListQuery,
  timeZone: string,
  today: string,
): Promise<InvoiceList> {
  const ofPeriod =
    query.period === undefined ? [] : await payReads.idsOfPeriod(tx, query.period, query.memberId);
  const rows = await tx
    .select({
      id: invoices.id,
      kind: invoices.kind,
      memberId: invoices.memberId,
      number: invoices.number,
      period: invoices.period,
      statementId: invoices.statementId,
      creditedInvoiceId: invoices.creditedInvoiceId,
      reissuedInvoiceId: invoices.reissuedInvoiceId,
      issuedOn: invoices.issuedOn,
      dueOn: invoices.dueOn,
      exclVatMinor: invoices.exclVatMinor,
      vatMinor: invoices.vatMinor,
      inclVatMinor: invoices.inclVatMinor,
      deadline: invoices.acceptanceDeadline,
    })
    .from(invoices)
    .where(and(...listConditions(query, ofPeriod)))
    .orderBy(sql`${invoices.issuedOn} desc`, sql`${invoices.number} desc`);
  const ids = rows.map((row) => row.id);
  // The quinzaine of the statement that issued each document, where the screens lead.
  const periods = await payReads.periodsOf(tx, [
    ...new Set(rows.flatMap((row) => (row.statementId === null ? [] : [row.statementId]))),
  ]);
  const steps =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(invoiceEvents)
          .where(inArray(invoiceEvents.invoiceId, ids))
          .orderBy(invoiceEvents.createdAt, invoiceEvents.id);
  const stepsOfDocument = new Map<string, typeof steps>();
  for (const step of steps)
    stepsOfDocument.set(step.invoiceId, [...(stepsOfDocument.get(step.invoiceId) ?? []), step]);
  const settling = steps.filter((step) => InvoiceSettlementKindSchema.safeParse(step.kind).success);
  const settlingIds = [
    ...new Set(settling.flatMap((step) => (step.statementId === null ? [] : [step.statementId]))),
  ];
  const transfers = await payReads.paidOnOf(tx, settlingIds);
  const rendered = new Set(
    (ids.length === 0
      ? []
      : await tx
          .select({ invoiceId: invoicePdfs.invoiceId })
          .from(invoicePdfs)
          .where(inArray(invoicePdfs.invoiceId, ids))
    ).map((row) => row.invoiceId),
  );

  const settlementOf = (documentSteps: typeof steps): InvoiceSettlement | null => {
    const step = documentSteps.find((one) => InvoiceSettlementKindSchema.safeParse(one.kind).success);
    if (step === undefined) return null;
    if (step.statementId === null) throw new Error('A settlement without its statement');
    const kind = InvoiceSettlementKindSchema.parse(step.kind);
    const paidOn = transfers.get(step.statementId) ?? null;
    return {
      kind,
      statementId: CommissionStatementIdSchema.parse(step.statementId),
      on: kind !== 'compensated' && paidOn !== null ? paidOn : calendarDayAt(step.createdAt, timeZone),
    };
  };

  const documents = rows.flatMap((row) => {
    const documentSteps = stepsOfDocument.get(row.id) ?? [];
    const standing = standingOf(recorded(documentSteps));
    const kind = InvoiceKindSchema.parse(row.kind);
    const settlement = settlementOf(documentSteps);
    const due = invoiceDueState({ kind, dueOn: row.dueOn, settled: settlement !== null }, today);
    if (query.due !== undefined && !query.due.includes(due)) return [];
    if (query.acceptance !== undefined && !query.acceptance.includes(standing.state)) return [];
    return [
      {
        id: row.id,
        kind,
        corrective: kind === 'invoice' && row.reissuedInvoiceId !== null,
        memberId: row.memberId,
        number: row.number,
        period: row.period,
        statementId: row.statementId,
        statementPeriod: row.statementId === null ? null : (periods.get(row.statementId) ?? null),
        creditedInvoiceId: row.creditedInvoiceId,
        issuedOn: row.issuedOn,
        dueOn: row.dueOn,
        exclVatMinor: row.exclVatMinor,
        vatMinor: row.vatMinor,
        inclVatMinor: row.inclVatMinor,
        acceptance: { state: standing.state, deadline: row.deadline.toISOString(), reason: standing.reason },
        settlement,
        due,
        pdfReady: rendered.has(row.id),
      },
    ];
  });
  return InvoiceListSchema.parse({ today, documents });
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
      memberId: invoices.memberId,
      period: invoices.period,
      exclVatMinor: invoices.exclVatMinor,
      creditedMinor: sql<string>`coalesce((
        select -sum(n.excl_vat_minor) from invoices n
        where n.credited_invoice_id = invoices.id and n.kind = 'credit_note'
      ), 0)::text`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  const statementId =
    cited === undefined ? null : await payReads.statementIdOf(tx, cited.memberId, cited.period);
  if (cited === undefined || statementId === null)
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
    correctsStatementId: statementId,
  };
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
  reads: InvoicingReads,
  correctContest: ContestCorrectionWrite,
  now: () => Date,
): PayrollInvoiceAcceptanceStore {
  return {
    read: (userId, invoiceId) =>
      withMember(db, userId, async (tx) => {
        const document = await documentOf(tx, invoiceId);
        return document === null ? null : viewOf(tx, document);
      }),

    list: (userId, query) =>
      withMember(db, userId, async (tx) => {
        const timeZone = await reads.agencyTimeZone(tx);
        return listOf(tx, query, timeZone, calendarDayAt(now(), timeZone));
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
            !correctionReplayed(
              contested.document,
              correction,
              reason,
              await payReads.correctionOf(tx, document.id),
            )
          ) {
            throw new InvoiceAcceptanceConflict('contest_upheld');
          }
          return viewOf(tx, document);
        }
        const adjustments = correctionAdjustments(contested.document, correction, reason);
        const { period, adjustmentIds } = await correctContest(tx, actor, {
          memberId: TeamMemberIdSchema.parse(document.memberId),
          contestedInvoiceId: document.id,
          correctsStatementId: contested.correctsStatementId,
          adjustments,
        });
        // Checked again at the commit, both ways: the uphold and the adjustments that name the document.
        await writeStep(tx, document, step, actor, {
          correction: correction.kind,
          adjustmentIds,
          period,
        });
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
