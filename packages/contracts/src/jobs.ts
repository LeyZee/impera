import { z } from 'zod';

import { PlatformSchema } from './enums';
import {
  CommissionStatementIdSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  CreatorTaskIdSchema,
  DraftIdSchema,
  EventIdSchema,
  FanIdSchema,
  InvoiceIdSchema,
  MediaAssetIdSchema,
  PlatformAccountIdSchema,
  SuggestionIdSchema,
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
  'connector.vault_sync',
  'fans.refresh_summary',
  'fans.read_card',
  'fans.purge_facts',
  'rate_limit.purge',
  'backups.check',
  'rewards.evaluate',
  'ai_usage.check_credits',
  'notifications.recap',
  'notifications.creator_sale',
  'creator_tasks.remind',
  'creator_tasks.suggestion_decided',
  'scheduling.make_shifts',
  'scheduling.lapse_swaps',
  'scheduling.check_agency_shares',
  'scheduling.check_reports',
  'scheduling.remind_reports',
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
  'content_drops.receive_file',
  'content_drops.convert_file',
  'content_drops.erase_originals',
  'content_drops.drop_received',
  'content_drops.describe_file',
  'content_drops.summarize_script',
  'content_drops.describe_backlog',
  'content_drops.make_thumbnail',
  'content_drops.thumbnail_backlog',
  'scripts.ask_scripts',
  'providers.check_credentials',
  'connector.read_sales',
  'connector.check_sales',
  'connector.copy_avatar',
  'connector.read_daily_stats',
  'telegram.scan',
  'telegram.flush_chat',
  'telegram.dispatch_polls',
  'telegram.poll_updates',
  'telegram.morning_digest',
  'telegram.evening_digest',
  'telegram.connection_reminders',
  'telegram.purge',
] as const;
export const JobNameSchema = z.enum(JOB_NAMES);
export type JobName = z.infer<typeof JobNameSchema>;

/**
 * What each job does, in the owner's words: the Dashboard names a stuck job by it, never by its identifier (recette
 * 05/11, PRO-10).
 */
export const JOB_LABELS: Readonly<Record<JobName, string>> = {
  'conversation.respond': 'Réponse aux fans',
  'conversation.send': 'Envoi des messages',
  'conversation.follow_up': 'Relances des fans',
  'conversation.record_facts': 'Mémoire des fans',
  'conversation.reopen': 'Reprise à l’ouverture de ses heures',
  'conversation.release_unavailable': 'Conversations rendues par un membre absent',
  'connector.dispatch': 'Lecture des comptes Reveal',
  'connector.poll': 'Lecture d’un compte Reveal',
  'connector.reconcile': 'Vérification des envois Reveal',
  'connector.vault_sync': 'Synchronisation du coffre Reveal',
  'fans.refresh_summary': 'Résumé des fans',
  'fans.read_card': 'Fiche des fans remplie par l’IA',
  'fans.purge_facts': 'Nettoyage de la mémoire des fans',
  'rate_limit.purge': 'Nettoyage des limites de connexion',
  'backups.check': 'Vérification des sauvegardes',
  'rewards.evaluate': 'Gains du jeu des chatteurs',
  'ai_usage.check_credits': 'Vérification des crédits IA',
  'notifications.recap': 'Récapitulatif des notifications',
  'notifications.creator_sale': 'Notification de vente à la créatrice',
  'creator_tasks.remind': 'Rappels de l’agenda',
  'creator_tasks.suggestion_decided': 'Réponse à une suggestion d’agenda',
  'scheduling.make_shifts': 'Création des shifts réguliers',
  'scheduling.lapse_swaps': 'Échanges de shift expirés',
  'scheduling.check_agency_shares': 'Contrôle des pourcentages de l’agence',
  'scheduling.check_reports': 'Rapports de fin de shift comparés à Reveal',
  'scheduling.remind_reports': 'Rappels du rapport de fin de shift',
  'team.apply_roles': 'Rôles de l’équipe',
  'payroll.recalculate': 'Calcul de la paie',
  'payroll.recalculate_open': 'Calcul de la paie en cours',
  'payroll.fetch_exchange_rates': 'Taux de change du jour',
  'payroll.issue_invoices': 'Émission des factures',
  'payroll.requeue_invoice_issues': 'Reprise des factures',
  'payroll.render_invoice_pdf': 'PDF des factures',
  'payroll.mirror_invoice_pdf': 'Copie des PDF de factures',
  'payroll.lapse_invoice': 'Factures expirées',
  'payroll.announce_invoice_contest': 'Contestation de facture',
  'payroll.sweep_invoice_acceptance': 'Acceptation des factures',
  'payroll.remind_documents': 'Rappels de documents',
  'payroll.remind_due_invoices': 'Rappels de factures dues',
  'payroll.purge_refused_documents': 'Nettoyage des documents refusés',
  'payroll.settle_documents': 'Règlement des documents',
  'payroll.lock_payout_certificate': 'Attestation de paiement',
  'media.describe': 'Description des médias',
  'content_drops.receive_file': 'Réception des fichiers de contenu',
  'content_drops.convert_file': 'Conversion des vidéos',
  'content_drops.erase_originals': 'Nettoyage des originaux de contenu',
  'content_drops.drop_received': 'Dépôt reçu pour une idée',
  'content_drops.describe_file': 'Description des médias déposés',
  'content_drops.summarize_script': 'Synthèse des scripts tournés',
  'content_drops.describe_backlog': 'Rattrapage des descriptions',
  'content_drops.make_thumbnail': 'Vignettes des médias déposés',
  'content_drops.thumbnail_backlog': 'Rattrapage des vignettes',
  'scripts.ask_scripts': 'Demandes de scripts',
  'providers.check_credentials': 'Vérification des clés des services',
  'connector.read_sales': 'Lecture des ventes Reveal',
  'connector.check_sales': 'Contrôle des ventes Reveal',
  'connector.read_daily_stats': 'Statistiques quotidiennes Reveal',
  'connector.copy_avatar': 'Copie de la photo d’une créatrice',
  'telegram.scan': 'Alertes Telegram',
  'telegram.flush_chat': 'Envoi des messages Telegram',
  'telegram.dispatch_polls': 'Lecture de Telegram',
  'telegram.poll_updates': 'Réponses reçues sur Telegram',
  'telegram.morning_digest': 'Résumé Telegram du matin',
  'telegram.evening_digest': 'Résumé Telegram du soir',
  'telegram.connection_reminders': 'Rappels de connexion Telegram',
  'telegram.purge': 'Nettoyage de Telegram',
};

/**
 * The jobs of no creator that still stop her agent when they are stuck (recette 05/11, PRO-10): the reading of the
 * Reveal accounts. Any other job of no creator (pay, Telegram, backups) is the agency's, never her agent's health.
 */
export const AGENT_SYSTEM_JOBS: readonly JobName[] = ['connector.dispatch'];

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
  /**
   * The account's vault mirrored in the CRM (ADR 0099 § 2 to 4, fiche vault-sync): folders, media and the platform's
   * order, read only, never a file nor a model call. On the account's queue, after its poll; replayable, writes nothing
   * when nothing moved. Asked by the owner (`POST /v1/creators/:creatorId/vault/sync`), never by a cron for now.
   */
  'connector.vault_sync': z.object({
    creatorId: CreatorIdSchema,
    platformAccountId: PlatformAccountIdSchema,
    correlationId: z.string().min(1),
  }),
  'fans.refresh_summary': conversationJob.extend({ fanId: FanIdSchema }),
  /**
   * The AI reads his new messages in a conversation and fills his card (ADR 0085 § 7), whoever answers him: debounced
   * per conversation, when he has been silent `FAN_CARD_READ.silenceMinutes` or has written `FAN_CARD_READ.burst`
   * messages, at most once every `FAN_CARD_READ.spacingMinutes` (`cardReadRunAt`). Replayable: it reads from where the
   * last read stopped, and the facts it proposes are written once.
   */
  'fans.read_card': conversationJob,
  'fans.purge_facts': z.object({}),
  'rate_limit.purge': z.object({}),
  'backups.check': z.object({}),
  /** What each chatter earned since the last run (ADR 0104 § 12 to § 15): replayable, a gain is written once. */
  'rewards.evaluate': z.object({}),
  'ai_usage.check_credits': z.object({}),
  /** At the end of an account's quiet hours: one notification for all it held (CR-01). Keyed by account. */
  'notifications.recap': z.object({ userId: z.string().min(1) }),
  /**
   * A fresh sale told to her own accounts (CRM-04 lot d2, ADR 0042 § 7): the `sale_detected` that the sales ledger
   * published, enqueued in the same transaction under the key `notifications.creator_sale:<saleId>`. The job reads her
   * part and its currency from the event, never its seller.
   */
  'notifications.creator_sale': z.object({ eventId: EventIdSchema }),
  /**
   * The reminder she chose for a task at an hour (CR-05 lot b3): enqueued with the task's write under the key
   * `creator_tasks.remind:<taskId>`, at its start less her minutes. `startsAt` is the start it was scheduled for: a
   * move replaces the job, and a job left from before rings nothing.
   */
  'creator_tasks.remind': z.object({ taskId: CreatorTaskIdSchema, startsAt: z.iso.datetime() }),
  /**
   * Her gesture on one of the agency's suggestions (VEI-01 d2): enqueued in the transaction of her accept or decline,
   * under the key `creator_tasks.suggestion_decided:<suggestionId>`, once per suggestion. `day` is the day of the task
   * she accepted, in her zone (the day she decided for a routine or a decline). The agenda only announces it; the
   * trend watch handles it (an idea's shoot becomes a content request, or the idea is declined) and does nothing for a
   * suggestion that no idea became.
   */
  'creator_tasks.suggestion_decided': z.object({
    creatorId: CreatorIdSchema,
    suggestionId: SuggestionIdSchema,
    state: z.enum(['accepted', 'declined']),
    day: z.iso.date(),
  }),
  'scheduling.make_shifts': z.object({}),
  'scheduling.lapse_swaps': z.object({}),
  /**
   * On the 2nd and the 17th (CRM-04 lot d3): the fortnight just over, in the agency's zone, for each creator with an
   * agency percentage on it. Her part read on the platform is compared with the percentage, and
   * `agency_share_mismatch` is published once per account, fortnight and currency when they differ by more than
   * rounding explains. It writes nothing else.
   */
  'scheduling.check_agency_shares': z.object({}),
  'scheduling.check_reports': z.object({}),
  /**
   * Every five minutes (ADR 0077): the member of a shift ended without its report is reminded on his phone, 15 minutes
   * after its end, then 12 hours after. Each reminder rings once (`notification_deliveries`); a run missed is caught by
   * the next one within its window, never later.
   */
  'scheduling.remind_reports': z.object({}),
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
  /**
   * Her file's bytes are whole in the storage (CR-06 b): the job checks their size against what her phone declared and
   * marks the file received, then cleans it (metadata removed, format checked, fingerprint) into her library or finds
   * it a duplicate, and erases the raw bytes; its drop follows. One per file (job key), replayable step by step.
   */
  'content_drops.receive_file': z.object({
    creatorId: CreatorIdSchema,
    fileId: ContentDropFileIdSchema,
    correlationId: z.string().min(1),
  }),
  /**
   * Her video in a format the platforms do not read, converted into an H.264 MP4 (ADR 0070 § 3), in the queue
   * `content_drops:convert` where conversions pass one at a time: `content_drops.receive_file` hands it over and
   * never waits for it. Then as a receipt: format checked, fingerprint, medium or duplicate, raw bytes erased.
   */
  'content_drops.convert_file': z.object({
    creatorId: CreatorIdSchema,
    fileId: ContentDropFileIdSchema,
    correlationId: z.string().min(1),
  }),
  /**
   * Each hour (CR-06 c, ADR 0044 § 2, ADR 0055 § 7): a send left unfinished for 24 hours is refused, the agency is told
   * 7 days before an original goes, and the originals due are erased from the media storage (a withdrawn drop's at
   * once). Replayable: each step moves only what is still due, and says each thing once.
   */
  'content_drops.erase_originals': z.object({}),
  /**
   * A drop answering a content request has all its bytes (VEI-01 d3): enqueued in the transaction that writes
   * `content_drop_received`, under the key `content_drops.drop_received:<dropId>`, once per drop. Content drops only
   * announce it; the trend watch handles it (the idea that asked the request is `deposited`) and does nothing for a
   * request that no idea asked.
   */
  'content_drops.drop_received': z.object({
    creatorId: CreatorIdSchema,
    dropId: ContentDropIdSchema,
    requestId: ContentRequestIdSchema,
  }),
  /**
   * A photo or a video she dropped, kept as a new medium of her library, described by the vision AI with what the drop
   * says of it (ADR 0083 § 1). Enqueued in the transaction that keeps it, under `content_drops.describe_file:<id>`;
   * put off by itself when the day's budget is spent or the disk short. Nothing while her switch is off (§ 9).
   */
  'content_drops.describe_file': z.object({
    creatorId: CreatorIdSchema,
    mediaAssetId: MediaAssetIdSchema,
    correlationId: z.string().min(1),
  }),
  /**
   * A script she sent, told step by step with its synthesis once each of its media is described (ADR 0083 § 6).
   * Enqueued when she sends it and after each of its media is described, under `content_drops.summarize_script:<id>`;
   * waits for the last description, puts itself off when the day's budget is spent. Nothing while her switch is off.
   */
  'content_drops.summarize_script': z.object({
    creatorId: CreatorIdSchema,
    dropId: ContentDropIdSchema,
    correlationId: z.string().min(1),
  }),
  /**
   * Each hour, and for one creator when her switch is turned on (ADR 0083 § 2, § 9): what waits for the vision or the
   * brain is enqueued again, each medium with no description of the prompt of now (none, or an older version and no
   * human's), each sent script with no synthesis of now. A job already waiting keeps its time.
   */
  'content_drops.describe_backlog': z.object({ creatorId: CreatorIdSchema.optional() }),
  /**
   * A photo or a video of her library gets its reduced picture for the agency's screen (ADR 0030 § 4, SC-04 lot c4),
   * whatever her switch of the descriptions. Enqueued in the transaction that keeps it, under
   * `content_drops.make_thumbnail:<id>`; tried once, made or not.
   */
  'content_drops.make_thumbnail': z.object({
    creatorId: CreatorIdSchema,
    mediaAssetId: MediaAssetIdSchema,
    correlationId: z.string().min(1),
  }),
  /** Each hour: each photo and video of a live drop never tried, its original still held, gets its picture's job. */
  'content_drops.thumbnail_backlog': z.object({}),
  /**
   * Each hour (SC-02, ADR 0056 § 2): each creator whose next script is due within the lead gets her request, with the
   * next structure of her queue that does not touch her limits, frozen. Replayable: one request per due day.
   */
  'scripts.ask_scripts': z.object({}),
  'providers.check_credentials': z.object({}),
  /**
   * Each minute (crontab, ADR 0050 § 3): every connected sales feed reads its register after the stored cursor, the
   * lines and the cursor written in one transaction. Replayable: a line already recorded is skipped.
   */
  'connector.read_sales': z.object({
    /** Enqueued by a webhook delivery: read now. Without it (the minute's crontab), a feed whose webhook works waits
     * for its hourly catch-up (ADR 0050 § 3). */
    woken: z.boolean().optional(),
  }),
  /**
   * The automatic check of a fortnight after a switch to the platform's net (CRM-04 lot b3): the crontab's, on the 2nd
   * and the 17th, checks the fortnight just over; a mismatch enqueues `recheck` 24 hours later, which alone publishes
   * `sales_feed_mismatch` when the register and the statistics still differ. Nothing is kept in `sales_feed_checks`.
   */
  'connector.check_sales': z.object({
    recheck: z.object({ platform: PlatformSchema, from: PayPeriodSchema }).optional(),
  }),
  /**
   * Each hour (ADR 0081 § 3): the platform's statistics of each linked creator account's day, today and yesterday, or
   * the 31 last days at 5 h in the platform's zone and until a reading of 31 days went through since the key was
   * verified. Counters only, rewritten at each reading; no call once fewer than 100 of the day's 500 are left.
   */
  'connector.read_daily_stats': z.object({}),
  /**
   * The photo of a creator just imported from a platform (CRM-07 a2b, ADR 0069 § 3): read again from the platform's
   * model list, fetched, re-encoded and kept in the media bucket under `creators/<id>/avatar`. Replayable: the object
   * is written over and `creators.avatar_key` set to the same key.
   */
  'connector.copy_avatar': z.object({
    platform: PlatformSchema,
    platformModelId: z.string().min(1).max(200),
    creatorId: CreatorIdSchema,
  }),
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
  'connector.vault_sync': 3,
  'fans.refresh_summary': 3,
  // Replayable: it reads from where the last read stopped (`conversations.card_read_through`).
  'fans.read_card': 3,
  'fans.purge_facts': 1,
  'rate_limit.purge': 1,
  'backups.check': 1,
  // Every ten minutes: the next run is the retry.
  'rewards.evaluate': 1,
  // Each hour: the next run is the retry; an alert is published once per episode.
  'ai_usage.check_credits': 1,
  'notifications.recap': 3,
  // Replayable: each account is told once per sale (`notification_deliveries`), so a retry tells only the ones missed.
  'notifications.creator_sale': 5,
  // Replayable: told once per task and start (`notification_deliveries`).
  'creator_tasks.remind': 3,
  // Replayable: the request is written under the idea's id, the idea moves only from `suggested`.
  'creator_tasks.suggestion_decided': 5,
  'scheduling.make_shifts': 1,
  'scheduling.lapse_swaps': 1,
  // Twice a month, reading the register only: a failure is worth a retry, and the event is published once anyway.
  'scheduling.check_agency_shares': 3,
  'scheduling.check_reports': 1,
  // Every five minutes, and each reminder rings once: the next run is the retry.
  'scheduling.remind_reports': 1,
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
  // Graphile waits exp(n) seconds after the n-th failure: nine attempts span a little more than an hour, through a
  // short outage of the storage; a file left waiting is sent again by her phone.
  'content_drops.receive_file': 9,
  // As a receipt: a storage out, a machine short of disk or a conversion killed by its time limit are retried.
  'content_drops.convert_file': 9,
  // Each hour: the next run is the retry.
  'content_drops.erase_originals': 1,
  // Replayable: the idea moves only from `suggested`.
  'content_drops.drop_received': 5,
  // Every model failed (an outage, a refusal): a few tries; a spent budget is not a failure, the job puts itself off.
  'content_drops.describe_file': 5,
  // The same: every model failed, or its answer did not tell the script's steps; a spent budget puts it off.
  'content_drops.summarize_script': 5,
  // Each hour: the next run is the retry.
  'content_drops.describe_backlog': 1,
  // A storage or an ffmpeg that does not answer: a few tries; a file ffmpeg cannot read is not a failure.
  'content_drops.make_thumbnail': 5,
  // Each hour: the next run is the retry.
  'content_drops.thumbnail_backlog': 1,
  // Each hour: the next run is the retry.
  'scripts.ask_scripts': 1,
  'providers.check_credentials': 1,
  // Each minute: the next run is the retry, from the cursor the last committed read left.
  'connector.read_sales': 1,
  // Twice a month and its recheck: a refusal of the platform (429, outage) is worth a retry, and a mismatch is
  // published once per platform and fortnight whatever the attempts.
  'connector.check_sales': 3,
  // A platform or a storage out for a while: a few tries over some minutes, then her initials stay.
  'connector.copy_avatar': 5,
  // Each hour: the next run is the retry, and a reading is replayable (each row written over).
  'connector.read_daily_stats': 1,
  // The scan is also enqueued by the `domain_events` trigger (0006) with 25, and a flush by the module with 10:
  // a scan is idempotent (cursor) and a flush is Telegram's own pace, both cheap to retry.
  'telegram.scan': 25,
  'telegram.flush_chat': 10,
  'telegram.dispatch_polls': 1,
  'telegram.poll_updates': 1,
  // Its hour is 8 o'clock only: a failed run is retried within it, the key of her day keeps it once.
  'telegram.morning_digest': 3,
  // Its hour is 23 o'clock only: a failed run is retried within it, the key of her day keeps it once.
  'telegram.evening_digest': 3,
  // Every 10 minutes: the next run is the retry, the reminder's key keeps it once (P3-12).
  'telegram.connection_reminders': 1,
  'telegram.purge': 1,
} as const satisfies Record<JobName, number>;

/**
 * The vision AI's tries on a dropped medium (recette créatrice, anomaly 2): the describing job's attempts, counted on
 * the medium (`media_assets.description_failures`); past them, it waits for the agency (« Réessayer », or written).
 */
export const DESCRIPTION_TRIES = JOB_MAX_ATTEMPTS['content_drops.describe_file'];

/** Jobs debounced per conversation: a new one replaces the pending one (`jobKeyMode: 'replace'`). */
export const DEBOUNCED_JOBS = [
  'conversation.respond',
  'conversation.follow_up',
  'fans.refresh_summary',
  'fans.read_card',
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
