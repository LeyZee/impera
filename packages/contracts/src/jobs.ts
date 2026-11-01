import { z } from 'zod';

import {
  CommissionStatementIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  MediaAssetIdSchema,
  PlatformAccountIdSchema,
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
  'media.describe',
  'providers.check_credentials',
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
  'media.describe': z.object({
    creatorId: CreatorIdSchema,
    mediaAssetId: MediaAssetIdSchema,
    correlationId: z.string().min(1),
  }),
  'providers.check_credentials': z.object({}),
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
  'media.describe': 3,
  'providers.check_credentials': 1,
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
