import { createHash } from 'node:crypto';

import { ContractorDocumentIdSchema, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { InvoiceStorageRefused } from '../../domain/errors';
import type { InvoiceObjectStore, PayrollDocumentPurgeStore } from '../../domain/ports';
import { createMemoryInvoiceStore } from '../../infra/invoice-buckets';
import { purgeRefusedDocuments } from '../contractor-documents';

type Due = Parameters<PayrollDocumentPurgeStore['recordUnscoped']>[0];

const BYTES = new TextEncoder().encode('%PDF-1.7 pièce refusée (inventée)');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const PAST = new Date('2026-01-01T00:00:00Z');
const member = TeamMemberIdSchema.parse('018f3e5c-0000-7000-8000-000000000001');
const due = (n: number): Due => ({
  documentId: ContractorDocumentIdSchema.parse(`018f3e5c-0000-7000-8000-00000000010${String(n)}`),
  memberId: member,
  key: `contractor-documents/${member}/${String(n)}.pdf`,
  sha256: SHA,
});

/** The rows due, and the erasures recorded. */
function rows(files: readonly Due[]) {
  const recorded: string[] = [];
  const store: PayrollDocumentPurgeStore = {
    dueUnscoped: () => Promise.resolve(files),
    recordUnscoped: (file) => {
      recorded.push(file.documentId);
      return Promise.resolve(true);
    },
  };
  return { store, recorded };
}

/** What the job said, by level. */
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

describe('Équipe › Pièces du prestataire : l’effacement des refusées (EQ-06 lot 5c-2)', () => {
  it('says a refused delete as an error and fails the run, after erasing what it could (Bilan on #359)', async () => {
    const [denied, erased] = [due(1), due(2)];
    const memory = createMemoryInvoiceStore();
    memory.plant(erased.key, { bytes: BYTES, retainUntil: PAST });
    memory.plant(denied.key, { bytes: BYTES, retainUntil: PAST });
    // The first bucket refuses one erasure with no lock that holds: a right the key lacks.
    const primary: InvoiceObjectStore = {
      ...memory,
      remove: (key, sha256) =>
        key === denied.key
          ? Promise.reject(new InvoiceStorageRefused(`DELETE ${key}?versionId answered 403 (AccessDenied)`))
          : memory.remove(key, sha256),
    };
    const { store, recorded } = rows([denied, erased]);
    const { lines, logger } = said();
    await expect(
      purgeRefusedDocuments({ store, primary, copy: createMemoryInvoiceStore() }, logger),
    ).rejects.toThrow(/1 erasure\(s\) refused by the first bucket with no lock that holds/u);
    expect(recorded).toEqual([erased.documentId]);
    expect(memory.peek(denied.key)).toBeDefined();
    expect(lines).toEqual([
      {
        level: 'error',
        message: 'contractor document purge: the bucket refused to erase a version whose lock has ended',
      },
    ]);
  });

  it('keeps a lock that holds a warning, tried again the next night, and the run passes', async () => {
    const held = due(3);
    const primary = createMemoryInvoiceStore();
    primary.plant(held.key, { bytes: BYTES, retainUntil: new Date(Date.now() + 86_400_000) });
    const { store, recorded } = rows([held]);
    const { lines, logger } = said();
    expect(await purgeRefusedDocuments({ store, primary, copy: createMemoryInvoiceStore() }, logger)).toEqual(
      {
        purged: 0,
        skipped: 1,
      },
    );
    expect(recorded).toEqual([]);
    expect(lines.map((line) => line.level)).toEqual(['warn']);
  });
});
