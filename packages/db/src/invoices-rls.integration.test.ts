import { createHash } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractAcceptanceIdSchema,
  ContractorDocumentIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  newId,
  nextPayPeriod,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember } from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

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

/** The migration's triggers (0041): every refusal names EQ-06 or ADR 0036. */
const KEPT = /\((EQ-06|ADR 0036)\)/u;
const RLS = /row-level security/u;
const DENIED = /permission denied/u;
const HASH = 'a'.repeat(64);
const DAY = 86_400_000;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));

/** Invented parties only (ADR 0010): no real name, address nor identifier. */
const AGENCY = {
  legalName: 'Agence Exemple SAS',
  address: '1 place Fictive, 69000 Lyon',
  siren: '123456789',
  vatNumber: 'FR12123456789',
};
const CONTRACTOR = {
  legalName: 'Kofi Exemple',
  address: '12 rue Inventée, Cotonou',
  country: 'BJ',
  taxId: null,
};

describe('contractors’ invoices (EQ-06): who reads and writes, and an issued invoice that never changes', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const kofi = newId(UserIdSchema);
  const ama = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const prefixOf = new Map<string, string>([
    [kofi, 'KOFI'],
    [ama, 'AMA'],
  ]);
  const regime = (name: string, countries: string[]) => ({
    id: newId(BillingRegimeIdSchema),
    name,
    countries,
    vatTreatment: 'reverse_charge',
    vatRateBps: 2_000,
    withholding: 'treaty_exempt',
    mentions: ['Autoliquidation'],
    documents: ['tax_residence'],
    taxIdRequired: false,
    createdBy: owner,
  });
  /** Validated by the accountant on October 30th. */
  const benin = regime('Bénin et Madagascar', ['BJ', 'MG']);
  /** Never validated. */
  const unvalidated = regime('Autre pays', ['CI']);
  /** Validated tomorrow: after today's issue. */
  const later = regime('Pays validé demain', ['TG']);
  /** Validated on October 30th, Kofi's from tomorrow only. */
  const france = regime('France', ['FR']);
  const regimeCopy = (one: ReturnType<typeof regime>, validatedOn: string | null) => ({
    id: one.id,
    name: one.name,
    vat: { treatment: one.vatTreatment, rateBps: one.vatRateBps },
    withholding: one.withholding,
    mentions: one.mentions,
    documents: one.documents,
    taxIdRequired: one.taxIdRequired,
    validatedOn,
  });

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };
  const prefix = (userId: string): string => {
    const value = prefixOf.get(userId);
    if (value === undefined) throw new Error('no prefix');
    return value;
  };

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[1]): Promise<T> => withAdmin(test.admin.db, fn);
  const as = <T>(userId: string, fn: Parameters<typeof withMember<T>>[2]): Promise<T> =>
    withMember(test.app.db, userId, fn);

  const periods = ['2026-08-01', '2026-08-16', '2026-09-01', '2026-09-16', '2026-10-01'];

  /** A draft statement of `userId` for `period`, as the job writes it. */
  const draft = async (userId: string, period: string): Promise<string> => {
    const id = newId(CommissionStatementIdSchema);
    await admin((tx) =>
      tx.insert(s.commissionStatements).values({
        id,
        memberId: member(userId),
        period,
        status: 'draft',
        revision: 1,
        engineVersion: 'nirvana-1',
        inputsHash: HASH,
        netMinor: 60_000,
        commissionMinor: 12_000,
        collectiveBonusMinor: 0,
        bonusesMinor: 0,
        penaltiesRequestedMinor: 0,
        penaltiesMinor: 0,
        carryOversInMinor: 0,
        adjustmentsMinor: 0,
        totalMinor: 12_000,
        carryOverOutMinor: 0,
        payableMinor: 12_000,
        teamNetMinor: 60_000,
        rules: { exchangeRates: [] },
        counted: {},
        computedAt: new Date(),
      }),
    );
    return id;
  };

  /** Closes the team's periods up to `period`, one by one (`payroll-closing.integration.test.ts` tests it). */
  const closeUpTo = (period: string) =>
    admin(async (tx) => {
      const [last] = await tx
        .select({ period: s.payPeriodClosings.period })
        .from(s.payPeriodClosings)
        .orderBy(desc(s.payPeriodClosings.period))
        .limit(1);
      let next = last === undefined ? period : nextPayPeriod(PayPeriodSchema.parse(last.period));
      for (; next <= period; next = nextPayPeriod(PayPeriodSchema.parse(next))) {
        await tx
          .insert(s.payPeriodClosings)
          .values({ period: next, teamNetMinor: 60_000, exchangeRates: [], closedBy: owner });
      }
    });

  /** A statement of `userId` for `period`, validated by the owner. */
  const validated = async (userId: string, period: string): Promise<string> => {
    const id = await draft(userId, period);
    await closeUpTo(period);
    await as(owner, (tx) =>
      tx
        .update(s.commissionStatements)
        .set({ status: 'validated', validatedAt: new Date(), validatedBy: owner })
        .where(eq(s.commissionStatements.id, id)),
    );
    return id;
  };

  interface Issue {
    /** The owner, through the application; `null` for the job (`nirvana_admin`). */
    readonly by: string | null;
    readonly userId: string;
    readonly statementId: string | null;
    readonly period: string;
    /** Excluding VAT: positive for an invoice, negative for a credit note. */
    readonly amountMinor: number;
    readonly creditedInvoiceId?: string;
    /** The lines' amounts; one line of the whole amount by default. */
    readonly lines?: readonly number[];
    /** Takes the number after the counter's: a hole. */
    readonly skip?: boolean;
    /** Leaves out the event `issued`. */
    readonly withoutIssued?: boolean;
    readonly invoice?: Partial<typeof s.invoices.$inferInsert>;
  }

  /**
   * Issues an invoice or a credit note as lot 3 will, in one transaction: the counter locked `FOR UPDATE` and moved
   * by one, the invoice with its number, its lines, its event `issued`.
   */
  const issue = (o: Issue): Promise<{ id: string; number: string }> => {
    const write = async (tx: Parameters<Parameters<typeof withAdmin>[1]>[0]) => {
      const memberId = member(o.userId);
      const where = and(eq(s.invoiceCounters.memberId, memberId), eq(s.invoiceCounters.year, year));
      const [counter] = await tx.select().from(s.invoiceCounters).where(where).for('update');
      const next = (counter?.lastSequence ?? 0) + 1;
      if (counter === undefined) {
        await tx.insert(s.invoiceCounters).values({ memberId, year, lastSequence: next });
      } else {
        await tx.update(s.invoiceCounters).set({ lastSequence: next }).where(where);
      }
      const sequence = o.skip === true ? next + 1 : next;
      const own = o.invoice?.prefix ?? prefix(o.userId);
      const number = `${own}-${String(year)}-${String(sequence).padStart(4, '0')}`;
      const id = newId(InvoiceIdSchema);
      await tx.insert(s.invoices).values({
        id,
        kind: o.creditedInvoiceId === undefined ? 'invoice' : 'credit_note',
        memberId,
        statementId: o.statementId,
        creditedInvoiceId: o.creditedInvoiceId ?? null,
        period: o.period,
        prefix: own,
        year,
        sequence,
        number,
        idempotencyKey: `test:${id}`,
        issuedOn: today,
        issuedBy: o.by,
        dueOn: today,
        contractor: CONTRACTOR,
        agency: AGENCY,
        regimeId: benin.id,
        regime: regimeCopy(benin, '2026-10-30'),
        mentions: ['Autofacturation', 'Autoliquidation'],
        exclVatMinor: o.amountMinor,
        vatMinor: 0,
        inclVatMinor: o.amountMinor,
        selfAssessedVatMinor: Math.trunc(o.amountMinor / 5),
        acceptanceDeadline: new Date(Date.now() + 7 * DAY),
        ...o.invoice,
      });
      const amounts = o.lines ?? [o.amountMinor];
      if (amounts.length > 0) {
        await tx.insert(s.invoiceLines).values(
          amounts.map((amountMinor, index) => ({
            invoiceId: id,
            position: index + 1,
            kind: amountMinor < 0 ? 'reduction' : 'commission',
            label: amountMinor < 0 ? 'Réduction' : 'Commission',
            detail: null,
            amountMinor,
          })),
        );
      }
      if (o.withoutIssued !== true) {
        await tx
          .insert(s.invoiceEvents)
          .values({ id: newId(InvoiceEventIdSchema), invoiceId: id, kind: 'issued', by: o.by });
      }
      return { id, number };
    };
    return o.by === null ? admin(write) : as(o.by, write);
  };

  /** An event of invoice `invoiceId`, by `by` in the application, or by the job when `by` is `null`. */
  const event = (
    by: string | null,
    invoiceId: string,
    kind: string,
    values: Partial<typeof s.invoiceEvents.$inferInsert> = {},
  ) => {
    const row = { id: newId(InvoiceEventIdSchema), invoiceId, kind, by, ...values };
    return by === null
      ? admin((tx) => tx.insert(s.invoiceEvents).values(row))
      : as(by, (tx) => tx.insert(s.invoiceEvents).values(row));
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await admin(async (tx) => {
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [kofi, 'operator', 'chatter'],
        [ama, 'operator', 'chatter'],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx
          .insert(s.user)
          .values({ id: userId, name: `Compte ${role}`, email: `${userId}@example.test`, role });
        if (teamRole === null) continue;
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-07-01',
        });
      }
      for (const period of periods) {
        const startsAt = new Date(`${period}T00:00:00+02:00`);
        await tx.insert(s.payPeriods).values({
          period,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 15 * DAY),
          timeZone: 'Europe/Paris',
        });
      }
      await tx.insert(s.billingRegimes).values([benin, unvalidated, later, france]);
      await tx.insert(s.billingRegimeValidations).values([
        { regimeId: benin.id, validatedOn: '2026-10-30', recordedBy: owner },
        { regimeId: france.id, validatedOn: '2026-10-30', recordedBy: owner },
        { regimeId: later.id, validatedOn: tomorrow, recordedBy: owner },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  describe('settings and regimes', () => {
    it('the owner writes the settings, a single row; the agency reads them, a chatter does not', async () => {
      const settings = {
        id: 1,
        agency: AGENCY,
        paymentTerms:
          'Aucun escompte. Pénalités de retard au triple du taux d’intérêt légal, indemnité de 40 €.',
        dueDays: 60,
        documentReminderDays: 30,
        accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
        updatedBy: owner,
      };
      expect(
        await failure(
          as(manager, (tx) => tx.insert(s.billingSettings).values({ ...settings, updatedBy: manager })),
        ),
      ).toMatch(RLS);
      // The payment terms are the agency's words: an invoice never goes out without them.
      expect(
        await failure(
          as(owner, (tx) => tx.insert(s.billingSettings).values({ ...settings, paymentTerms: '' })),
        ),
      ).toMatch(/billing_settings_payment_terms_check/u);
      await as(owner, (tx) => tx.insert(s.billingSettings).values(settings));
      expect(
        await failure(as(owner, (tx) => tx.insert(s.billingSettings).values({ ...settings, id: 2 }))),
      ).toMatch(/billing_settings_single_check/u);
      expect(
        await as(manager, (tx) =>
          tx
            .update(s.billingSettings)
            .set({ dueDays: 45, updatedBy: manager })
            .returning({ id: s.billingSettings.id }),
        ),
      ).toEqual([]);
      expect(await as(manager, (tx) => tx.select().from(s.billingSettings))).toHaveLength(1);
      expect(await as(kofi, (tx) => tx.select().from(s.billingSettings))).toHaveLength(0);
      await as(owner, (tx) => tx.update(s.billingSettings).set({ dueDays: 45, updatedBy: owner }));
      // The owner changes the payment terms of an existing row, as every other setting (an UPDATE granted by column).
      const later =
        'Aucun escompte. Pénalités de retard au taux de la BCE majoré de 10 points, indemnité de 40 €.';
      expect(
        await as(owner, (tx) =>
          tx
            .update(s.billingSettings)
            .set({ paymentTerms: later, updatedBy: owner })
            .returning({ paymentTerms: s.billingSettings.paymentTerms }),
        ),
      ).toEqual([{ paymentTerms: later }]);
      expect(await failure(admin((tx) => tx.delete(s.billingSettings)))).toMatch(KEPT);
    });

    it('a regime is the owner’s, read by every member, added only; its validation is a row, recorded once', async () => {
      const franchise = {
        ...regime('France, franchise', ['FR']),
        vatTreatment: 'exempt',
        vatRateBps: null,
        withholding: 'none',
        mentions: ['TVA non applicable, art. 293 B du CGI'],
        documents: ['urssaf_vigilance'],
        taxIdRequired: true,
      };
      expect(
        await failure(
          as(manager, (tx) => tx.insert(s.billingRegimes).values({ ...franchise, createdBy: manager })),
        ),
      ).toMatch(RLS);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.billingRegimes).values({ ...franchise, vatRateBps: 0 }))),
      ).toMatch(/billing_regimes_vat_check/u);
      await as(owner, (tx) => tx.insert(s.billingRegimes).values(franchise));
      // The application changes nothing of a regime: it has no UPDATE on it.
      expect(
        await failure(
          as(owner, (tx) =>
            tx.update(s.billingRegimes).set({ name: 'Autre' }).where(eq(s.billingRegimes.id, franchise.id)),
          ),
        ),
      ).toMatch(DENIED);
      expect(await failure(admin((tx) => tx.update(s.billingRegimes).set({ mentions: [] })))).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.delete(s.billingRegimes)))).toMatch(KEPT);
      const validate = (by: string) =>
        as(by, (tx) =>
          tx
            .insert(s.billingRegimeValidations)
            .values({ regimeId: franchise.id, validatedOn: '2026-10-31', recordedBy: by }),
        );
      expect(await failure(validate(manager))).toMatch(RLS);
      await validate(owner);
      expect(await failure(validate(owner))).toMatch(/billing_regime_validations_pkey/u);
      expect(
        await failure(
          admin((tx) => tx.update(s.billingRegimeValidations).set({ validatedOn: '2026-11-02' })),
        ),
      ).toMatch(KEPT);
      expect(await as(kofi, (tx) => tx.select().from(s.billingRegimes))).toHaveLength(5);
      expect(await as(kofi, (tx) => tx.select().from(s.billingRegimeValidations))).toHaveLength(4);
    });
  });

  describe('a contractor’s regime, file, documents and contracts', () => {
    it('the owner assigns a regime from a day after the last, never backwards; a member reads his own', async () => {
      const assign = (by: string, effectiveFrom: string, regimeId = benin.id) =>
        as(by, (tx) =>
          tx.insert(s.contractorRegimes).values({
            id: newId(ContractorRegimeIdSchema),
            memberId: member(kofi),
            regimeId,
            effectiveFrom,
            createdBy: by,
          }),
        );
      expect(await failure(assign(manager, '2026-08-01', unvalidated.id))).toMatch(RLS);
      await assign(owner, '2026-08-01', unvalidated.id);
      await assign(owner, '2026-09-01');
      expect(await failure(assign(owner, '2026-09-01'))).toMatch(KEPT);
      expect(await failure(assign(owner, '2026-08-15'))).toMatch(KEPT);
      // Assigned ahead: today's invoices keep today's regime.
      await assign(owner, tomorrow, france.id);
      expect(await as(kofi, (tx) => tx.select().from(s.contractorRegimes))).toHaveLength(3);
      expect(await as(ama, (tx) => tx.select().from(s.contractorRegimes))).toHaveLength(0);
      expect(await as(manager, (tx) => tx.select().from(s.contractorRegimes))).toHaveLength(3);
      expect(
        await failure(admin((tx) => tx.update(s.contractorRegimes).set({ effectiveFrom: '2026-07-01' }))),
      ).toMatch(KEPT);
    });

    it('a contractor writes his file; the owner alone checks it and sets the prefix; a new identity clears the check', async () => {
      const file = {
        memberId: member(kofi),
        legalName: 'Kofi Exemple',
        address: '12 rue Inventée, Cotonou',
        taxId: null,
        email: 'kofi@example.test',
        updatedBy: kofi,
      };
      // Checked after it is written, by the owner: the trigger refuses it before the policy does.
      expect(
        await failure(
          as(kofi, (tx) =>
            tx.insert(s.contractorProfiles).values({ ...file, verifiedAt: new Date(), verifiedBy: kofi }),
          ),
        ),
      ).toMatch(KEPT);
      expect(
        await failure(as(ama, (tx) => tx.insert(s.contractorProfiles).values({ ...file, updatedBy: ama }))),
      ).toMatch(RLS);
      expect(
        await failure(
          as(kofi, (tx) => tx.insert(s.contractorProfiles).values({ ...file, invoicePrefix: 'KOFI' })),
        ),
      ).toMatch(KEPT);
      await as(kofi, (tx) => tx.insert(s.contractorProfiles).values(file));
      const update = (by: string, values: Partial<typeof s.contractorProfiles.$inferInsert>) =>
        as(by, (tx) =>
          tx
            .update(s.contractorProfiles)
            .set({ updatedBy: by, ...values })
            .where(eq(s.contractorProfiles.memberId, member(kofi)))
            .returning({ verifiedAt: s.contractorProfiles.verifiedAt }),
        );
      expect(await failure(update(kofi, { invoicePrefix: 'KOFI' }))).toMatch(KEPT);
      expect(await failure(update(kofi, { verifiedAt: new Date(), verifiedBy: kofi }))).toMatch(KEPT);
      expect(await update(manager, { address: '1 rue Autre, Cotonou' })).toEqual([]);
      expect(await failure(update(owner, { verifiedAt: new Date(), verifiedBy: kofi }))).toMatch(KEPT);
      expect(await failure(update(owner, { invoicePrefix: 'kofi' }))).toMatch(
        /contractor_profiles_prefix_check/u,
      );
      const [checked] = await update(owner, {
        invoicePrefix: 'KOFI',
        verifiedAt: new Date(),
        verifiedBy: owner,
      });
      expect(checked?.verifiedAt).not.toBeNull();
      // He moves: the owner checks the new address again.
      const [moved] = await update(kofi, { address: '14 rue Inventée, Cotonou' });
      expect(moved?.verifiedAt).toBeNull();
      await update(owner, { verifiedAt: new Date(), verifiedBy: owner });
      expect(await failure(update(kofi, { verifiedAt: null, verifiedBy: null }))).toMatch(KEPT);
      // The owner opens Ama's file with her prefix.
      await as(owner, (tx) =>
        tx.insert(s.contractorProfiles).values({
          ...file,
          memberId: member(ama),
          legalName: 'Ama Exemple',
          email: 'ama@example.test',
          invoicePrefix: 'AMA',
          updatedBy: owner,
        }),
      );
      expect(await as(ama, (tx) => tx.select().from(s.contractorProfiles))).toHaveLength(1);
      expect(await as(manager, (tx) => tx.select().from(s.contractorProfiles))).toHaveLength(2);
      expect(await failure(admin((tx) => tx.delete(s.contractorProfiles)))).toMatch(KEPT);
    });

    it('documents are added only, read by their contractor and the agency', async () => {
      const document = (by: string, values: Partial<typeof s.contractorDocuments.$inferInsert> = {}) => ({
        id: newId(ContractorDocumentIdSchema),
        memberId: member(kofi),
        kind: 'tax_residence',
        issuedOn: '2026-09-15',
        validUntil: null,
        storageKey: `contractors/${member(kofi)}/tax-residence-2026.pdf`,
        sha256: HASH,
        createdBy: by,
        ...values,
      });
      expect(await failure(as(ama, (tx) => tx.insert(s.contractorDocuments).values(document(ama))))).toMatch(
        RLS,
      );
      expect(
        await failure(
          as(kofi, (tx) =>
            tx.insert(s.contractorDocuments).values(document(kofi, { validUntil: '2026-09-15' })),
          ),
        ),
      ).toMatch(/contractor_documents_dates_check/u);
      await as(kofi, (tx) => tx.insert(s.contractorDocuments).values(document(kofi)));
      await as(owner, (tx) =>
        tx
          .insert(s.contractorDocuments)
          .values(document(owner, { issuedOn: '2026-10-15', validUntil: '2027-10-14' })),
      );
      expect(await as(kofi, (tx) => tx.select().from(s.contractorDocuments))).toHaveLength(2);
      expect(await as(ama, (tx) => tx.select().from(s.contractorDocuments))).toHaveLength(0);
      expect(
        await failure(admin((tx) => tx.update(s.contractorDocuments).set({ sha256: 'b'.repeat(64) }))),
      ).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.delete(s.contractorDocuments)))).toMatch(KEPT);
    });

    it('a contract text is the next version and carries its SHA-256; the contractor accepts it himself, with it', async () => {
      const body = 'Mandat de facturation (texte inventé pour le test). Délai de contestation : sept jours.';
      const text = (values: Partial<typeof s.contractTexts.$inferInsert> = {}) => ({
        id: newId(ContractTextIdSchema),
        kind: 'billing_mandate',
        version: 1,
        body,
        sha256: sha256(body),
        contestDelayDays: 7,
        createdBy: owner,
        ...values,
      });
      expect(
        await failure(as(manager, (tx) => tx.insert(s.contractTexts).values(text({ createdBy: manager })))),
      ).toMatch(RLS);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.contractTexts).values(text({ sha256: HASH })))),
      ).toMatch(KEPT);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.contractTexts).values(text({ version: 2 })))),
      ).toMatch(KEPT);
      expect(
        await failure(
          as(owner, (tx) => tx.insert(s.contractTexts).values(text({ kind: 'service_contract' }))),
        ),
      ).toMatch(/contract_texts_delay_check/u);
      const mandate = text();
      await as(owner, (tx) => tx.insert(s.contractTexts).values(mandate));
      const accept = (by: string, values: Partial<typeof s.contractAcceptances.$inferInsert> = {}) =>
        as(by, (tx) =>
          tx.insert(s.contractAcceptances).values({
            id: newId(ContractAcceptanceIdSchema),
            memberId: member(kofi),
            textId: mandate.id,
            textSha256: mandate.sha256,
            acceptedBy: by,
            ...values,
          }),
        );
      expect(await failure(accept(owner))).toMatch(RLS);
      expect(await failure(accept(ama))).toMatch(RLS);
      expect(await failure(accept(kofi, { textSha256: HASH }))).toMatch(KEPT);
      await accept(kofi);
      expect(await failure(accept(kofi))).toMatch(/contract_acceptances_member_text_unique/u);
      expect(await as(ama, (tx) => tx.select().from(s.contractAcceptances))).toHaveLength(0);
      expect(await as(ama, (tx) => tx.select().from(s.contractTexts))).toHaveLength(1);
      expect(await failure(admin((tx) => tx.update(s.contractTexts).set({ body: 'Autre' })))).toMatch(KEPT);
    });
  });

  describe('invoices and credit notes', () => {
    const statements = new Map<string, string>();
    const statement = (userId: string, period: string): string => {
      const id = statements.get(`${userId}:${period}`);
      if (id === undefined) throw new Error('no statement');
      return id;
    };
    const invoices = new Map<string, { id: string; number: string }>();
    const invoice = (name: string): string => {
      const one = invoices.get(name);
      if (one === undefined) throw new Error('no invoice');
      return one.id;
    };

    beforeAll(async () => {
      for (const period of ['2026-08-01', '2026-08-16', '2026-09-01']) {
        statements.set(`${kofi}:${period}`, await validated(kofi, period));
      }
      statements.set(`${kofi}:2026-09-16`, await draft(kofi, '2026-09-16'));
      statements.set(`${ama}:2026-08-01`, await validated(ama, '2026-08-01'));
      await as(owner, (tx) =>
        tx.insert(s.contractorRegimes).values({
          id: newId(ContractorRegimeIdSchema),
          memberId: member(ama),
          regimeId: benin.id,
          effectiveFrom: '2026-07-01',
          createdBy: owner,
        }),
      );
    });

    it('no invoice before the contractor accepts a billing mandate; a service contract is not one', async () => {
      const mandateFirst = /accepted a billing mandate/u;
      const amas = () =>
        failure(
          issue({
            by: owner,
            userId: ama,
            statementId: statement(ama, '2026-08-01'),
            period: '2026-08-01',
            amountMinor: 12_000,
          }),
        );
      const accept = (text: { id: string; sha256: string }) =>
        as(ama, (tx) =>
          tx.insert(s.contractAcceptances).values({
            id: newId(ContractAcceptanceIdSchema),
            memberId: member(ama),
            textId: text.id,
            textSha256: text.sha256,
            acceptedBy: ama,
          }),
        );
      expect(await amas()).toMatch(mandateFirst);
      const body = 'Contrat de prestation (texte inventé pour le test).';
      const contract = {
        id: newId(ContractTextIdSchema),
        kind: 'service_contract',
        version: 1,
        body,
        sha256: sha256(body),
        contestDelayDays: null,
        createdBy: owner,
      };
      await as(owner, (tx) => tx.insert(s.contractTexts).values(contract));
      await accept(contract);
      expect(await amas()).toMatch(mandateFirst);
      // Any version of the mandate will do for the base: an older one is the application's warning.
      const [mandate] = await admin((tx) =>
        tx
          .select({ id: s.contractTexts.id, sha256: s.contractTexts.sha256 })
          .from(s.contractTexts)
          .where(eq(s.contractTexts.kind, 'billing_mandate')),
      );
      if (mandate === undefined) throw new Error('no mandate');
      await accept(mandate);
    });

    it('the owner or the job issues for a validated statement, in the contractor’s sequence without hole; he reads his own', async () => {
      const first = await issue({
        by: owner,
        userId: kofi,
        statementId: statement(kofi, '2026-08-01'),
        period: '2026-08-01',
        amountMinor: 12_000,
      });
      expect(first.number).toBe(`KOFI-${String(year)}-0001`);
      invoices.set('kofi-aug1', first);
      const second = await issue({
        by: null,
        userId: kofi,
        statementId: statement(kofi, '2026-08-16'),
        period: '2026-08-16',
        amountMinor: 12_000,
        lines: [13_000, -1_000],
      });
      expect(second.number).toBe(`KOFI-${String(year)}-0002`);
      invoices.set('kofi-aug16', second);
      const amas = await issue({
        by: owner,
        userId: ama,
        statementId: statement(ama, '2026-08-01'),
        period: '2026-08-01',
        amountMinor: 12_000,
        invoice: { contractor: { ...CONTRACTOR, legalName: 'Ama Exemple' } },
      });
      expect(amas.number).toBe(`AMA-${String(year)}-0001`);
      invoices.set('ama-aug1', amas);

      const read = (by: string) => as(by, (tx) => tx.select({ id: s.invoices.id }).from(s.invoices));
      expect(await read(kofi)).toHaveLength(2);
      expect(await read(ama)).toEqual([{ id: amas.id }]);
      expect(await read(manager)).toHaveLength(3);
      expect(await as(kofi, (tx) => tx.select().from(s.invoiceLines))).toHaveLength(3);
      expect(await as(ama, (tx) => tx.select().from(s.invoiceLines))).toHaveLength(1);
      expect(await as(ama, (tx) => tx.select().from(s.invoiceEvents))).toHaveLength(1);
      // The counters are the agency's: a contractor reads his number on his invoices.
      expect(await as(kofi, (tx) => tx.select().from(s.invoiceCounters))).toHaveLength(0);
    });

    it('refuses what the counter, the statement, the regime or the issuer does not allow', async () => {
      const sep1 = {
        by: owner,
        userId: kofi,
        statementId: statement(kofi, '2026-09-01'),
        period: '2026-09-01',
      };
      const refused = (values: Partial<Issue>) => failure(issue({ ...sep1, amountMinor: 12_000, ...values }));
      // A hole in the sequence.
      expect(await refused({ skip: true })).toMatch(KEPT);
      // A draft, a statement of another period, another contractor's.
      expect(await refused({ statementId: statement(kofi, '2026-09-16'), period: '2026-09-16' })).toMatch(
        KEPT,
      );
      expect(await refused({ period: '2026-09-16' })).toMatch(KEPT);
      expect(await refused({ statementId: statement(ama, '2026-08-01'), period: '2026-08-01' })).toMatch(
        KEPT,
      );
      // A regime the accountant has not validated, or validated after the day of issue.
      expect(
        await refused({ invoice: { regimeId: unvalidated.id, regime: regimeCopy(unvalidated, null) } }),
      ).toMatch(KEPT);
      expect(await refused({ invoice: { regimeId: later.id, regime: regimeCopy(later, tomorrow) } })).toMatch(
        KEPT,
      );
      // A validated regime that is not the contractor's on the day of issue: France is his from tomorrow.
      expect(
        await refused({ invoice: { regimeId: france.id, regime: regimeCopy(france, '2026-10-30') } }),
      ).toMatch(/regime of its day of issue/u);
      // Another contractor's prefix.
      expect(await refused({ invoice: { prefix: 'AMA' } })).toMatch(KEPT);
      // Never two invoices for one statement.
      expect(await refused({ statementId: statement(kofi, '2026-08-01'), period: '2026-08-01' })).toMatch(
        /invoices_statement_unique/u,
      );
      // The owner or the job: a manager issues none, a chatter none, the owner never his own.
      expect(await refused({ by: manager })).toMatch(RLS);
      expect(await refused({ by: ama })).toMatch(RLS);
      // Nothing was taken: the next number is still the third.
      expect(
        await admin((tx) =>
          tx
            .select({ last: s.invoiceCounters.lastSequence })
            .from(s.invoiceCounters)
            .where(eq(s.invoiceCounters.memberId, member(kofi))),
        ),
      ).toEqual([{ last: 2 }]);
    });

    it('at its commit, an invoice has lines that add up to its total and its event issued; no line comes after', async () => {
      const sep1 = {
        by: owner,
        userId: kofi,
        statementId: statement(kofi, '2026-09-01'),
        period: '2026-09-01',
      };
      expect(await failure(issue({ ...sep1, amountMinor: 12_000, lines: [10_000, 1_000] }))).toMatch(KEPT);
      expect(await failure(issue({ ...sep1, amountMinor: 12_000, lines: [] }))).toMatch(KEPT);
      expect(await failure(issue({ ...sep1, amountMinor: 12_000, withoutIssued: true }))).toMatch(
        /with its event issued/u,
      );
      expect(
        await failure(
          as(owner, (tx) =>
            tx.insert(s.invoiceLines).values({
              invoiceId: invoice('kofi-aug1'),
              position: 2,
              kind: 'bonus',
              label: 'Prime',
              detail: null,
              amountMinor: 500,
            }),
          ),
        ),
      ).toMatch(KEPT);
      expect(await failure(event(owner, invoice('kofi-aug1'), 'issued'))).toMatch(
        /invoice_events_issued_unique|\(EQ-06\)/u,
      );
    });

    it('an issued invoice never changes, for any role; its PDF is the job’s, written once', async () => {
      const id = invoice('kofi-aug1');
      expect(
        await failure(
          as(owner, (tx) => tx.update(s.invoices).set({ dueOn: today }).where(eq(s.invoices.id, id))),
        ),
      ).toMatch(DENIED);
      expect(
        await failure(
          admin((tx) =>
            tx.update(s.invoices).set({ exclVatMinor: 1, inclVatMinor: 1 }).where(eq(s.invoices.id, id)),
          ),
        ),
      ).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.delete(s.invoices).where(eq(s.invoices.id, id))))).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.update(s.invoiceLines).set({ amountMinor: 1 })))).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.delete(s.invoiceEvents)))).toMatch(KEPT);
      // The counter starts at 1 and moves by one, the job's writes included.
      expect(await failure(admin((tx) => tx.update(s.invoiceCounters).set({ lastSequence: 9 })))).toMatch(
        KEPT,
      );
      expect(
        await failure(
          admin((tx) =>
            tx.insert(s.invoiceCounters).values({ memberId: member(manager), year, lastSequence: 4 }),
          ),
        ),
      ).toMatch(KEPT);
      expect(await failure(admin((tx) => tx.delete(s.invoiceCounters)))).toMatch(KEPT);
      // The prefix is frozen by the first invoice.
      expect(
        await failure(
          as(owner, (tx) =>
            tx
              .update(s.contractorProfiles)
              .set({ invoicePrefix: 'KOFIB', updatedBy: owner })
              .where(eq(s.contractorProfiles.memberId, member(kofi))),
          ),
        ),
      ).toMatch(KEPT);
      const pdf = { invoiceId: id, storageKey: `invoices/${id}.pdf`, sha256: HASH };
      expect(await failure(as(owner, (tx) => tx.insert(s.invoicePdfs).values(pdf)))).toMatch(DENIED);
      await admin((tx) => tx.insert(s.invoicePdfs).values(pdf));
      expect(
        await failure(
          admin((tx) => tx.insert(s.invoicePdfs).values({ ...pdf, storageKey: `invoices/${id}-2.pdf` })),
        ),
      ).toMatch(/invoice_pdfs_pkey/u);
      expect(await failure(admin((tx) => tx.update(s.invoicePdfs).set({ sha256: 'b'.repeat(64) })))).toMatch(
        KEPT,
      );
      expect(await as(kofi, (tx) => tx.select().from(s.invoicePdfs))).toHaveLength(1);
      expect(await as(ama, (tx) => tx.select().from(s.invoicePdfs))).toHaveLength(0);
    });

    it('the contractor accepts or contests before the delay, once; the job accepts tacitly after it', async () => {
      const id = invoice('kofi-aug1');
      expect(await failure(event(ama, id, 'accepted'))).toMatch(RLS);
      expect(await failure(event(manager, id, 'accepted'))).toMatch(RLS);
      expect(await failure(event(owner, id, 'accepted'))).toMatch(RLS);
      await event(kofi, id, 'accepted');
      // Answered once: an accepted invoice is no longer his to contest.
      expect(await failure(event(kofi, id, 'contested', { reason: 'Montant faux' }))).toMatch(
        /invoice_events_answer_unique/u,
      );

      // An invoice whose delay is over: only the job accepts it, tacitly.
      const late = await issue({
        by: owner,
        userId: kofi,
        statementId: statement(kofi, '2026-09-01'),
        period: '2026-09-01',
        amountMinor: 12_000,
        invoice: {
          issuedAt: new Date(Date.now() - 10 * DAY),
          acceptanceDeadline: new Date(Date.now() - 3 * DAY),
        },
      });
      invoices.set('kofi-sep1', late);
      expect(await failure(event(kofi, late.id, 'accepted'))).toMatch(KEPT);
      expect(await failure(event(null, invoice('kofi-aug16'), 'lapsed'))).toMatch(KEPT);
      await event(null, late.id, 'lapsed');
      expect(await failure(event(null, late.id, 'lapsed'))).toMatch(/invoice_events_answer_unique/u);
    });

    it('a contest ends in a credit note that keeps the invoice’s period and regime, never above what is left', async () => {
      const id = invoice('kofi-aug16');
      expect(await failure(event(kofi, id, 'contested'))).toMatch(/invoice_events_values_check/u);
      expect(await failure(event(ama, id, 'contested', { reason: 'Pas la mienne' }))).toMatch(RLS);
      await event(kofi, id, 'contested', { reason: 'Une vente comptée deux fois' });
      // Credited only by a credit note that cites it.
      expect(await failure(event(owner, id, 'credited'))).toMatch(KEPT);

      const note = {
        by: owner,
        userId: kofi,
        statementId: null,
        period: '2026-08-16',
        creditedInvoiceId: id,
      };
      expect(await failure(issue({ ...note, amountMinor: -12_001 }))).toMatch(KEPT);
      expect(await failure(issue({ ...note, period: '2026-08-01', amountMinor: -2_000 }))).toMatch(KEPT);
      expect(
        await failure(issue({ ...note, creditedInvoiceId: invoice('ama-aug1'), amountMinor: -2_000 })),
      ).toMatch(KEPT);
      expect(
        await failure(
          issue({
            ...note,
            amountMinor: -2_000,
            invoice: { regime: { ...regimeCopy(benin, '2026-10-30'), mentions: [] } },
          }),
        ),
      ).toMatch(KEPT);
      // Its statement, when it has one, is a later one: never the period's own.
      expect(
        await failure(issue({ ...note, statementId: statement(kofi, '2026-08-16'), amountMinor: -2_000 })),
      ).toMatch(KEPT);
      // The owner or the job: a manager issues none.
      expect(await failure(issue({ ...note, by: manager, amountMinor: -2_000 }))).toMatch(RLS);
      const partial = await issue({ ...note, amountMinor: -2_000 });
      expect(partial.number).toBe(`KOFI-${String(year)}-0004`);
      await issue({ ...note, amountMinor: -10_000 });
      expect(await failure(issue({ ...note, amountMinor: -1 }))).toMatch(KEPT);
      expect(await failure(event(kofi, id, 'credited'))).toMatch(RLS);
      expect(await failure(event(manager, id, 'credited'))).toMatch(RLS);
      await event(owner, id, 'credited');
      expect(await failure(event(owner, id, 'contest_refused', { reason: 'Trop tard' }))).toMatch(
        /invoice_events_contest_end_unique/u,
      );

      // What a later period owes goes on an earlier invoice, accepted or not (ADR 0036): no event of it changes.
      const owed = await issue({
        by: null,
        userId: kofi,
        statementId: statement(kofi, '2026-09-01'),
        period: '2026-08-01',
        creditedInvoiceId: invoice('kofi-aug1'),
        amountMinor: -3_000,
      });
      expect(
        await admin((tx) =>
          tx
            .select({ kind: s.invoiceEvents.kind })
            .from(s.invoiceEvents)
            .where(eq(s.invoiceEvents.invoiceId, invoice('kofi-aug1'))),
        ),
      ).toEqual(expect.arrayContaining([{ kind: 'issued' }, { kind: 'accepted' }]));
      invoices.set('kofi-aug1-credit', owed);

      // The credit note follows its own acceptance; no credit note cites it, so its contest ends refused.
      await event(kofi, owed.id, 'contested', { reason: 'Ce remboursement n’est pas le mien' });
      expect(await failure(event(owner, owed.id, 'credited'))).toMatch(KEPT);
      await event(owner, owed.id, 'contest_refused', {
        reason: 'Remboursement du 2 septembre, sur ton compte',
      });
    });

    it('a contest is refused with a reason; a credit note written before it does not answer it', async () => {
      const id = invoice('ama-aug1');
      await issue({
        by: owner,
        userId: ama,
        statementId: null,
        period: '2026-08-01',
        creditedInvoiceId: id,
        amountMinor: -1_000,
        invoice: { contractor: { ...CONTRACTOR, legalName: 'Ama Exemple' } },
      });
      await event(ama, id, 'contested', { reason: 'Prime oubliée' });
      expect(await failure(event(owner, id, 'credited'))).toMatch(KEPT);
      expect(await failure(event(owner, id, 'contest_refused'))).toMatch(/invoice_events_values_check/u);
      await event(owner, id, 'contest_refused', { reason: 'La prime est sur la quinzaine suivante' });
    });

    it('a payment is an invoice’s, by a paid statement of its contractor, of its period or a later one, once', async () => {
      const pay = (id: string, paidOn: string, paymentReference: string) =>
        as(owner, (tx) =>
          tx
            .update(s.commissionStatements)
            .set({
              status: 'paid',
              paidAt: new Date(),
              paidBy: owner,
              paidOn,
              paymentMethod: 'worldremit',
              paymentReference,
              sentMinor: 12_000,
            })
            .where(eq(s.commissionStatements.id, id)),
        );
      const paid = statement(kofi, '2026-08-01');
      await pay(paid, '2026-08-20', 'WR-0001');
      expect(await failure(event(owner, invoice('kofi-aug1'), 'paid'))).toMatch(KEPT);
      expect(
        await failure(
          event(owner, invoice('kofi-aug16'), 'paid', { statementId: statement(kofi, '2026-08-16') }),
        ),
      ).toMatch(KEPT);
      expect(await failure(event(owner, invoice('ama-aug1'), 'paid', { statementId: paid }))).toMatch(KEPT);
      // Never a credit note's (the reconciliation imputes it), never by a statement before the invoice's period.
      expect(await failure(event(owner, invoice('kofi-aug1-credit'), 'paid', { statementId: paid }))).toMatch(
        KEPT,
      );
      expect(await failure(event(owner, invoice('kofi-aug16'), 'paid', { statementId: paid }))).toMatch(KEPT);
      expect(await failure(event(kofi, invoice('kofi-aug1'), 'paid', { statementId: paid }))).toMatch(RLS);
      await event(owner, invoice('kofi-aug1'), 'paid', { statementId: paid });
      expect(await failure(event(owner, invoice('kofi-aug1'), 'paid', { statementId: paid }))).toMatch(
        /invoice_events_paid_unique/u,
      );
      // A later statement pays what was carried over.
      const later16 = statement(kofi, '2026-08-16');
      await pay(later16, '2026-09-04', 'WR-0002');
      await event(owner, invoice('kofi-aug1'), 'paid', { statementId: later16 });
      // Issued, accepted, paid twice; issued, contested, credited; issued, lapsed; the three credit notes issued, the
      // last one contested and its contest refused.
      expect(await as(kofi, (tx) => tx.select().from(s.invoiceEvents))).toHaveLength(14);
    });

    it('an adjustment corrects a validated statement of its member, of an earlier period', async () => {
      const adjustment = (correctsStatementId: string) =>
        as(manager, (tx) =>
          tx.insert(s.payAdjustments).values({
            id: newId(PayAdjustmentIdSchema),
            memberId: member(kofi),
            period: '2026-09-16',
            amountMinor: -1_000,
            reason: 'Vente remboursée après la paie',
            correctsStatementId,
            createdBy: manager,
          }),
        );
      expect(await failure(adjustment(statement(ama, '2026-08-01')))).toMatch(KEPT);
      expect(await failure(adjustment(statement(kofi, '2026-09-16')))).toMatch(KEPT);
      await adjustment(statement(kofi, '2026-08-16'));
    });
  });
});
