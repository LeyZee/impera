import { CommissionStatementIdSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PayoutCertificate, PayrollPayoutCertificateStore } from '../../domain/ports';
import { invoicePdfRetainUntil } from '../../domain/retention';
import { createMemoryInvoiceStore } from '../../infra/invoice-buckets';
import { lockPayoutCertificates } from '../payout-certificates';

const BYTES = new TextEncoder().encode('%PDF-1.7 attestation de résidence (inventée)');
const DAY = 86_400_000;
const certificate = (n: number): PayoutCertificate => ({
  statementId: CommissionStatementIdSchema.parse(`018f3e5c-0000-7000-8000-00000000020${String(n)}`),
  documentId: `018f3e5c-0000-7000-8000-00000000030${String(n)}`,
  key: `contractor-documents/kofi/${String(n)}.png`,
  paidOn: '2026-06-02',
  fiscalYearEndMonth: 12,
});
const DUE = invoicePdfRetainUntil('2026-06-02', 12);

/** The transfers to lock, and the locks recorded; `said` answers whether this run said it first. */
function rows(certificates: readonly PayoutCertificate[], said = true) {
  const recorded: [string, Date][] = [];
  const store: PayrollPayoutCertificateStore = {
    toLockUnscoped: () => Promise.resolve(certificates),
    recordLockedUnscoped: (one, retainUntil) => {
      recorded.push([one.statementId, retainUntil]);
      return Promise.resolve(said);
    },
  };
  return { store, recorded };
}

function said() {
  const lines: { level: 'warn' | 'error'; message: string }[] = [];
  return {
    lines,
    logger: {
      warn: (_: object, message: string) => lines.push({ level: 'warn', message }),
      error: (_: object, message: string) => lines.push({ level: 'error', message }),
    },
  };
}

describe('Équipe › Paie : la pièce qui débloque un versement, gardée dix ans après lui (ADR 0041 § 6)', () => {
  it('lengthens a shorter lock in both buckets to ten years after the transfer’s fiscal year, never shortens one', async () => {
    const primary = createMemoryInvoiceStore();
    const copy = createMemoryInvoiceStore();
    const [shorter, longer] = [certificate(1), certificate(2)];
    const later = new Date(DUE.getTime() + 400 * DAY);
    primary.plant(shorter.key, { bytes: BYTES, retainUntil: new Date(DUE.getTime() - DAY) });
    copy.plant(shorter.key, { bytes: BYTES, retainUntil: new Date(DUE.getTime() - DAY) });
    primary.plant(longer.key, { bytes: BYTES, retainUntil: later });
    copy.plant(longer.key, { bytes: BYTES, retainUntil: later });
    const { store, recorded } = rows([shorter, longer]);
    const { logger } = said();
    expect(await lockPayoutCertificates({ store, primary, copy }, null, logger)).toBe(2);
    expect([primary.peek(shorter.key)?.retainUntil, copy.peek(shorter.key)?.retainUntil]).toEqual([DUE, DUE]);
    expect([primary.peek(longer.key)?.retainUntil, copy.peek(longer.key)?.retainUntil]).toEqual([
      later,
      later,
    ]);
    expect(recorded).toEqual([
      [shorter.statementId, DUE],
      [longer.statementId, DUE],
    ]);
  });

  it('fails the run for a certificate missing from a locked bucket, after the others, and records only those', async () => {
    const primary = createMemoryInvoiceStore();
    const copy = createMemoryInvoiceStore();
    const [missing, kept] = [certificate(1), certificate(2)];
    primary.plant(missing.key, { bytes: BYTES, retainUntil: DUE });
    for (const bucket of [primary, copy]) bucket.plant(kept.key, { bytes: BYTES, retainUntil: DUE });
    const { store, recorded } = rows([missing, kept]);
    const { lines, logger } = said();
    await expect(lockPayoutCertificates({ store, primary, copy }, null, logger)).rejects.toThrow(
      /1 certificate\(s\) not locked/u,
    );
    expect(recorded.map(([id]) => id)).toEqual([kept.statementId]);
    expect(lines).toEqual([
      { level: 'error', message: 'payroll.lock_payout_certificate: certificate not locked' },
    ]);
  });

  it('warns of a store in memory that forgot it (development), and counts a line another run wrote first', async () => {
    const primary = createMemoryInvoiceStore({ volatile: true });
    const copy = createMemoryInvoiceStore({ volatile: true });
    const { store, recorded } = rows([certificate(1)], false);
    const { lines, logger } = said();
    expect(await lockPayoutCertificates({ store, primary, copy }, null, logger)).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(lines.map((line) => line.level)).toEqual(['warn', 'warn']);
  });
});
