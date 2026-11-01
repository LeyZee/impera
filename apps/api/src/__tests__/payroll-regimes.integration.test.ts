import {
  BillingRegimeIdSchema,
  BillingRegimeSchema,
  BillingRegimesSchema,
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractorFileSchema,
  ContractorRegimeIdSchema,
  ContractorRegimeSchema,
  newId,
  PayPeriodSchema,
  TeamMemberIdSchema,
  type ContractorProfileBody,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { addDays } from '../modules/payroll/domain/billing';
import { dayStartsAt } from '../modules/payroll/domain/regimes';
import { transparentLogo } from '../modules/payroll/infra/__tests__/invented-png';

import { setUpInvoicing, type Invoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** A period of 2025: it has ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
/** The agency's zone, the scheduling's default: today is its calendar day. */
const ZONE = 'Europe/Paris';

const quiet = { warn: () => undefined, error: () => undefined };

/** An invented company (ADR 0010): its SIREN has a right check key, its VAT number is the one it gives. */
const THEO_FILE: ContractorProfileBody = {
  legalName: 'Théo Inventé SARL',
  address: '3 rue Imaginaire\n69001 Lyon',
  taxId: '123456782',
  businessId: '123456782',
  vatNumber: 'FR11123456782',
  individualEntrepreneur: false,
  legalForm: 'SARL',
  shareCapitalMinor: 100_000,
  rcsCity: 'Lyon',
  email: 'theo@example.test',
};

/** Invented regimes: their words are the test's, never an accountant's. */
const BENIN = {
  id: newId(BillingRegimeIdSchema),
  name: 'Bénin et Madagascar (texte inventé)',
  countries: ['BJ', 'MG'],
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: true,
};
const FRANCHISE = {
  id: newId(BillingRegimeIdSchema),
  name: 'France, franchise (texte inventé)',
  countries: ['FR'],
  vat: { treatment: 'exempt' },
  withholding: 'none',
  mentions: ['TVA non applicable (texte inventé)'],
  documents: ['urssaf_vigilance'],
  taxIdRequired: true,
};

describe('Équipe › Régimes de facturation : écrire, valider, attribuer (EQ-06 lot 5b)', () => {
  let team: PayrollTeam;
  let invoicing: Invoicing;
  let theo: TeamMember;
  let theoCookie: string;
  let miaCookie: string;

  const db = () => team.test.admin.db;
  const payroll = () => team.app.modules.payroll;
  const today = () => calendarDayAt(new Date(), ZONE);

  const addRegime = (cookie: string, body: object) =>
    team.call('POST', '/payroll/billing-regimes', cookie, body);
  const validateRegime = (regimeId: string, cookie: string, validatedOn: string) =>
    team.call('POST', `/payroll/billing-regimes/${regimeId}/validation`, cookie, { validatedOn });
  const assign = (memberId: string, cookie: string, body: object) =>
    team.call('POST', `/payroll/contractors/${memberId}/regimes`, cookie, body);

  /** The jobs waiting under `key`, with when they run. */
  const jobsAt = async (key: string) =>
    (
      await db().execute<{ payload: unknown; run_at: Date }>(
        sql`select payload, run_at from graphile_worker._private_jobs where key = ${key}`,
      )
    ).rows;
  const forgetJobs = (pattern: string) =>
    db().execute(sql`delete from graphile_worker._private_jobs where key like ${pattern}`);

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
    // The agency's settings, « France, TVA facturée » validated, the mandate; Théo has no regime yet.
    invoicing = await setUpInvoicing(team, { mediaType: 'image/png', bytes: transparentLogo(480, 160) }, []);
    expect(
      (await team.call('PUT', `/payroll/contractors/${theo.id}/profile`, theoCookie, THEO_FILE)).statusCode,
    ).toBe(201);
    expect(
      (
        await team.call('PUT', `/payroll/contractors/${theo.id}/profile/prefix`, team.owner, {
          invoicePrefix: 'THEO',
        })
      ).statusCode,
    ).toBe(200);
    const file = ContractorFileSchema.parse(
      (await team.call('GET', `/payroll/contractors/${theo.id}/file`, team.owner)).json(),
    );
    expect(
      (
        await team.call('POST', `/payroll/contractors/${theo.id}/profile/verify`, team.owner, {
          updatedAt: file.profile?.updatedAt,
        })
      ).statusCode,
    ).toBe(200);
    await invoicing.acceptMandate(theo);
    await team.report(theo, Q1, 10_000);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('lets the owner alone add a regime, given back as written, never changed under its id', async () => {
    for (const cookie of [miaCookie, theoCookie]) {
      expect((await addRegime(cookie, BENIN)).statusCode).toBe(403);
    }
    // The treaty sets the withholding aside only with the residence certificate: the regime asks for it.
    const noCertificate = await addRegime(team.owner, { ...BENIN, documents: [] });
    expect(noCertificate.statusCode).toBe(400);

    const created = await addRegime(team.owner, BENIN);
    expect(created.statusCode, created.body).toBe(201);
    const benin = BillingRegimeSchema.parse(created.json());
    expect(benin).toMatchObject({ ...BENIN, validatedOn: null });
    const again = await addRegime(team.owner, BENIN);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(benin);
    const other = await addRegime(team.owner, { ...BENIN, name: 'Bénin seul (texte inventé)' });
    expect(other.statusCode).toBe(409);
    expect(team.refusal(other).code).toBe('billing_regime_id_conflict');

    expect((await addRegime(team.owner, FRANCHISE)).statusCode).toBe(201);
    const [row] = await db()
      .select()
      .from(schema.billingRegimes)
      .where(eq(schema.billingRegimes.id, FRANCHISE.id));
    expect(row).toMatchObject({ vatTreatment: 'exempt', vatRateBps: null, createdBy: team.ownerId });
    expect(await team.audited('billing_regime.create')).toBe(2);

    // Any member reads them, the newest first: the screen of his file names his regime.
    const read = await team.call('GET', '/payroll/billing-regimes', theoCookie);
    expect(read.statusCode).toBe(200);
    expect(BillingRegimesSchema.parse(read.json()).regimes.map((regime) => regime.id)).toEqual([
      FRANCHISE.id,
      BENIN.id,
      invoicing.regimeId,
    ]);
  });

  it('records the accountant’s validation once, never ahead, and tries every waiting invoice again', async () => {
    const unknown = await validateRegime(newId(BillingRegimeIdSchema), team.owner, today());
    expect(unknown.statusCode).toBe(404);
    expect(team.refusal(unknown).code).toBe('billing_regime_not_found');
    const ahead = await validateRegime(FRANCHISE.id, team.owner, addDays(today(), 1));
    expect(ahead.statusCode).toBe(422);
    expect(team.refusal(ahead).code).toBe('billing_regime_validation_future_unprocessable');
    expect((await validateRegime(FRANCHISE.id, miaCookie, today())).statusCode).toBe(403);

    await forgetJobs('payroll.requeue_invoice_issues:%');
    const validated = await validateRegime(FRANCHISE.id, team.owner, today());
    expect(validated.statusCode, validated.body).toBe(201);
    const franchise = BillingRegimeSchema.parse(validated.json());
    expect(franchise).toMatchObject({ id: FRANCHISE.id, validatedOn: today() });
    expect((await jobsAt('payroll.requeue_invoice_issues:all')).map((job) => job.payload)).toEqual([
      { memberId: null },
    ]);
    const again = await validateRegime(FRANCHISE.id, team.owner, today());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(franchise);
    const moved = await validateRegime(FRANCHISE.id, team.owner, addDays(today(), -1));
    expect(moved.statusCode).toBe(409);
    expect(team.refusal(moved).code).toBe('billing_regime_validated_conflict');
    // A day gone by is the day he gave it.
    expect((await validateRegime(BENIN.id, team.owner, addDays(today(), -2))).statusCode).toBe(201);
    expect(await team.audited('billing_regime.validate')).toBe(2);
  });

  it('gives a contractor a regime of his country from today or later, and tries his invoices on that day', async () => {
    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);
    const statementId = CommissionStatementIdSchema.parse((await team.statementOf(theo, Q1)).id);
    const waiting = await payroll().jobs.issueInvoices(statementId, quiet);
    expect(waiting).toMatchObject({ issued: [], notIssued: [{ reason: 'no_regime' }] });

    const france = { id: newId(ContractorRegimeIdSchema), regimeId: invoicing.regimeId, from: today() };
    const abroad = await assign(theo.id, team.owner, { ...france, regimeId: BENIN.id });
    expect(abroad.statusCode).toBe(422);
    expect(team.refusal(abroad).code).toBe('billing_regime_country_unprocessable');
    const backdated = await assign(theo.id, team.owner, { ...france, from: addDays(today(), -1) });
    expect(backdated.statusCode).toBe(422);
    expect(team.refusal(backdated).code).toBe('billing_regime_backdated_unprocessable');
    const unknownRegime = await assign(theo.id, team.owner, {
      ...france,
      regimeId: newId(BillingRegimeIdSchema),
    });
    expect(unknownRegime.statusCode).toBe(404);
    expect(team.refusal(unknownRegime).code).toBe('billing_regime_not_found');
    const unknownMember = await assign(newId(TeamMemberIdSchema), team.owner, france);
    expect(unknownMember.statusCode).toBe(404);
    expect(team.refusal(unknownMember).code).toBe('team_member_not_found');
    for (const cookie of [miaCookie, theoCookie]) {
      expect((await assign(theo.id, cookie, france)).statusCode).toBe(403);
    }
    expect(await team.audited('contractor_regime.assign')).toBe(0);

    await forgetJobs('payroll.requeue_invoice_issues:%');
    const given = await assign(theo.id, team.owner, france);
    expect(given.statusCode, given.body).toBe(201);
    const assignment = ContractorRegimeSchema.parse(given.json());
    expect(assignment).toMatchObject({ memberId: theo.id, regimeId: invoicing.regimeId, from: today() });
    const again = await assign(theo.id, team.owner, france);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(assignment);
    const changed = await assign(theo.id, team.owner, { ...france, from: addDays(today(), 3) });
    expect(changed.statusCode).toBe(409);
    expect(team.refusal(changed).code).toBe('contractor_regime_id_conflict');
    const twiceToday = await assign(theo.id, team.owner, { ...france, id: newId(ContractorRegimeIdSchema) });
    expect(twiceToday.statusCode).toBe(422);
    expect(team.refusal(twiceToday).code).toBe('billing_regime_backdated_unprocessable');

    // In force today: his statement that waited is tried again at once, and its invoice goes out under it.
    expect((await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).map((job) => job.payload)).toEqual([
      { memberId: theo.id },
    ]);
    await forgetJobs('payroll.issue_invoices:%');
    expect(await payroll().jobs.requeueInvoiceIssues(theo.id)).toBe(1);
    const issued = await payroll().jobs.issueInvoices(statementId, quiet);
    expect(issued).toMatchObject({ kind: 'planned', issued: [{ kind: 'invoice' }], notIssued: [] });
    const [invoice] = await db()
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.statementId, statementId), eq(schema.invoices.kind, 'invoice')));
    expect(invoice?.regimeId).toBe(invoicing.regimeId);

    // Under the franchise in a fortnight: nothing to try today, his statements are tried on that day's first minute.
    await forgetJobs('payroll.requeue_invoice_issues:%');
    const later = addDays(today(), 15);
    const franchise = { id: newId(ContractorRegimeIdSchema), regimeId: FRANCHISE.id, from: later };
    expect((await assign(theo.id, team.owner, franchise)).statusCode).toBe(201);
    expect(await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).toEqual([]);
    const deferred = await jobsAt(`payroll.requeue_invoice_issues:${theo.id}:${later}`);
    expect(deferred.map((job) => job.payload)).toEqual([{ memberId: theo.id }]);
    expect(new Date(deferred[0]?.run_at ?? 0).toISOString()).toBe(dayStartsAt(later, ZONE).toISOString());
    expect(await team.audited('contractor_regime.assign')).toBe(2);

    // His file names both, the latest first.
    const file = ContractorFileSchema.parse(
      (await team.call('GET', `/payroll/contractors/${theo.id}/file`, theoCookie)).json(),
    );
    expect(file.regimes.map((one) => [one.regimeId, one.from])).toEqual([
      [FRANCHISE.id, later],
      [invoicing.regimeId, today()],
    ]);
  });

  it('issues nothing under a regime of another country than the one his record now gives (« ok pays »)', async () => {
    const Q2 = PayPeriodSchema.parse('2025-05-16');
    await team.report(theo, Q2, 8_000);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
    const statementId = CommissionStatementIdSchema.parse((await team.statementOf(theo, Q2)).id);
    // His record moved to Benin after his French regime was given.
    await db().update(schema.teamMembers).set({ country: 'BJ' }).where(eq(schema.teamMembers.id, theo.id));
    expect(await payroll().jobs.issueInvoices(statementId, quiet)).toMatchObject({
      issued: [],
      notIssued: [{ document: 'invoice', reason: 'regime_country_mismatch' }],
    });
    await db().update(schema.teamMembers).set({ country: 'FR' }).where(eq(schema.teamMembers.id, theo.id));
    expect(await payroll().jobs.issueInvoices(statementId, quiet)).toMatchObject({
      issued: [{ kind: 'invoice' }],
      notIssued: [],
    });
  });
});
