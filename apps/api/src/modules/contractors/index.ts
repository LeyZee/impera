import type { CommissionStatementId } from '@nirvana/contracts';
import { withAdmin, type Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createPayrollBillingSettings } from './application/billing-settings';
import {
  createContractorDocuments,
  purgeRefusedDocuments,
  remindDocuments,
  type PurgeOutcome,
} from './application/contractor-documents';
import { lockPayoutCertificates } from './application/payout-certificates';
import type { InvoiceObjectStore, JobLogger } from './domain/ports';
import { createDrizzlePayrollBillingSettingsStore } from './infra/billing-settings-store';
import { createDrizzlePayrollContractorStore } from './infra/contractor-store';
import { createDrizzleDocumentPurgeStore } from './infra/document-purge-store';
import { createDrizzleDocumentReminderStore, documentReminderDaysOf } from './infra/document-reminder-store';
import { createDrizzlePayrollDocumentStore } from './infra/document-store';
import { createDrizzlePayoutCertificateStore } from './infra/payout-certificate-store';
import { readPng } from './infra/png';
import type {
  ContractorInvoiceReads,
  ContractorPayReads,
  ContractorReads,
  InvoiceRequeue,
} from './infra/ports';
import { createDrizzlePayrollRegimeStore } from './infra/regime-store';
import { createContractorRoutes, type RequireRole } from './infra/routes';

/**
 * The two buckets of the invoices and of the contractors' documents (ADR 0037 § 4 and § 6), which the composition root
 * builds from the configuration: S3 in production, one store in memory shared by the API and its inline worker
 * elsewhere. `invoicing` writes its PDFs in them too, through this file.
 */
export { createMemoryInvoiceStore, createS3InvoiceStore } from './infra/invoice-buckets';
export type { InvoiceObjectStore } from './domain/ports';
/** Reading and locking an object of a bucket, for the PDFs of the invoices too. */
export { lockAtLeast, readChecked, sha256Hex } from './application/locked-objects';
/** `payroll.lock_payout_certificate`, which recording a transfer enqueues in its transaction (ADR 0041 § 6). */
export { enqueuePayoutCertificateLock } from './infra/queue';
export type { ContractorInvoiceReads, ContractorPayReads, InvoiceRequeue } from './infra/ports';
/**
 * How a row of this module's tables reads, for the pay stores that still read them directly to issue and render an
 * invoice. They go when those reads go through a read port of this module (ARC-07).
 */
export { reviewOf } from './infra/document-rows';
export { regimeVatOf } from './infra/regime-store';

/**
 * Public entry point of the `contractors` module (ADR 0047 § 1): the contractor's file (identity, company, contract and
 * mandate, regimes, documents and their check, residence certificates, reminders, purge of refused documents) and the
 * agency's billing settings. Other modules import this file, or `pure.ts` for its pure rules (ADR 0051).
 */
export interface ContractorsModule {
  readonly name: 'contractors';
  /** Mounted under `/v1` by the server: `/payroll/billing-settings`, `/payroll/contractors/…`, `/payroll/contract-texts`, `/payroll/billing-regimes`. */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  readonly jobs: {
    /**
     * `payroll.remind_documents`, each hour (EQ-06 lot 5c-2): each document a contractor's regime asks for that comes
     * to its end, or passed it, with no newer one filed, said once to the owner (`contractor_document_expiring`).
     * Returns how many were said this run.
     */
    readonly remindDocuments: () => Promise<number>;
    /**
     * `payroll.purge_refused_documents`, each night (EQ-06 lot 5c-2, « ok purge a »): each refused document whose
     * upload lock has ended has its file erased from the first bucket, then the erasure recorded; its row stays.
     */
    readonly purgeRefusedDocuments: (logger: JobLogger) => Promise<PurgeOutcome>;
    /**
     * `payroll.lock_payout_certificate` (ADR 0041 § 6): the tax residence certificate a transfer relied on, locked in
     * both buckets ten years after the close of the fiscal year of the transfer. One transfer, or every transfer whose
     * certificate is not locked yet (`null`). Returns how many were recorded.
     */
    readonly lockPayoutCertificates: (
      statementId: CommissionStatementId | null,
      logger: JobLogger,
    ) => Promise<number>;
  };
}

export interface ContractorsDeps {
  /** Application role: what a member reads and writes runs through `withMember`. */
  readonly db: Database;
  /** Admin role, for the jobs, which read every contractor's file. */
  readonly adminDb: Database;
  /** What the file reads of the planning, from its `index.ts`. */
  readonly reads: ContractorReads;
  /** The invoices a change of the file may unblock: `payroll`'s, plugged by the composition root (ADR 0047 § 1). */
  readonly requeue: InvoiceRequeue;
  /** What the file reads of the invoices and of pay: `invoicing`'s and `payroll`'s, plugged by the composition root. */
  readonly invoices: ContractorInvoiceReads;
  readonly pay: ContractorPayReads;
  /** The two buckets the documents are kept in. */
  readonly buckets: { readonly primary: InvoiceObjectStore; readonly copy: InvoiceObjectStore };
  readonly now?: () => Date;
}

export function createContractorsModule(deps: ContractorsDeps): ContractorsModule {
  const now = deps.now ?? (() => new Date());
  const { primary, copy } = deps.buckets;
  return {
    name: 'contractors',
    routes: (requireRole) =>
      createContractorRoutes(
        createPayrollBillingSettings(
          createDrizzlePayrollBillingSettingsStore(deps.db, deps.requeue, now),
          readPng,
        ),
        createDrizzlePayrollContractorStore(
          deps.db,
          deps.reads,
          () => withAdmin(deps.adminDb, documentReminderDaysOf),
          deps.requeue,
          deps.invoices,
          now,
        ),
        createDrizzlePayrollRegimeStore(deps.db, deps.reads, deps.requeue, now),
        createContractorDocuments({
          store: createDrizzlePayrollDocumentStore(deps.db, deps.reads, now),
          primary,
          copy,
        }),
        requireRole,
      ),
    jobs: {
      remindDocuments: () =>
        remindDocuments(createDrizzleDocumentReminderStore(deps.adminDb, deps.reads, now)),
      purgeRefusedDocuments: (logger) =>
        purgeRefusedDocuments(
          { store: createDrizzleDocumentPurgeStore(deps.adminDb), primary, copy },
          logger,
        ),
      lockPayoutCertificates: (statementId, logger) =>
        lockPayoutCertificates(
          { store: createDrizzlePayoutCertificateStore(deps.adminDb, deps.pay), primary, copy },
          statementId,
          logger,
        ),
    },
  };
}
