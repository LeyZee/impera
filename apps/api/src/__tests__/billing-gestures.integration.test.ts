import {
  BillingRegimeIdSchema,
  ContractorDocumentIdSchema,
  ContractTextIdSchema,
  InvoiceIdSchema,
  newId,
  type TeamMember,
} from '@impera/contracts';
import { schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';
import { signIn } from './support/sign-in';

type Method = 'POST' | 'PUT';

/**
 * Billing under the same rule as a member, a rate or pay (EQ-15, Charles 16/11): the owner's writes on the agency's
 * billing and on a contractor's file, the contractor's own on his file (identity and bank details, documents, his
 * acceptance of a text), a contest of an invoice and its end, and the threshold a report validates itself within. Each
 * asks for the password and the code given on this session in the last 10 minutes, before the body is read.
 */
describe('the sensitive gestures of billing and of a contractor’s file (EQ-15)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;

  const refusalOf = (response: { statusCode: number; json: () => unknown }): [number, string] => {
    const { code } = team.refusal(response);
    return [response.statusCode, code];
  };

  const staleConfirmations = () =>
    team.test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
  });

  afterAll(async () => {
    await team.close();
  });

  it('asks the owner again on every write of billing and of a contractor’s file', async () => {
    const guarded: readonly (readonly [Method, string])[] = [
      ['PUT', '/payroll/billing-settings'],
      ['PUT', '/payroll/billing-settings/accounts'],
      ['PUT', `/payroll/contractors/${theo.id}/profile`],
      ['POST', `/payroll/contractors/${theo.id}/profile/verify`],
      ['PUT', `/payroll/contractors/${theo.id}/profile/prefix`],
      ['POST', '/payroll/contract-texts'],
      ['POST', '/payroll/billing-regimes'],
      ['POST', `/payroll/billing-regimes/${newId(BillingRegimeIdSchema)}/validation`],
      ['POST', `/payroll/contractors/${theo.id}/regimes`],
      ['POST', `/payroll/contractors/${theo.id}/documents`],
      ['POST', `/payroll/contractors/${theo.id}/documents/${newId(ContractorDocumentIdSchema)}/review`],
      ['POST', `/payroll/invoices/${newId(InvoiceIdSchema)}/contest/refuse`],
      ['POST', `/payroll/invoices/${newId(InvoiceIdSchema)}/contest/uphold`],
      ['PUT', '/scheduling/report-gap'],
    ];
    await staleConfirmations();
    for (const [method, url] of guarded) {
      const response = await team.call(method, url, team.owner, {});
      expect([`${method} ${url}`, ...refusalOf(response)]).toEqual([
        `${method} ${url}`,
        403,
        'reauthentication_forbidden',
      ]);
    }
    // Reading stays open: only what writes asks again.
    expect((await team.call('GET', '/payroll/billing-settings', team.owner)).statusCode).toBe(200);
    expect((await team.call('GET', `/payroll/contractors/${theo.id}/file`, team.owner)).statusCode).toBe(200);
    // Nothing was written meanwhile.
    expect(await team.test.admin.db.select().from(schema.billingSettings)).toEqual([]);
  });

  it('asks the contractor again on his own file, his acceptance of a text and his contest', async () => {
    const guarded: readonly (readonly [Method, string])[] = [
      ['PUT', `/payroll/contractors/${theo.id}/profile`],
      ['POST', `/payroll/contractors/${theo.id}/documents`],
      ['POST', `/payroll/contract-texts/${newId(ContractTextIdSchema)}/accept`],
      ['POST', `/payroll/invoices/${newId(InvoiceIdSchema)}/contest`],
    ];
    await staleConfirmations();
    for (const [method, url] of guarded) {
      const response = await team.call(method, url, theoCookie, {});
      expect([`${method} ${url}`, ...refusalOf(response)]).toEqual([
        `${method} ${url}`,
        403,
        'reauthentication_forbidden',
      ]);
    }
    expect(await team.test.admin.db.select().from(schema.contractorProfiles)).toEqual([]);
  });

  it('leaves the gestures Charles kept free as they were, whatever the age of the confirmation', async () => {
    // « J'accepte » an invoice, a sale's decision and the validation of reports, each too frequent to ask (Charles
    // 16/11), and a logo, which reaches an invoice only through the settings' save.
    const free: readonly (readonly ['theo' | 'owner', Method, string])[] = [
      ['theo', 'POST', `/payroll/invoices/${newId(InvoiceIdSchema)}/accept`],
      ['owner', 'POST', '/payroll/sale-decisions'],
      ['owner', 'POST', '/scheduling/shift-reports/validate'],
      ['owner', 'POST', '/payroll/billing-settings/logos'],
    ];
    await staleConfirmations();
    for (const [who, method, url] of free) {
      const response = await team.call(method, url, who === 'theo' ? theoCookie : team.owner, {});
      expect([`${method} ${url}`, team.refusal(response).code]).not.toEqual([
        `${method} ${url}`,
        'reauthentication_forbidden',
      ]);
    }
  });

  it('lets the contractor’s write through once he gave his password and his code again', async () => {
    await staleConfirmations();
    // The password `addMember` gives every member it adds.
    theoCookie = await signIn(team.server, 'theo@example.test', 'staple battery horse');
    const saved = await team.call('PUT', `/payroll/contractors/${theo.id}/profile`, theoCookie, {
      legalName: 'Théo Inventé',
      address: '3 rue Imaginaire\n69001 Lyon',
      taxId: null,
      businessId: null,
      vatNumber: null,
      individualEntrepreneur: true,
      legalForm: null,
      shareCapitalMinor: null,
      rcsCity: null,
      email: 'theo@example.test',
    });
    expect(saved.statusCode, saved.body).toBe(201);
  });
});
