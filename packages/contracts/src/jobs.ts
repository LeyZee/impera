import { z } from 'zod';

import {
  CommissionStatementIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  InvoiceIdSchema,
  MediaAssetIdSchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
} from './ids';
import { PayPeriodSchema } from './pay-periods';
import { TELEGRAM_JOB_PAYLOADS } from './telegram';

/**
 * Graphile Worker job names and payloads (ADR 0006). A job that touches a conversation runs on the serial queue
 * `conv:<conversationId>`; a poll runs on `account:<platformAccountId>`, one at a time per account.
 */

const conversationJob = z.object({
  creatorId: CreatorIdSchema,
  conversationId: ConversationIdSchema,
  correlationId: z.string().min(1),
});

export const JOB_NAMES = [
  'conversation.respond',
  'conversation.send',
  'conversation.follow_up',
  'conversation.record_facts',
  'conversation.reopen',
  'conversation.release_unavailable',
  'connector.dispatch',
  'connector.poll',
  'connector.reconcile',
  'fans.refresh_summary',
  'fans.purge_facts',
  'rate_limit.purge',
  'backups.check',
  'scheduling.make_shifts',
  'scheduling.lapse_swaps',
  'team.apply_roles',
  'payroll.recalculate',
  'payroll.recalculate_open',
  'payroll.fetch_exchange_rates',
  'payroll.issue_invoices',
  'payroll.requeue_invoice_issues',
  'payroll.render_invoice_pdf',
  'payroll.mirror_invoice_pdf',
  'payroll.lapse_invoice',
  'payroll.announce_invoice_contest',
  'payroll.sweep_invoice_acceptance',
  'payroll.remind_documents',
  'payroll.remind_due_invoices',
  'payroll.purge_refused_documents',
  'payroll.settle_documents',
  'payroll.lock_payout_certificate',
  'media.describe',
  'providers.check_credentials',
  'connector.read_sales',
  'telegram.scan',
  'telegram.flush_chat',
  'telegram.dispatch_polls',
  'telegram.poll_updates',
  'telegram.morning_digest',
  'telegram.purge',
] as const;
export const JobNameSchema = z.enum(JOB_NAMES);
export type JobName = z.infer<typeof JobNameSchema>;

export const JOB_PAYLOADS = {
  /**
   * Her answer to his last message (message-flow.md §1). `waitedFor` only on the second pass after she chose to wait
   * (« attends, je reviens », P3-11): his message she waited on; one of his since replaces this job.
   */
  'conversation.respond': conversationJob.extend({ waitedFor: z.iso.datetime().exactOptional() }),
  'conversation.send': conversationJob.extend({ draftId: DraftIdSchema }),
  /**
   * A follow-up to a fan who went silent after her answer (P3-10): `anchorAt` is his last message, which the delays
   * of `persona.follow_ups` count from; `step` is the index of the delay. A message of his since moves the anchor and
   * the job does nothing.
   */
  'conversation.follow_up': conversationJob.extend({
    anchorAt: z.iso.datetime(),
    step: z.number().int().min(0).max(4),
  }),
  /**
   * What she learnt about the fan becomes facts (P3-02): the facts the brief proposed for a draft a human approved,
   * or the note a chatter left on giving the conversation back. `at` fixes the note's slot, so a replay rewrites
   * nothing.
   */
  'conversation.record_facts': conversationJob.extend({
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('draft'), draftId: DraftIdSchema }),
      z.object({
        kind: z.literal('operator_note'),
        note: z.string().min(1).max(300),
        at: z.iso.datetime(),
      }),
    ]),
  }),
  /**
   * Her next reply slot opened (P3-14): the fans who wrote while she was out of her hours are answered, the longest
   * wait first. One per creator (`reopenJobKey`): every deferral out of her hours points at it.
   */
  'conversation.reopen': z.object({ creatorId: CreatorIdSchema, correlationId: z.string().min(1) }),
  /** Each minute: the conversations still held by a member who is no longer `active` are handed back (EQ-13). */
  'conversation.release_unavailable': z.object({}),
  'connector.dispatch': z.object({}),
  'connector.poll': z.object({
    creatorId: CreatorIdSchema,
    platformAccountId: PlatformAccountIdSchema,
    correlationId: z.string().min(1),
  }),
  'connector.reconcile': z.object({
    creatorId: CreatorIdSchema,
    platformAccountId: PlatformAccountIdSchema,
    correlationId: z.string().min(1),
  }),
  'fans.refresh_summary': conversationJob.extend({ fanId: FanIdSchema }),
  'fans.purge_facts': z.object({}),
  'rate_limit.purge': z.object({}),
  'backups.check': z.object({}),
  'scheduling.make_shifts': z.object({}),
  'scheduling.lapse_swaps': z.object({}),
  /** Each member's record takes the role in force today (`member_roles`), a role dated for today taking effect. */
  'team.apply_roles': z.object({}),
  /**
   * The drafts of `period` computed again (EQ-04, ADR 0032), and those of the team's first open period when `period`
   * is closed: a report validated after its period's closing counts there. Enqueued by what changes a period's inputs,
   * under the key `payroll.recalculate:<period>` (one waiting job per period); a run that finds nothing new writes
   * nothing.
   */
  'payroll.recalculate': z.object({ period: PayPeriodSchema }),
  /** Every open period up to the current one computed again, the hour's safety net; pay's periods written first. */
  'payroll.recalculate_open': z.object({}),
  /**
   * The ECB's last 90 days of rates, each day written once (ADR 0033); a run that finds nothing new writes nothing. Not
   * strict: the cron adds `_cron` to the payload of every run it enqueues.
   */
  'payroll.fetch_exchange_rates': z.object({}),
  /**
   * The invoice of a validated statement and the credit notes its period owes (EQ-06, ADR 0036), in one transaction:
   * enqueued by the validation, under the key `payroll.issue_invoices:<statementId>`. Each document has its key, so a
   * rerun writes only what is missing; what cannot be issued is said to the owner (`invoice_not_issued`).
   */
  'payroll.issue_invoices': z.object({ statementId: CommissionStatementIdSchema }),
  /**
   * Tries again the statements whose invoice waits (EQ-06 lot 5a): those of the member (all of them when `memberId` is
   * `null`) for which `invoice_not_issued` was said, once his file, his prefix, the check of his file or his mandate
   * changes, or the agency's settings (`null`). Enqueued in the transaction that changes them, under the key
   * `payroll.requeue_invoice_issues:<memberId | all>`; it enqueues `payroll.issue_invoices` for each, which issues only
   * what is missing and says only a new reason.
   */
  'payroll.requeue_invoice_issues': z.object({ memberId: TeamMemberIdSchema.nullable() }),
  /**
   * The PDF of an issued invoice or credit note, rendered once from its frozen data and kept in the locked bucket
   * (ADR 0037 § 5): enqueued in the transaction that issues it, under the key `payroll.render_invoice_pdf:<id>`. A
   * rerun replaces nothing; the last attempt that fails tells the owner (`invoice_pdf_missing`).
   */
  'payroll.render_invoice_pdf': z.object({ invoiceId: InvoiceIdSchema }),
  /**
   * The same bytes copied to the second provider (ADR 0037 § 6), once the PDF's row is written: enqueued with it, under
   * the key `payroll.mirror_invoice_pdf:<id>`. Same rules: nothing replaced, the last failed attempt said.
   */
  'payroll.mirror_invoice_pdf': z.object({ invoiceId: InvoiceIdSchema }),
  /**
   * The tacit acceptance of a document nobody answered (EQ-06 lot 6, ADR 0039 § 1): enqueued in the transaction that
   * issues it, to run at its deadline, under the key `payroll.lapse_invoice:<id>`. A run before the deadline (another
   * clock) waits for it again; an answered document is left as it is.
   */
  'payroll.lapse_invoice': z.object({ invoiceId: InvoiceIdSchema }),
  /**
   * The owner told of a contest (`invoice_contested`, ADR 0039 § 2): enqueued in the transaction that records it, under
   * the key `payroll.announce_invoice_contest:<id>`. Said once per document, whatever the reruns; nothing once the
   * contest has ended.
   */
  'payroll.announce_invoice_contest': z.object({ invoiceId: InvoiceIdSchema }),
  /**
   * Each hour (crontab), the net under the two jobs above: a document still unanswered after its deadline is accepted
   * tacitly, an open contest without its alert is said, whatever became of their own job (failed, lost).
   */
  'payroll.sweep_invoice_acceptance': z.object({}),
  /**
   * Each hour (crontab, EQ-06 lot 5c-2): each document a contractor's regime asks for that comes to its end, or passed
   * it, with no newer one filed, is said once to the owner (`contractor_document_expiring`).
   */
  'payroll.remind_documents': z.object({}),
  /**
   * Each morning (crontab, EQ-06 lot 8): each invoice not settled yet that comes to its due date is said once to the
   * owner, `invoice_due_soon` from seven days before it, `invoice_overdue` from the day after, with what stops the
   * transfer that will pay it (ADR 0041).
   */
  'payroll.remind_due_invoices': z.object({}),
  /**
   * Each night (crontab, EQ-06 lot 5c-2, « ok purge a » de Charles): each refused document whose upload lock has ended
   * has its file erased from the bucket; its row and its check stay (`contractor_document_purges`).
   */
  'payroll.purge_refused_documents': z.object({}),
  /**
   * The reconciliation of a contractor's transfers with his documents (EQ-06 lot 7a): each document is settled by the
   * first statement its carry-overs lead to that ends its debt: paid (`paid` for an invoice, `imputed` for a credit
   * note), or validated at a cumulated total of zero, or below zero for an invoice (`compensated`, ADR 0038). Enqueued
   * when a statement is validated or paid and when documents are issued, under the key
   * `payroll.settle_documents:<memberId>`; each night for every contractor (`null`). Writes only what is missing.
   */
  'payroll.settle_documents': z.object({ memberId: TeamMemberIdSchema.nullable() }),
  /**
   * Lengthens, in both buckets, the lock of the tax residence certificate a transfer relied on (ADR 0041 § 6) to ten
   * years after the close of the fiscal year of the transfer, never shorter. Enqueued with the record of the transfer,
   * under the key `payroll.lock_payout_certificate:<statementId>`; each night for every transfer whose certificate is
   * not locked yet (`null`). A bucket that does not answer fails the run, never the transfer.
   */
  'payroll.lock_payout_certificate': z.object({ statementId: CommissionStatementIdSchema.nullable() }),
  'media.describe': z.object({
    creatorId: CreatorIdSchema,
    mediaAssetId: MediaAssetIdSchema,
    correlationId: z.string().min(1),
  }),
  'providers.check_credentials': z.object({}),
  /**
   * Each minute (crontab, ADR 0050 § 3): every connected sales feed reads its register after the stored cursor, the
   * lines and the cursor written in one transaction. Replayable: a line already recorded is skipped.
   */
  'connector.read_sales': z.object({}),
  ...TELEGRAM_JOB_PAYLOADS,
} as const satisfies Record<JobName, z.ZodType>;

export type JobPayload<J extends JobName> = z.infer<(typeof JOB_PAYLOADS)[J]>;

/**
 * Attempts before Graphile gives a job up (it then stays in its table, counted by `/ready` as dead). Graphile's own
 * default is 25: a rerun of `respond` pays the LLM again, a broken payload would loop for a day. A cron job runs
 * once; the next tick is its retry.
 */
export const JOB_MAX_ATTEMPTS = {
  'conversation.respond': 3,
  'conversation.send': 3,
  'conversation.follow_up': 3,
  'conversation.record_facts': 3,
  'conversation.reopen': 3,
  // Each minute: the next run is the retry.
  'conversation.release_unavailable': 1,
  'connector.dispatch': 1,
  'connector.poll': 3,
  'connector.reconcile': 3,
  'fans.refresh_summary': 3,
  'fans.purge_facts': 1,
  'rate_limit.purge': 1,
  'backups.check': 1,
  'scheduling.make_shifts': 1,
  'scheduling.lapse_swaps': 1,
  'team.apply_roles': 1,
  // A recalculation is replayable and writes nothing when nothing changed; the hourly one catches up anyway.
  'payroll.recalculate': 5,
  'payroll.recalculate_open': 1,
  // The ECB may be down for a minute; the next hour reads the 90 days again anyway.
  'payroll.fetch_exchange_rates': 3,
  // Replayable: each document has its key, and a failed run wrote nothing.
  'payroll.issue_invoices': 5,
  // Replayable: it only enqueues, and each enqueue replaces the waiting run of its statement.
  'payroll.requeue_invoice_issues': 5,
  // Graphile waits exp(n) seconds after the n-th failure: nine attempts span a little more than an hour (ADR 0037 § 5),
  // through a short outage of a bucket, before the last one tells the owner.
  'payroll.render_invoice_pdf': 9,
  'payroll.mirror_invoice_pdf': 9,
  // Replayable, and a few seconds each: a lapse or an alert already written is left as it is. Twenty-five attempts
  // span about four days (exp(n) seconds, at most exp(10) between two), through any outage at the deadline; the hourly
  // sweep catches a run that still failed, or a job lost.
  'payroll.lapse_invoice': 25,
  'payroll.announce_invoice_contest': 25,
  // Each hour: the next run is the retry.
  'payroll.sweep_invoice_acceptance': 1,
  // Each hour: the next run is the retry, and a document is said once.
  'payroll.remind_documents': 1,
  // Each morning, and replayable: an invoice is said once per type, and a day missed is caught up by the next one.
  'payroll.remind_due_invoices': 5,
  // Each night: the next night is the retry, and an erasure is recorded once its file is gone.
  'payroll.purge_refused_documents': 1,
  // Replayable: it writes only the settlements still missing, under the contractor's lock.
  'payroll.settle_documents': 5,
  // Replayable: a lock only lengthens, and the run records it once; the night's run takes again what failed.
  'payroll.lock_payout_certificate': 5,
  'media.describe': 3,
  'providers.check_credentials': 1,
  // Each minute: the next run is the retry, from the cursor the last committed read left.
  'connector.read_sales': 1,
  // The scan is also enqueued by the `domain_events` trigger (0006) with 25, and a flush by the module with 10:
  // a scan is idempotent (cursor) and a flush is Telegram's own pace, both cheap to retry.
  'telegram.scan': 25,
  'telegram.flush_chat': 10,
  'telegram.dispatch_polls': 1,
  'telegram.poll_updates': 1,
  'telegram.morning_digest': 1,
  'telegram.purge': 1,
} as const satisfies Record<JobName, number>;

/** Jobs debounced per conversation: a new one replaces the pending one (`jobKeyMode: 'replace'`). */
export const DEBOUNCED_JOBS = [
  'conversation.respond',
  'conversation.follow_up',
  'fans.refresh_summary',
] as const;

export function queueNameFor(conversationId: string): `conv:${string}` {
  return `conv:${conversationId}`;
}

/** The one opening job of a creator (P3-14): a later deferral replaces it, it never runs twice for one opening. */
export function reopenJobKey(creatorId: string): string {
  return `conversation.reopen:${creatorId}`;
}

export function accountQueueNameFor(platformAccountId: string): `account:${string}` {
  return `account:${platformAccountId}`;
}

export function jobKeyFor(job: JobName, conversationId: string): string {
  return `${job}:${conversationId}`;
}

/** Seconds between two answers owed when a stop is lifted: the fans who waited are answered one after the other. */
export const RESUME_SPACING_SECONDS = 15;

/**
 * When the answer owed to the fan at `index` (0 = the one who has waited longest) runs after a stop is lifted:
 * the first right away, then one every `RESUME_SPACING_SECONDS`, so that a long stop does not wake every model call
 * and every send at the same second.
 */
export function resumeRunAt(index: number, now: Date): Date {
  return new Date(now.getTime() + index * RESUME_SPACING_SECONDS * 1_000);
}
