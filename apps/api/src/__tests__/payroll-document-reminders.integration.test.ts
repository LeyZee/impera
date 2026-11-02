import {
  BillingRegimeIdSchema,
  calendarDayAt,
  ContractorDocumentIdSchema,
  ContractorFileSchema,
  ContractorRegimeIdSchema,
  EVENT_PAYLOADS,
  newId,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { addDays } from '../modules/contractors/domain/billing';
import { transparentLogo } from '../modules/contractors/infra/__tests__/invented-png';

import { setUpInvoicing, type Invoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** The agency's zone, the scheduling's default: today is its calendar day. */
const ZONE = 'Europe/Paris';
const YEAR = 365 * 86_400_000;

describe('Équipe › Pièces du prestataire : le rappel avant l’échéance (EQ-06 lot 5c-2)', () => {
  let team: PayrollTeam;
  let invoicing: Invoicing;
  let lea: TeamMember;
  let theo: TeamMember;
  let kofi: TeamMember;
  let nina: TeamMember;
  let sam: TeamMember;

  const db = () => team.test.admin.db;
  const remind = () => team.app.modules.contractors.jobs.remindDocuments();
  const today = () => calendarDayAt(new Date(), ZONE);

  /** Benin's regime, under a tax treaty: it asks for a tax residence certificate. Its words are the test's. */
  const benin = newId(BillingRegimeIdSchema);

  const assign = (member: TeamMember, regimeId: string) =>
    db()
      .insert(schema.contractorRegimes)
      .values({
        id: newId(ContractorRegimeIdSchema),
        memberId: member.id,
        regimeId,
        effectiveFrom: '2025-01-01',
        createdBy: team.ownerId,
      });
  /** A document filed by its member, as the upload leaves it (its file is not read here). */
  const file = async (
    member: TeamMember,
    document: { kind: 'tax_residence' | 'urssaf_vigilance'; issuedOn: string; validUntil?: string },
    review?: 'accepted' | 'refused',
  ) => {
    const id = newId(ContractorDocumentIdSchema);
    await db()
      .insert(schema.contractorDocuments)
      .values({
        id,
        memberId: member.id,
        kind: document.kind,
        issuedOn: document.issuedOn,
        validUntil: document.validUntil ?? null,
        storageKey: `contractor-documents/${member.id}/${id}.pdf`,
        sha256: 'a'.repeat(64),
        retainUntil: new Date(Date.now() + 30 * 86_400_000),
        createdBy: member.userId,
      });
    if (review === 'accepted')
      await db()
        .insert(schema.contractorDocumentReviews)
        .values({
          documentId: id,
          decision: 'accepted',
          reviewedBy: team.ownerId,
          retainUntil: new Date(Date.now() + 11 * YEAR),
        });
    if (review === 'refused')
      await db().insert(schema.contractorDocumentReviews).values({
        documentId: id,
        decision: 'refused',
        reason: 'Illisible (motif inventé)',
        reviewedBy: team.ownerId,
      });
    return id;
  };
  /** What the owner was told, as the events hold it. */
  const told = async () =>
    (
      await db()
        .select({ payload: schema.domainEvents.payload })
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.type, 'contractor_document_expiring'))
        .orderBy(schema.domainEvents.createdAt, schema.domainEvents.id)
    ).map((row) => EVENT_PAYLOADS.contractor_document_expiring.parse(row.payload));

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: kofi } = await team.addMember('kofi@example.test', 'Kofi'));
    ({ member: nina } = await team.addMember('nina@example.test', 'Nina'));
    ({ member: sam } = await team.addMember('sam@example.test', 'Sam'));
    // The agency's settings (a delay of 30 days) and « France, TVA facturée », which asks for the URSSAF certificate.
    invoicing = await setUpInvoicing(team, { mediaType: 'image/png', bytes: transparentLogo(480, 160) }, []);
    await db()
      .insert(schema.billingRegimes)
      .values({
        id: benin,
        name: 'Bénin (texte inventé)',
        countries: ['BJ'],
        vatTreatment: 'reverse_charge',
        vatRateBps: 2_000,
        withholding: 'treaty_exempt',
        mentions: ['Autofacturation'],
        documents: ['tax_residence'],
        taxIdRequired: true,
        createdBy: team.ownerId,
      });
    await db().update(schema.teamMembers).set({ country: 'BJ' }).where(eq(schema.teamMembers.id, kofi.id));
    for (const member of [lea, theo, nina]) await assign(member, invoicing.regimeId);
    await assign(kofi, benin);
    // Sam has no regime: nothing is asked of him, nothing is reminded.
  });

  afterAll(() => team.close());

  it('says once each document that comes to its end, by ids and dates only, never a name', async () => {
    const day = today();
    const year = Number(day.slice(0, 4));
    // Léa's certificate ends in ten days: within the owner's 30 days.
    const leas = await file(lea, {
      kind: 'urssaf_vigilance',
      issuedOn: addDays(day, -170),
      validUntil: addDays(day, 10),
    });
    // Théo's ends in ten days too, but a newer one, still waiting for the owner's check, ends in six months.
    await file(theo, {
      kind: 'urssaf_vigilance',
      issuedOn: addDays(day, -170),
      validUntil: addDays(day, 10),
    });
    await file(theo, { kind: 'urssaf_vigilance', issuedOn: addDays(day, -1), validUntil: addDays(day, 180) });
    // Kofi's certificate of last year has ended; a newer one, refused, counts as none.
    const kofis = await file(
      kofi,
      { kind: 'tax_residence', issuedOn: `${String(year - 1)}-03-03` },
      'accepted',
    );
    await file(kofi, { kind: 'tax_residence', issuedOn: `${String(year)}-01-01` }, 'refused');
    // Nina's ends in 40 days: past the owner's delay. Sam's has ended, but no regime asks for it.
    const ninas = await file(nina, {
      kind: 'urssaf_vigilance',
      issuedOn: addDays(day, -140),
      validUntil: addDays(day, 40),
    });
    await file(sam, { kind: 'urssaf_vigilance', issuedOn: addDays(day, -200), validUntil: addDays(day, -5) });

    expect(await remind()).toBe(2);
    const said = await told();
    expect(said).toEqual(
      expect.arrayContaining([
        { memberId: lea.id, documentId: leas, kind: 'urssaf_vigilance', lastDay: addDays(day, 10) },
        { memberId: kofi.id, documentId: kofis, kind: 'tax_residence', lastDay: `${String(year - 1)}-12-31` },
      ]),
    );
    expect(said).toHaveLength(2);
    // Ids, a kind and a day: no field could carry a name or the file.
    for (const one of said)
      expect(Object.keys(one).sort()).toEqual(['documentId', 'kind', 'lastDay', 'memberId']);
    expect(await team.audited('contractor_document.remind')).toBe(2);

    // Said once: the next hour adds nothing, two runs at once neither.
    expect(await remind()).toBe(0);
    expect(await Promise.all([remind(), remind()])).toEqual([0, 0]);
    expect(await told()).toHaveLength(2);

    // The owner lengthens his delay: Nina's certificate is now within it, and said once.
    await db()
      .update(schema.billingSettings)
      .set({ documentReminderDays: 45 })
      .where(eq(schema.billingSettings.id, 1));
    expect(await remind()).toBe(1);
    expect((await told()).map((one) => one.documentId)).toContain(ninas);
  });

  it('says a new document once more when it comes to its end in its turn, and never a member who left', async () => {
    const day = today();
    // Léa files her new certificate, which ends in twenty days: a document of its own, said once.
    const renewed = await file(lea, {
      kind: 'urssaf_vigilance',
      issuedOn: day,
      validUntil: addDays(day, 20),
    });
    // Théo leaves; his newer certificate ends in ten days now that his record says so.
    await db()
      .update(schema.teamMembers)
      .set({ status: 'left', leftOn: day })
      .where(eq(schema.teamMembers.id, theo.id));
    await file(theo, { kind: 'urssaf_vigilance', issuedOn: day, validUntil: addDays(day, 10) });

    const before = (await told()).length;
    expect(await remind()).toBe(1);
    const said = await told();
    expect(said).toHaveLength(before + 1);
    expect(said.at(-1)).toEqual({
      memberId: lea.id,
      documentId: renewed,
      kind: 'urssaf_vigilance',
      lastDay: addDays(day, 20),
    });
    expect(said.some((one) => one.memberId === theo.id)).toBe(false);
  });

  it('asks « already said? » through the partial index of 0055, never across the whole outbox (Bilan on #357)', async () => {
    const plan = await db().transaction(async (tx) => {
      // Small tables read faster whole: with sequential scans off, the plan shows whether the index can answer at all.
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute(
        sql`explain select 1 from domain_events where domain_events.type = 'contractor_document_expiring' and domain_events.payload->>'documentId' = ${newId(ContractorDocumentIdSchema)} limit 1`,
      );
    });
    const lines = z.array(z.object({ 'QUERY PLAN': z.string() })).parse(plan.rows);
    expect(lines.map((line) => line['QUERY PLAN']).join('\n')).toContain(
      'domain_events_document_expiring_idx',
    );
  });

  it('shows in the file the first day of each followed document’s reminder, to the contractor as to the owner (lot 8)', async () => {
    const { member: ama, cookie: amaCookie } = await team.addMember('ama@example.test', 'Ama');
    const { member: yao, cookie: yaoCookie } = await team.addMember('yao@example.test', 'Yao');
    await db().update(schema.teamMembers).set({ country: 'BJ' }).where(eq(schema.teamMembers.id, yao.id));
    await assign(ama, invoicing.regimeId);
    await assign(yao, benin);
    const day = today();
    // Ama, under « France, TVA facturée »: an old certificate accepted, the current one waiting, a newer one refused,
    // and a certificate of residence her regime does not ask for.
    const old = await file(
      ama,
      { kind: 'urssaf_vigilance', issuedOn: addDays(day, -200), validUntil: addDays(day, -20) },
      'accepted',
    );
    const current = await file(ama, {
      kind: 'urssaf_vigilance',
      issuedOn: addDays(day, -10),
      validUntil: addDays(day, 170),
    });
    const refused = await file(
      ama,
      { kind: 'urssaf_vigilance', issuedOn: addDays(day, -5), validUntil: addDays(day, 175) },
      'refused',
    );
    const notAsked = await file(ama, { kind: 'tax_residence', issuedOn: day });
    // Yao, under Benin's regime: his certificate of residence is reminded from the 1st of December, whatever the delay.
    const residence = await file(yao, { kind: 'tax_residence', issuedOn: day }, 'accepted');
    // A delay the owner changed: the contractor, who may not read the settings, sees the same day as the owner.
    await db().update(schema.billingSettings).set({ documentReminderDays: 45 });
    const read = async (member: TeamMember, cookie: string) => {
      const response = await team.call('GET', `/payroll/contractors/${member.id}/file`, cookie);
      expect(response.statusCode, response.body).toBe(200);
      return ContractorFileSchema.parse(response.json());
    };
    const reminders = async (member: TeamMember, cookie: string) =>
      new Map((await read(member, cookie)).documents.map((one) => [one.id, one.remindFrom]));
    try {
      const amas = await read(ama, team.owner);
      expect(amas.today).toBe(day);
      expect(await reminders(ama, team.owner)).toEqual(
        new Map([
          [old, null],
          [current, addDays(day, 170 - 45)],
          [refused, null],
          [notAsked, null],
        ]),
      );
      expect(await read(ama, amaCookie)).toEqual(amas);
      expect(await reminders(yao, yaoCookie)).toEqual(new Map([[residence, `${day.slice(0, 4)}-12-01`]]));

      // A member who left is never reminded: his file says no day.
      await db()
        .update(schema.teamMembers)
        .set({ status: 'left', leftOn: day })
        .where(eq(schema.teamMembers.id, ama.id));
      expect([...(await reminders(ama, team.owner)).values()].every((one) => one === null)).toBe(true);
    } finally {
      await db().update(schema.billingSettings).set({ documentReminderDays: 30 });
    }
  });
});
