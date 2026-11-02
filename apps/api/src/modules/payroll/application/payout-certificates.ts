import type { CommissionStatementId } from '@nirvana/contracts';

import { invoicePdfRetainUntil } from '../domain/invoice-pdf';
import type { InvoiceObjectStore, JobLogger, PayrollPayoutCertificateStore } from '../domain/ports';

import { lockAtLeast } from './locked-objects';

export interface PayoutCertificateDeps {
  readonly store: PayrollPayoutCertificateStore;
  /** The locked bucket of ADR 0028, at Hetzner: every document filed. */
  readonly primary: InvoiceObjectStore;
  /** The second copy (ADR 0037 § 6), at OVHcloud: the documents the owner accepted. */
  readonly copy: InvoiceObjectStore;
}

/**
 * `payroll.lock_payout_certificate` (ADR 0041 § 6): the tax residence certificate a transfer relied on is kept as long
 * as the transfer's proof, ten years after the close of the fiscal year of the transfer (`invoicePdfRetainUntil`), in
 * both buckets; a lock only lengthens (`lockAtLeast`). Its acceptance already locks it that long under the same fiscal
 * year: this run makes sure of it, then records it once. A certificate missing from a locked bucket, a lock the bucket
 * does not name or a bucket that refuses leaves that transfer unrecorded and fails the run once the others are done:
 * retried, then taken again by the night's run (`null`). The transfer itself was recorded already: a bucket never
 * refuses it. A store in memory that forgot the file (a restart in development) is warned only.
 */
export async function lockPayoutCertificates(
  deps: PayoutCertificateDeps,
  statementId: CommissionStatementId | null,
  logger: JobLogger,
): Promise<number> {
  let locked = 0;
  let failed = 0;
  for (const certificate of await deps.store.toLockUnscoped(statementId)) {
    const context = { statementId: certificate.statementId, documentId: certificate.documentId };
    const due = invoicePdfRetainUntil(certificate.paidOn, certificate.fiscalYearEndMonth);
    try {
      for (const [place, bucket] of [
        ['primary', deps.primary],
        ['copy', deps.copy],
      ] as const) {
        const found = await bucket.read(certificate.key);
        if (found === null) {
          if (bucket.volatile) {
            logger.warn({ ...context, place }, 'payroll.lock_payout_certificate: certificate forgotten');
            continue;
          }
          throw new Error(`the certificate is missing at ${place}`);
        }
        if (found.retainUntil === null)
          throw new Error(`the certificate has no lock the bucket names at ${place}`);
        await lockAtLeast(bucket, certificate.key, found.retainUntil, due, logger);
      }
      if (await deps.store.recordLockedUnscoped(certificate, due)) locked += 1;
    } catch (error) {
      failed += 1;
      logger.error({ ...context, err: error }, 'payroll.lock_payout_certificate: certificate not locked');
    }
  }
  if (failed > 0)
    throw new Error(`payroll.lock_payout_certificate: ${String(failed)} certificate(s) not locked`);
  return locked;
}
