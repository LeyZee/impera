import {
  AgencyLogoSchema,
  BillingSettingsViewSchema,
  CommissionStatementIdSchema,
  InvoiceAgencySchema,
  PayPeriodSchema,
  type TeamMember,
  type UpdateBillingSettingsBody,
} from '@nirvana/contracts';
import { and, eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { inventedPng, transparentLogo } from '../modules/payroll/infra/__tests__/invented-png';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';
import { DASHBOARD_ORIGIN } from './support/sign-in';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');

const quiet = { warn: () => undefined, error: () => undefined };

/** Invented parties only (ADR 0010): no real name, address nor identifier. */
const SETTINGS: UpdateBillingSettingsBody = {
  agency: {
    legalName: 'Agence Inventée SAS',
    address: '12 rue Fictive\n69002 Lyon',
    siren: '987654321',
    vatNumber: 'FR45987654321',
    legalForm: 'SAS',
    shareCapitalMinor: 1_000_000,
    rcsCity: 'Lyon',
  },
  serviceDescription: 'Gestion et animation de comptes de créatrices (texte inventé pour le test).',
  paymentTerms:
    'Aucun escompte pour paiement anticipé. Pénalités de retard : trois fois le taux d’intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
  dueDays: 60,
  fiscalYearEndMonth: 12,
  logoSha256: null,
};

describe('Réglages › Facturation : l’identité de l’agence, la prestation, le paiement et le logo (EQ-06)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let miaCookie: string;

  const db = () => team.test.admin.db;
  const payroll = () => team.app.modules.payroll;

  const upload = (cookie: string, bytes: Uint8Array, contentType = 'image/png') =>
    team.server.inject({
      method: 'POST',
      url: '/v1/payroll/billing-settings/logos',
      headers: { cookie, origin: DASHBOARD_ORIGIN, 'content-type': contentType },
      payload: Buffer.from(bytes),
    });

  const save = (cookie: string, body: object) => team.call('PUT', '/payroll/billing-settings', cookie, body);

  /** The audit lines of `action`, the newest first (ids are UUIDv7: they sort by time). */
  const auditOf = async (action: string) =>
    (await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, action))).sort((a, b) =>
      b.id.localeCompare(a.id),
    );

  /** Validates the member's statement of `period` and runs the issue; the invoice it wrote, if any. */
  async function issue(member: TeamMember, period: typeof Q1) {
    const { id } = await team.statementOf(member, period);
    const outcome = await payroll().jobs.issueInvoices(CommissionStatementIdSchema.parse(id), quiet);
    const [invoice] = await db()
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.statementId, id), eq(schema.invoices.kind, 'invoice')));
    return { outcome, invoice };
  }

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
    const invoicing = await setUpInvoicing(team, null, [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
    ]);
    await invoicing.acceptMandate(theo);
    for (const period of [Q1, Q2]) await team.report(theo, period, 10_000);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('issues nothing until the owner saved the settings, then copies them, the logo with its fingerprint', async () => {
    const empty = await team.call('GET', '/payroll/billing-settings', team.owner);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(BillingSettingsViewSchema.parse(empty.json())).toEqual({ settings: null, logo: null });

    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);
    const before = await issue(theo, Q1);
    expect(before.outcome).toMatchObject({ kind: 'planned', issued: [] });
    expect(before.invoice).toBeUndefined();

    const logo = transparentLogo(480, 160);
    const added = await upload(team.owner, logo);
    expect(added.statusCode, added.body).toBe(201);
    const kept = AgencyLogoSchema.parse(added.json());
    expect(kept).toMatchObject({ mediaType: 'image/png', width: 480, height: 160, byteLength: logo.length });
    // The same bytes again: the same logo, kept once.
    const again = await upload(team.owner, logo);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(kept);
    expect(await auditOf('agency_logo.add')).toHaveLength(1);

    const saved = await save(team.owner, { ...SETTINGS, logoSha256: kept.sha256 });
    expect(saved.statusCode, saved.body).toBe(200);
    const view = BillingSettingsViewSchema.parse(saved.json());
    expect(view).toMatchObject({
      settings: {
        ...SETTINGS,
        logoSha256: kept.sha256,
        documentReminderDays: 30,
        accounts: null,
      },
      logo: kept,
    });
    const [line] = await auditOf('billing_settings.update');
    expect(line?.details).toEqual({
      changed: [
        'agency.address',
        'agency.legalForm',
        'agency.legalName',
        'agency.rcsCity',
        'agency.shareCapitalMinor',
        'agency.siren',
        'agency.vatNumber',
        'serviceDescription',
        'paymentTerms',
        'dueDays',
        'fiscalYearEndMonth',
        'logoSha256',
      ],
    });

    // The issue is replayable: run again, it issues what was missing, with the settings of now.
    const after = await issue(theo, Q1);
    expect(after.outcome).toMatchObject({ kind: 'planned', issued: [{ kind: 'invoice' }] });
    expect(InvoiceAgencySchema.parse(after.invoice?.agency)).toEqual(SETTINGS.agency);
    expect(after.invoice).toMatchObject({
      serviceDescription: SETTINGS.serviceDescription,
      logoSha256: kept.sha256,
    });
  });

  it('shows the logo to the owner by its fingerprint, the same bytes, kept by the browser', async () => {
    const logo = transparentLogo(480, 160);
    const { sha256 } = AgencyLogoSchema.parse((await upload(team.owner, logo)).json());
    const read = await team.call('GET', `/payroll/billing-settings/logos/${sha256}`, team.owner);
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/png');
    expect(read.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(read.rawPayload).equals(Buffer.from(logo))).toBe(true);
    const unknown = await team.call('GET', `/payroll/billing-settings/logos/${'0'.repeat(64)}`, team.owner);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'agency_logo_not_found' } });
  });

  it('refuses a logo it would not print well, with its reason, and keeps nothing', async () => {
    const opaque = inventedPng({
      width: 200,
      height: 80,
      colorType: 6,
      bitDepth: 8,
      pixel: () => [14, 30, 61, 255],
    });
    const cases: readonly [Uint8Array, string][] = [
      [opaque, 'opaque'],
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]), 'not_png'],
      [transparentLogo().subarray(0, 60), 'damaged'],
      [transparentLogo(40, 40), 'dimensions'],
      [new Uint8Array(512 * 1024 + 1), 'too_heavy'],
    ];
    const kept = (await db().select().from(schema.agencyLogos)).length;
    for (const [bytes, reason] of cases) {
      const response = await upload(team.owner, bytes);
      expect(response.statusCode, reason).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'agency_logo_invalid', details: { reason } } });
    }
    // JSON is not a file: not a PNG either.
    const json = await team.call('POST', '/payroll/billing-settings/logos', team.owner, { png: 'x' });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toMatchObject({ error: { details: { reason: 'not_png' } } });
    expect(await db().select().from(schema.agencyLogos)).toHaveLength(kept);
  });

  it('writes nothing for the same values, and names only what a save changes', async () => {
    const [current] = await db().select().from(schema.billingSettings);
    const logoSha256 = current?.logoSha256 ?? null;
    const lines = (await auditOf('billing_settings.update')).length;
    const same = await save(team.owner, { ...SETTINGS, logoSha256 });
    expect(same.statusCode).toBe(200);
    const [unchanged] = await db().select().from(schema.billingSettings);
    expect(unchanged?.updatedAt).toEqual(current?.updatedAt);
    expect(await auditOf('billing_settings.update')).toHaveLength(lines);

    const terms =
      'Paiement par virement, aucun escompte. Pénalités : trois fois le taux légal ; 40 € d’indemnité.';
    const changed = await save(team.owner, { ...SETTINGS, logoSha256, paymentTerms: terms, dueDays: 45 });
    expect(changed.statusCode, changed.body).toBe(200);
    const [line] = await auditOf('billing_settings.update');
    expect(line?.details).toEqual({ changed: ['paymentTerms', 'dueDays'] });

    // The invoice issued before keeps its copy; the next one takes the new terms.
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
    const next = await issue(theo, Q2);
    expect(next.invoice?.mentions.at(-1)).toContain(terms);
    const invoices = await db()
      .select({ number: schema.invoices.number, mentions: schema.invoices.mentions })
      .from(schema.invoices)
      .where(eq(schema.invoices.kind, 'invoice'));
    expect(invoices).toHaveLength(2);
    const first = invoices.find((one) => one.number !== next.invoice?.number);
    expect(first?.mentions.at(-1)).toContain(SETTINGS.paymentTerms);
  });

  it('refuses incomplete settings, a delay out of bounds, a logo nobody added', async () => {
    const withoutForm = Object.fromEntries(
      Object.entries(SETTINGS.agency).filter(([key]) => key !== 'legalForm'),
    );
    const refused: readonly [object, number, string][] = [
      [{ ...SETTINGS, agency: withoutForm }, 400, 'request_invalid'],
      [{ ...SETTINGS, agency: { ...SETTINGS.agency, siren: '12345' } }, 400, 'request_invalid'],
      [{ ...SETTINGS, agency: { ...SETTINGS.agency, shareCapitalMinor: 0 } }, 400, 'request_invalid'],
      [{ ...SETTINGS, serviceDescription: '   ' }, 400, 'request_invalid'],
      [{ ...SETTINGS, dueDays: 61 }, 400, 'request_invalid'],
      [{ ...SETTINGS, dueDays: 44 }, 400, 'request_invalid'],
      [{ ...SETTINGS, fiscalYearEndMonth: 13 }, 400, 'request_invalid'],
      [{ ...SETTINGS, logoSha256: 'f'.repeat(64) }, 404, 'agency_logo_not_found'],
    ];
    for (const [body, status, code] of refused) {
      const response = await save(team.owner, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(status);
      expect(response.json()).toMatchObject({ error: { code } });
    }
  });

  it('is the owner’s alone: a manager and a chatter neither read nor change it', async () => {
    for (const cookie of [miaCookie, theoCookie]) {
      expect((await team.call('GET', '/payroll/billing-settings', cookie)).statusCode).toBe(403);
      expect((await save(cookie, SETTINGS)).statusCode).toBe(403);
      expect((await upload(cookie, transparentLogo())).statusCode).toBe(403);
    }
  });
});
