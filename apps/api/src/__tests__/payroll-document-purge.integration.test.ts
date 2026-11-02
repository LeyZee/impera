import { createHash } from 'node:crypto';

import { ContractorDocumentIdSchema, ContractorFileSchema, newId, type TeamMember } from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };

/** An invented file (ADR 0010): its first bytes say it is a PDF, nothing more. */
const pdf = (words: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n% ${words}\n%%EOF\n`);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

describe('Équipe › Pièces du prestataire : l’effacement des refusées (EQ-06 lot 5c-2, « ok purge a »)', () => {
  let team: PayrollTeam;
  let kofi: TeamMember;
  let kofiCookie: string;
  const primary = createMemoryInvoiceStore();
  const copy = createMemoryInvoiceStore();

  const db = () => team.test.admin.db;
  const purge = () => team.app.modules.contractors.jobs.purgeRefusedDocuments(quiet);

  /**
   * A document of Kofi's as the upload leaves it, its file in the first bucket under `bucketLock`, its upload lock in
   * its row; checked by the owner when `review` says so.
   */
  const file = async (
    words: string,
    options: {
      rowLock: Date;
      bucketLock?: Date | null;
      review?: 'accepted' | 'refused';
      inBucket?: boolean;
    },
  ) => {
    const id = newId(ContractorDocumentIdSchema);
    const bytes = pdf(words);
    const key = `contractor-documents/${kofi.id}/${id}.pdf`;
    await db()
      .insert(schema.contractorDocuments)
      .values({
        id,
        memberId: kofi.id,
        kind: 'urssaf_vigilance',
        issuedOn: '2026-03-02',
        validUntil: null,
        storageKey: key,
        sha256: sha256(bytes),
        retainUntil: options.rowLock,
        createdBy: kofi.userId,
      });
    if (options.inBucket !== false) {
      primary.plant(key, { bytes, retainUntil: options.bucketLock ?? options.rowLock });
    }
    if (options.review === 'refused') {
      await db().insert(schema.contractorDocumentReviews).values({
        documentId: id,
        decision: 'refused',
        reason: 'Floue (motif inventé)',
        reviewedBy: team.ownerId,
      });
    }
    if (options.review === 'accepted') {
      await db()
        .insert(schema.contractorDocumentReviews)
        .values({
          documentId: id,
          decision: 'accepted',
          reviewedBy: team.ownerId,
          retainUntil: new Date(Date.now() + 11 * 365 * DAY),
        });
    }
    return { id, key };
  };
  const purged = async () =>
    (await db().select().from(schema.contractorDocumentPurges)).map((row) => row.documentId).sort();
  const fileOf = async () =>
    ContractorFileSchema.parse(
      (await team.call('GET', `/payroll/contractors/${kofi.id}/file`, team.owner)).json(),
    );

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { invoiceBuckets: { primary, copy } });
    ({ member: kofi, cookie: kofiCookie } = await team.addMember('kofi@example.test', 'Kofi'));
  });

  afterAll(() => team.close());

  it('erases a refused file once its lock has ended, keeps its row, and says so on its download', async () => {
    const past = new Date(Date.now() - DAY);
    const refused = await file('refusée, verrou passé', { rowLock: past, review: 'refused' });
    const forgotten = await file('refusée, déjà absente', {
      rowLock: past,
      review: 'refused',
      inBucket: false,
    });
    // Never erased: accepted, waiting for its check, still locked in its row, or locked longer in the bucket.
    const accepted = await file('acceptée', { rowLock: past, review: 'accepted' });
    const waiting = await file('en attente', { rowLock: past });
    const young = await file('refusée hier', { rowLock: new Date(Date.now() + 29 * DAY), review: 'refused' });
    const held = await file('verrou plus long au seau', {
      rowLock: past,
      bucketLock: new Date(Date.now() + DAY),
      review: 'refused',
    });

    expect(await purge()).toEqual({ purged: 2, skipped: 1 });
    expect(primary.peek(refused.key)).toBeUndefined();
    for (const kept of [accepted, waiting, young, held]) expect(primary.peek(kept.key)).toBeDefined();
    expect(await purged()).toEqual([refused.id, forgotten.id].sort());
    expect(await team.audited('contractor_document.purge')).toBe(2);

    // The row, its reason and its fingerprint stay; the file says when its bytes went.
    const documents = (await fileOf()).documents;
    const shown = documents.find((one) => one.id === refused.id);
    expect(shown).toMatchObject({ review: { decision: 'refused', reason: 'Floue (motif inventé)' } });
    expect(shown?.purgedAt).not.toBeNull();
    expect(documents.find((one) => one.id === accepted.id)?.purgedAt).toBeNull();
    const gone = await team.call(
      'GET',
      `/payroll/contractors/${kofi.id}/documents/${refused.id}/file`,
      kofiCookie,
    );
    expect(gone.statusCode).toBe(410);
    expect(team.refusal(gone).code).toBe('contractor_document_file_gone');

    // The next night finds nothing more to erase but what the bucket still locks.
    expect(await purge()).toEqual({ purged: 0, skipped: 1 });
    expect(await team.audited('contractor_document.purge')).toBe(2);
  });

  it('never erases a refused file found in the second bucket: the run fails, both files stay', async () => {
    const past = new Date(Date.now() - DAY);
    const strayed = await file('refusée mais copiée', { rowLock: past, review: 'refused' });
    copy.plant(strayed.key, { bytes: pdf('refusée mais copiée'), retainUntil: past });
    await expect(purge()).rejects.toThrow(/found in the second bucket/u);
    expect(primary.peek(strayed.key)).toBeDefined();
    expect(copy.peek(strayed.key)).toBeDefined();
    expect(await purged()).not.toContain(strayed.id);
  });

  it('refuses in the base an erasure of a file not refused or still locked, and never changes one', async () => {
    const past = new Date(Date.now() - DAY);
    const accepted = await file('acceptée, base', { rowLock: past, review: 'accepted' });
    const young = await file('refusée, base', { rowLock: new Date(Date.now() + DAY), review: 'refused' });
    expect(
      await failure(db().insert(schema.contractorDocumentPurges).values({ documentId: accepted.id })),
    ).toMatch(/only the file of a refused document/u);
    expect(
      await failure(db().insert(schema.contractorDocumentPurges).values({ documentId: young.id })),
    ).toMatch(/upload lock has ended/u);
    const [first] = await purged();
    if (first === undefined) throw new Error('no erasure recorded');
    expect(
      await failure(
        db().execute(
          sql`update contractor_document_purges set purged_at = now() where document_id = ${first}`,
        ),
      ),
    ).not.toBe('no error');
    expect(
      await failure(
        db()
          .delete(schema.contractorDocumentPurges)
          .where(eq(schema.contractorDocumentPurges.documentId, first)),
      ),
    ).not.toBe('no error');
  });
});
