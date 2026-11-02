import {
  calendarDayAt,
  CONTRACTOR_DOCUMENTS_PENDING_MAX,
  ContractorDocumentIdSchema,
  ContractorDocumentSchema,
  newId,
  PendingContractorDocumentsSchema,
  type ContractorDocument,
  type TeamMember,
} from '@nirvana/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/payroll';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Invented files (ADR 0010): their first bytes say what they are, nothing more. */
const pdf = (words: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n% ${words}\n%%EOF\n`);

describe('Équipe › Pièces du prestataire : les pièces à examiner (EQ-06 lot 8)', () => {
  let team: PayrollTeam;
  let kofi: TeamMember;
  let ama: TeamMember;
  let kofiCookie: string;
  let amaCookie: string;
  let miaCookie: string;
  let today: string;

  const upload = async (cookie: string, member: TeamMember, query: Record<string, string>) => {
    const response = await team.server.inject({
      method: 'POST',
      url: `/v1/payroll/contractors/${member.id}/documents?${new URLSearchParams(query).toString()}`,
      headers: { cookie, origin: 'http://localhost:5173', 'content-type': 'application/octet-stream' },
      payload: Buffer.from(pdf(`${member.displayName} ${query['id'] ?? ''}`)),
    });
    expect(response.statusCode, response.body).toBe(201);
    return ContractorDocumentSchema.parse(response.json());
  };
  const residence = () => ({ id: newId(ContractorDocumentIdSchema), kind: 'tax_residence', issuedOn: today });
  const pending = (cookie: string, query = 'review=pending') =>
    team.call('GET', `/payroll/contractors/documents?${query}`, cookie);
  const waiting = async () => {
    const response = await pending(team.owner);
    expect(response.statusCode, response.body).toBe(200);
    const body: unknown = response.json();
    const list = PendingContractorDocumentsSchema.parse(body);
    // Nothing beyond the contract: no storage key, no file.
    expect(body).toEqual(list);
    return list;
  };
  const review = (document: ContractorDocument, body: object) =>
    team.call(
      'POST',
      `/payroll/contractors/${document.memberId}/documents/${document.id}/review`,
      team.owner,
      body,
    );

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: createMemoryInvoiceStore(), copy: createMemoryInvoiceStore() },
    });
    today = calendarDayAt(new Date(), 'Europe/Paris');
    ({ member: kofi, cookie: kofiCookie } = await team.addMember('kofi@example.test', 'Kofi'));
    ({ member: ama, cookie: amaCookie } = await team.addMember('ama@example.test', 'Ama'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
  });

  afterAll(() => team.close());

  it('lists to the owner alone, and only the documents waiting', async () => {
    expect((await pending(miaCookie)).statusCode).toBe(403);
    expect((await pending(kofiCookie)).statusCode).toBe(403);
    for (const query of ['', 'review=accepted', 'review=pending,refused'])
      expect([query, (await pending(team.owner, query)).statusCode]).toEqual([query, 400]);
    expect(await waiting()).toEqual({ documents: [], more: false });
  });

  it('gives every member’s documents without a check, the oldest filed first, with the name and never the file', async () => {
    const first = await upload(kofiCookie, kofi, residence());
    const second = await upload(amaCookie, ama, {
      id: newId(ContractorDocumentIdSchema),
      kind: 'urssaf_vigilance',
      issuedOn: today,
      validUntil: '2099-12-31',
    });
    // Filed by the owner on Kofi's file: it waits as well.
    const third = await upload(team.owner, kofi, residence());
    const list = await waiting();
    expect(list).toEqual({
      documents: [
        { ...first, displayName: 'Kofi' },
        { ...second, displayName: 'Ama' },
        { ...third, displayName: 'Kofi' },
      ],
      more: false,
    });

    // Checked, a document leaves the list: accepted or refused alike.
    expect((await review(first, { decision: 'accepted' })).statusCode).toBe(201);
    expect((await review(second, { decision: 'refused', reason: 'Illisible.' })).statusCode).toBe(201);
    expect((await waiting()).documents.map((one) => one.id)).toEqual([third.id]);
    expect((await review(third, { decision: 'refused', reason: 'En double.' })).statusCode).toBe(201);
    expect(await waiting()).toEqual({ documents: [], more: false });
  });

  it('gives the two hundred oldest at most, and says others wait', async () => {
    const filed: string[] = [];
    for (let rank = 0; rank <= CONTRACTOR_DOCUMENTS_PENDING_MAX; rank += 1)
      filed.push((await upload(amaCookie, ama, residence())).id);
    const list = await waiting();
    expect(list.more).toBe(true);
    expect(list.documents.map((one) => one.id)).toEqual(filed.slice(0, CONTRACTOR_DOCUMENTS_PENDING_MAX));
    const [oldest] = list.documents;
    if (oldest === undefined) throw new Error('no document');
    expect((await review(oldest, { decision: 'refused', reason: 'En double.' })).statusCode).toBe(201);
    const after = await waiting();
    expect(after.more).toBe(false);
    expect(after.documents.map((one) => one.id)).toEqual(filed.slice(1));
  });
});
