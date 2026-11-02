import { createHash } from 'node:crypto';

import {
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractAcceptanceSchema,
  ContractorFileSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  ContractTextSchema,
  ContractTextsSchema,
  newId,
  PayPeriodSchema,
  type ContractorProfileBody,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { transparentLogo } from '../modules/contractors/infra/__tests__/invented-png';

import { setUpInvoicing, type Invoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** A period of 2025: it has ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');

const quiet = { warn: () => undefined, error: () => undefined };
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Invented contractors only (ADR 0010): no real name, address nor identifier. Théo's company, under the regime « France,
 * TVA facturée » that `setUpInvoicing` validates: its SIREN has a right check key, its VAT number is the one it gives.
 */
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
const LOU_FILE: ContractorProfileBody = {
  ...THEO_FILE,
  legalName: 'Lou Inventée',
  businessId: '111111118',
  taxId: '111111118',
  vatNumber: 'FR44111111118',
  individualEntrepreneur: true,
  legalForm: null,
  shareCapitalMinor: null,
  rcsCity: null,
  email: 'lou@example.test',
};

describe('Équipe › Dossier prestataire, contrat et mandat : écrire, vérifier, accepter (EQ-06 lot 5a)', () => {
  let team: PayrollTeam;
  let invoicing: Invoicing;
  let theo: TeamMember;
  let lou: TeamMember;
  let mia: TeamMember;
  let theoCookie: string;
  let louCookie: string;
  let miaCookie: string;

  const db = () => team.test.admin.db;
  const invoicingModule = () => team.app.modules.invoicing;

  const fileOf = (memberId: string, cookie: string) =>
    team.call('GET', `/payroll/contractors/${memberId}/file`, cookie);
  const write = (memberId: string, cookie: string, body: object) =>
    team.call('PUT', `/payroll/contractors/${memberId}/profile`, cookie, body);
  const verify = (memberId: string, cookie: string, updatedAt: string) =>
    team.call('POST', `/payroll/contractors/${memberId}/profile/verify`, cookie, { updatedAt });
  const prefix = (memberId: string, cookie: string, invoicePrefix: string) =>
    team.call('PUT', `/payroll/contractors/${memberId}/profile/prefix`, cookie, { invoicePrefix });
  const accept = (textId: string, cookie: string, hash: string) =>
    team.call('POST', `/payroll/contract-texts/${textId}/accept`, cookie, { sha256: hash });

  /** The audit lines of `action`, the newest first (ids are UUIDv7: they sort by time). */
  const auditOf = async (action: string) =>
    (await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, action))).sort((a, b) =>
      b.id.localeCompare(a.id),
    );

  /** The payloads of the jobs waiting under `key`. */
  const jobsAt = async (key: string) =>
    (
      await db().execute<{ payload: unknown }>(
        sql`select payload from graphile_worker._private_jobs where key = ${key}`,
      )
    ).rows.map((row) => row.payload);
  const forgetJobs = (pattern: string) =>
    db().execute(sql`delete from graphile_worker._private_jobs where key like ${pattern}`);

  /** The invoice of the member's statement of `period`, if one was issued. */
  async function invoiceOf(member: TeamMember, period: typeof Q1) {
    const { id } = await team.statementOf(member, period);
    const [invoice] = await db()
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.statementId, id), eq(schema.invoices.kind, 'invoice')));
    return invoice;
  }

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lou, cookie: louCookie } = await team.addMember('lou@example.test', 'Lou'));
    ({ member: mia, cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
    // The agency's settings, the regime and the mandate (version 1); no contractor's file: each one writes his own.
    invoicing = await setUpInvoicing(team, { mediaType: 'image/png', bytes: transparentLogo(480, 160) }, []);
    for (const member of [theo, lou]) {
      await db()
        .insert(schema.contractorRegimes)
        .values({
          id: newId(ContractorRegimeIdSchema),
          memberId: member.id,
          regimeId: invoicing.regimeId,
          effectiveFrom: '2025-01-01',
          createdBy: team.ownerId,
        });
    }
    await team.report(theo, Q1, 10_000);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('lets the contractor write his own file, the owner too, a manager or another member never', async () => {
    const empty = await fileOf(theo.id, theoCookie);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(ContractorFileSchema.parse(empty.json())).toEqual({
      memberId: theo.id,
      // The agency's day, which a document's reminder is compared with (lot 8).
      today: calendarDayAt(new Date(), 'Europe/Paris'),
      country: 'FR',
      profile: null,
      prefixFrozen: false,
      acceptances: [],
      // His regime, given before he writes his file (lot 5b gives it through its route).
      regimes: [
        expect.objectContaining({ memberId: theo.id, regimeId: invoicing.regimeId, from: '2025-01-01' }),
      ],
      // No document filed yet (lot 5c).
      documents: [],
    });

    const created = await write(theo.id, theoCookie, THEO_FILE);
    expect(created.statusCode, created.body).toBe(201);
    const file = ContractorFileSchema.parse(created.json());
    expect(file.profile).toMatchObject({ ...THEO_FILE, invoicePrefix: null, verifiedAt: null });
    const [line] = await auditOf('contractor_profile.create');
    expect(line).toMatchObject({ userId: theo.userId, entity: 'contractor_profile', entityId: theo.id });
    // The names of the fields, never their values (an address, a tax id are personal data).
    expect(line?.details).toEqual({
      changed: [
        'legalName',
        'address',
        'taxId',
        'businessId',
        'vatNumber',
        'legalForm',
        'shareCapitalMinor',
        'rcsCity',
        'email',
      ],
      checkCleared: false,
    });
    expect(await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).toEqual([{ memberId: theo.id }]);

    // The same values again: nothing written, nothing said.
    const again = await write(theo.id, theoCookie, THEO_FILE);
    expect(again.statusCode).toBe(200);
    expect(ContractorFileSchema.parse(again.json())).toEqual(file);
    expect(await team.audited('contractor_profile.update')).toBe(0);

    // A manager reads it, never writes it; another member neither reads nor writes it.
    expect((await fileOf(theo.id, miaCookie)).statusCode).toBe(200);
    const byManager = await write(theo.id, miaCookie, { ...THEO_FILE, email: 'autre@example.test' });
    expect(byManager.statusCode).toBe(403);
    expect(team.refusal(byManager).code).toBe('contractor_profile_forbidden');
    for (const response of [
      await fileOf(theo.id, louCookie),
      await write(theo.id, louCookie, { ...THEO_FILE, email: 'autre@example.test' }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(team.refusal(response).code).toBe('team_member_not_found');
    }

    // The owner writes a contractor's file too.
    const byOwner = await write(lou.id, team.owner, LOU_FILE);
    expect(byOwner.statusCode, byOwner.body).toBe(201);
    expect(ContractorFileSchema.parse((await fileOf(lou.id, louCookie)).json()).profile).toMatchObject(
      LOU_FILE,
    );
  });

  it('refuses a SIREN with a wrong key, a VAT number not its own, a company without its three mentions', async () => {
    const cases: readonly [object, string][] = [
      [{ ...THEO_FILE, businessId: '123456789' }, 'businessId'],
      [{ ...THEO_FILE, vatNumber: 'FR12123456782' }, 'vatNumber'],
      [{ ...THEO_FILE, rcsCity: null }, 'legalForm'],
      [{ ...THEO_FILE, individualEntrepreneur: true }, 'legalForm'],
    ];
    for (const [body, field] of cases) {
      const response = await write(theo.id, theoCookie, body);
      expect(response.statusCode, field).toBe(400);
      expect(response.body).toContain(field);
    }
  });

  it('is checked by the owner as he read it, and a change of identity asks for a new check', async () => {
    const before = ContractorFileSchema.parse((await fileOf(theo.id, team.owner)).json());
    const updatedAt = before.profile?.updatedAt ?? '';

    const byMember = await verify(theo.id, theoCookie, updatedAt);
    expect(byMember.statusCode).toBe(403);
    const unseen = await verify(theo.id, team.owner, '2025-01-01T00:00:00.000Z');
    expect(unseen.statusCode).toBe(409);
    expect(team.refusal(unseen).code).toBe('contractor_profile_changed_conflict');

    await forgetJobs('payroll.requeue_invoice_issues:%');
    const checked = await verify(theo.id, team.owner, updatedAt);
    expect(checked.statusCode, checked.body).toBe(200);
    const verified = ContractorFileSchema.parse(checked.json());
    expect(verified.profile?.verifiedAt).not.toBeNull();
    expect(await team.audited('contractor_profile.verify')).toBe(1);
    expect(await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).toHaveLength(1);
    // Checked already: given back as it is, the old instant notwithstanding.
    const twice = await verify(theo.id, team.owner, updatedAt);
    expect(twice.statusCode).toBe(200);
    expect(ContractorFileSchema.parse(twice.json())).toEqual(verified);
    expect(await team.audited('contractor_profile.verify')).toBe(1);

    const moved = await write(theo.id, theoCookie, { ...THEO_FILE, address: '4 rue Imaginaire\n69001 Lyon' });
    expect(moved.statusCode).toBe(200);
    expect(ContractorFileSchema.parse(moved.json()).profile?.verifiedAt).toBeNull();
    const [line] = await auditOf('contractor_profile.update');
    expect(line?.details).toEqual({ changed: ['address'], checkCleared: true });
  });

  it('takes a prefix from the owner only, one contractor’s own, frozen by his first invoice', async () => {
    expect((await prefix(theo.id, theoCookie, 'THEO')).statusCode).toBe(403);
    const set = await prefix(theo.id, team.owner, 'THEO');
    expect(set.statusCode, set.body).toBe(200);
    expect(ContractorFileSchema.parse(set.json()).profile?.invoicePrefix).toBe('THEO');
    const [line] = await auditOf('contractor_profile.prefix');
    expect(line?.details).toEqual({ from: null, to: 'THEO' });
    // The same again: nothing written.
    expect((await prefix(theo.id, team.owner, 'THEO')).statusCode).toBe(200);
    expect(await team.audited('contractor_profile.prefix')).toBe(1);

    const taken = await prefix(lou.id, team.owner, 'THEO');
    expect(taken.statusCode).toBe(409);
    expect(team.refusal(taken).code).toBe('invoice_prefix_taken_conflict');

    const noFile = await prefix(mia.id, team.owner, 'MIA');
    expect(noFile.statusCode).toBe(404);
    expect(team.refusal(noFile).code).toBe('contractor_profile_not_found');
  });

  it('versions the contract and the mandate, the owner’s texts, each with the SHA-256 of its exact text', async () => {
    const id = newId(ContractTextIdSchema);
    const body = 'Contrat de prestation (texte inventé pour le test).\n\nArticle 1 : la mission.';
    const added = await team.call('POST', '/payroll/contract-texts', team.owner, {
      id,
      kind: 'service_contract',
      body,
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(ContractTextSchema.parse(added.json())).toMatchObject({
      id,
      kind: 'service_contract',
      version: 1,
      sha256: sha256(body),
      contestDelayDays: null,
    });
    const again = await team.call('POST', '/payroll/contract-texts', team.owner, {
      id,
      kind: 'service_contract',
      body,
    });
    expect(again.statusCode).toBe(200);
    const other = await team.call('POST', '/payroll/contract-texts', team.owner, {
      id,
      kind: 'service_contract',
      body: `${body} Modifié.`,
    });
    expect(other.statusCode).toBe(409);
    expect(team.refusal(other).code).toBe('contract_text_id_conflict');
    const byManager = await team.call('POST', '/payroll/contract-texts', miaCookie, {
      id: newId(ContractTextIdSchema),
      kind: 'service_contract',
      body,
    });
    expect(byManager.statusCode).toBe(403);

    // A mandate fixes its delay to contest; a second version is the next one of its kind.
    const noDelay = await team.call('POST', '/payroll/contract-texts', team.owner, {
      id: newId(ContractTextIdSchema),
      kind: 'billing_mandate',
      body: 'Mandat sans délai.',
    });
    expect(noDelay.statusCode).toBe(400);
    const mandate = await team.call('POST', '/payroll/contract-texts', team.owner, {
      id: newId(ContractTextIdSchema),
      kind: 'billing_mandate',
      body: 'Mandat de facturation, version 2 (texte inventé pour le test). Délai : dix jours.',
      contestDelayDays: 10,
    });
    expect(mandate.statusCode, mandate.body).toBe(201);
    expect(ContractTextSchema.parse(mandate.json())).toMatchObject({ version: 2, contestDelayDays: 10 });
    expect(await team.audited('contract_text.add')).toBe(2);

    const read = await team.call('GET', '/payroll/contract-texts', louCookie);
    expect(read.statusCode).toBe(200);
    expect(ContractTextsSchema.parse(read.json()).texts.map((text) => [text.kind, text.version])).toEqual([
      ['billing_mandate', 2],
      ['billing_mandate', 1],
      ['service_contract', 1],
    ]);
  });

  it('is accepted by the contractor himself, the newest version as he read it, and tries his invoices again', async () => {
    // Validated before his mandate: no invoice, said to the owner once.
    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);
    const { id: statementId } = await team.statementOf(theo, Q1);
    const blocked = await invoicingModule().jobs.issueInvoices(
      CommissionStatementIdSchema.parse(statementId),
      quiet,
    );
    expect(blocked).toMatchObject({ kind: 'planned', issued: [], notIssued: [{ reason: 'no_mandate' }] });

    const texts = ContractTextsSchema.parse(
      (await team.call('GET', '/payroll/contract-texts', theoCookie)).json(),
    );
    const newest = texts.texts.find((text) => text.kind === 'billing_mandate' && text.version === 2);
    if (newest === undefined) throw new Error('no mandate of version 2');

    // Nobody accepts for him: the owner has no member record of his own here.
    const byOwner = await accept(newest.id, team.owner, newest.sha256);
    expect(byOwner.statusCode).toBe(403);
    expect(team.refusal(byOwner).code).toBe('contract_acceptance_forbidden');
    const old = await accept(invoicing.mandate.id, theoCookie, sha256(invoicing.mandate.body));
    expect(old.statusCode).toBe(409);
    expect(team.refusal(old).code).toBe('contract_text_superseded_conflict');
    const misread = await accept(newest.id, theoCookie, sha256('un autre texte'));
    expect(misread.statusCode).toBe(409);
    expect(team.refusal(misread).code).toBe('contract_text_changed_conflict');
    const unknown = await accept(newId(ContractTextIdSchema), theoCookie, newest.sha256);
    expect(unknown.statusCode).toBe(404);

    await forgetJobs('payroll.requeue_invoice_issues:%');
    const accepted = await accept(newest.id, theoCookie, newest.sha256);
    expect(accepted.statusCode, accepted.body).toBe(201);
    const acceptance = ContractAcceptanceSchema.parse(accepted.json());
    expect(acceptance).toMatchObject({ memberId: theo.id, textId: newest.id, sha256: newest.sha256 });
    const twice = await accept(newest.id, theoCookie, newest.sha256);
    expect(twice.statusCode).toBe(200);
    expect(twice.json()).toEqual(acceptance);
    expect(await team.audited('contract.accept')).toBe(1);
    expect(ContractorFileSchema.parse((await fileOf(theo.id, theoCookie)).json()).acceptances).toEqual([
      acceptance,
    ]);

    // His mandate accepted: the statement that waited for it is tried again.
    expect(await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).toEqual([{ memberId: theo.id }]);
    await forgetJobs('payroll.issue_invoices:%');
    expect(await invoicingModule().jobs.requeueInvoiceIssues(theo.id)).toBe(1);
    expect(await jobsAt(`payroll.issue_invoices:${statementId}`)).toEqual([{ statementId }]);
    // Nobody else's statement waits.
    expect(await invoicingModule().jobs.requeueInvoiceIssues(lou.id)).toBe(0);
    const unchecked = await invoicingModule().jobs.issueInvoices(
      CommissionStatementIdSchema.parse(statementId),
      quiet,
    );
    // His new address cleared the owner's check: nothing goes out on a file nobody checked as it stands.
    expect(unchecked).toMatchObject({ issued: [], notIssued: [{ reason: 'identity_unverified' }] });
    expect(await invoiceOf(theo, Q1)).toBeUndefined();

    // The owner checks it: the statement is tried again, and its invoice goes out.
    await forgetJobs('payroll.requeue_invoice_issues:%');
    const file = ContractorFileSchema.parse((await fileOf(theo.id, team.owner)).json());
    expect((await verify(theo.id, team.owner, file.profile?.updatedAt ?? '')).statusCode).toBe(200);
    expect(await jobsAt(`payroll.requeue_invoice_issues:${theo.id}`)).toEqual([{ memberId: theo.id }]);
    expect(await invoicingModule().jobs.requeueInvoiceIssues(theo.id)).toBe(1);
    const issued = await invoicingModule().jobs.issueInvoices(
      CommissionStatementIdSchema.parse(statementId),
      quiet,
    );
    expect(issued).toMatchObject({ kind: 'planned', issued: [{ kind: 'invoice' }], notIssued: [] });
    const invoice = await invoiceOf(theo, Q1);
    expect(invoice?.prefix).toBe('THEO');
    // The delay to contest is the one of the version he accepted: ten days.
    const delay = (invoice?.acceptanceDeadline.getTime() ?? 0) - (invoice?.createdAt.getTime() ?? 0);
    expect(Math.abs(delay - 10 * 86_400_000)).toBeLessThan(60_000);

    // His first invoice froze his prefix.
    const frozen = await prefix(theo.id, team.owner, 'THEO2');
    expect(frozen.statusCode).toBe(409);
    expect(team.refusal(frozen).code).toBe('invoice_prefix_frozen_conflict');
    expect(ContractorFileSchema.parse((await fileOf(theo.id, theoCookie)).json()).prefixFrozen).toBe(true);
  });

  it('tries every waiting invoice again once the agency’s settings change', async () => {
    await forgetJobs('payroll.requeue_invoice_issues:%');
    const [current] = await db().select().from(schema.billingSettings);
    if (current === undefined) throw new Error('no settings');
    const saved = await team.call('PUT', '/payroll/billing-settings', team.owner, {
      agency: {
        legalName: 'Agence Inventée SAS',
        address: '12 rue Fictive\n69002 Lyon',
        siren: '987654324',
        vatNumber: 'FR14987654324',
        legalForm: 'SAS',
        shareCapitalMinor: 1_000_000,
        rcsCity: 'Lyon',
      },
      serviceDescription: current.serviceDescription,
      paymentTerms: current.paymentTerms,
      dueDays: current.dueDays,
      fiscalYearEndMonth: current.fiscalYearEndMonth,
      logoSha256: current.logoSha256,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await jobsAt('payroll.requeue_invoice_issues:all')).toEqual([{ memberId: null }]);
    // Théo's statement was said not issued once: it is tried again, and its run issues nothing twice.
    expect(await invoicingModule().jobs.requeueInvoiceIssues(null)).toBe(1);
    const { id: statementId } = await team.statementOf(theo, Q1);
    const rerun = await invoicingModule().jobs.issueInvoices(
      CommissionStatementIdSchema.parse(statementId),
      quiet,
    );
    expect(rerun).toMatchObject({ kind: 'planned', issued: [], notIssued: [] });
  });
});
