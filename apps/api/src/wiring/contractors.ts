import { JOB_PAYLOADS } from '@impera/contracts';
import { parseEncryptionKeys, type EncryptionKey } from '@impera/db';

import { invoiceBucket, secretOrNull, type Config } from '../config';
import { defineTask } from '../jobs';
import {
  createContractorsModule,
  createMemoryInvoiceStore,
  createS3InvoiceStore,
  type ContractorInvoiceReads,
  type ContractorPayReads,
  type ContractorsModule,
  type InvoiceObjectStore,
  type InvoiceRequeue,
} from '../modules/contractors';
import type { NotificationsModule } from '../modules/notifications';
import type { SchedulingModule } from '../modules/scheduling';

import type { Routes, Shared, TasksNamed } from './shared';

/** The invoices' two buckets (ADR 0037 § 4 and § 6). */
export interface InvoiceBuckets {
  readonly primary: InvoiceObjectStore;
  readonly copy: InvoiceObjectStore;
}

/**
 * The configured buckets (always in production, `loadConfig` refuses to start without), or one store in memory each,
 * shared by the API and its inline worker, lost with the process: `volatile`, so that a PDF forgotten by a restart is
 * never alerted as a damaged one.
 */
function invoiceBuckets(config: Config): InvoiceBuckets {
  const primary = invoiceBucket(config, 'primary');
  const copy = invoiceBucket(config, 'copy');
  return {
    primary: primary === null ? createMemoryInvoiceStore({ volatile: true }) : createS3InvoiceStore(primary),
    copy: copy === null ? createMemoryInvoiceStore({ volatile: true }) : createS3InvoiceStore(copy),
  };
}

/** CREDENTIALS_ENCRYPTION_KEYS, which seal « Où te verser » (ADR 0165 § 2); `null` when unset. */
function credentialKeysOf(config: Config): EncryptionKey[] | null {
  const keys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
  return keys === null ? null : parseEncryptionKeys(keys, 'CREDENTIALS_ENCRYPTION_KEYS');
}

/**
 * The jobs the contractors' file carries (ADR 0047 § 1): their names stay `payroll.*`, since tasks already queued carry
 * them, and each has exactly one task, this file's.
 */
export type ContractorJob =
  | 'payroll.remind_documents'
  | 'payroll.purge_refused_documents'
  | 'payroll.lock_payout_certificate'
  | 'payroll.notify_payout_change';

export interface WiredContractors {
  readonly module: ContractorsModule;
  /** The buckets, built once: `wirePayroll` writes the invoices' PDFs in them. */
  readonly buckets: InvoiceBuckets;
  readonly tasks: TasksNamed<ContractorJob>;
  readonly routes: readonly Routes[];
}

/**
 * The contractors' file reads the agency's time zone from the planning (`index.ts`), and asks pay to try its waiting
 * invoices again through `InvoiceRequeue`, which the invoices implement, and reads the invoices and pay through
 * `ContractorInvoiceReads` and `ContractorPayReads`: the module never imports them (ADR 0047 § 1).
 */
export function wireContractors(
  shared: Shared,
  deps: {
    readonly scheduling: SchedulingModule;
    readonly requeue: InvoiceRequeue;
    /** What the file reads of the invoices and of pay (ARC-07). */
    readonly invoices: ContractorInvoiceReads;
    readonly pay: ContractorPayReads;
    /** Push, to tell a member his « Où te verser » changed (ADR 0165 § 5); `null` while push is off. */
    readonly notify: NotificationsModule['notify'];
    /** Tests plug the two buckets here, to read what the jobs wrote; the configuration's otherwise. */
    readonly invoiceBuckets?: InvoiceBuckets;
    /** Tests set the clock here (`payrollClock`); the system's otherwise. */
    readonly now?: () => Date;
  },
): WiredContractors {
  const { config, db, adminDb, logger, requireRole } = shared;
  const buckets = deps.invoiceBuckets ?? invoiceBuckets(config);
  const module = createContractorsModule({
    db,
    adminDb,
    reads: { agencyTimeZone: deps.scheduling.pay.agencyTimeZone },
    requeue: deps.requeue,
    invoices: deps.invoices,
    pay: deps.pay,
    buckets,
    credentialKeys: credentialKeysOf(config),
    ...(deps.now !== undefined && { now: deps.now }),
  });
  return {
    module,
    buckets,
    tasks: {
      'payroll.remind_documents': defineTask(
        'payroll.remind_documents',
        JOB_PAYLOADS['payroll.remind_documents'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { reminded: await module.jobs.remindDocuments() },
            'payroll: expiring documents reminded',
          );
        },
      ),
      'payroll.purge_refused_documents': defineTask(
        'payroll.purge_refused_documents',
        JOB_PAYLOADS['payroll.purge_refused_documents'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcome: await module.jobs.purgeRefusedDocuments(context.logger) },
            'payroll: refused documents purged',
          );
        },
      ),
      'payroll.lock_payout_certificate': defineTask(
        'payroll.lock_payout_certificate',
        JOB_PAYLOADS['payroll.lock_payout_certificate'],
        logger,
        async (payload, context) => {
          const locked = await module.jobs.lockPayoutCertificates(payload.statementId, context.logger);
          context.logger.info(
            { statementId: payload.statementId, locked },
            'payroll: payout certificates locked',
          );
        },
      ),
      'payroll.notify_payout_change': defineTask(
        'payroll.notify_payout_change',
        JOB_PAYLOADS['payroll.notify_payout_change'],
        logger,
        async (payload, context) => {
          const notify = deps.notify;
          if (notify === null) {
            context.logger.warn('payroll: push is off, the payout change stays in the audit log');
            return;
          }
          const outcome = await notify(
            {
              userId: payload.userId,
              reason: 'payout_change',
              objectKey: payload.versionId,
              timeZone: payload.timeZone,
              message: {
                title: 'Où te verser a changé',
                body: 'Si ce n’est pas toi, préviens ton responsable tout de suite.',
                url: '/moi',
                tag: 'payout_change',
              },
            },
            new Date(),
          );
          context.logger.info({ outcome }, 'payroll: payout change told to the member');
        },
      ),
    },
    routes: [
      module.routes(requireRole, shared.recentLogin),
      module.payoutRoutes(requireRole, shared.recentLogin),
    ],
  };
}
