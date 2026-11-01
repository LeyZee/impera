import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractorRegimeIdSchema,
  EVENT_PAYLOADS,
  InvoiceAcceptanceViewSchema,
  JOB_MAX_ATTEMPTS,
  InvoiceIdSchema,
  newId,
  PayPeriodSchema,
  type InvoiceId,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { longDay } from '../modules/payroll/domain/invoices';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');
const Q5 = PayPeriodSchema.parse('2025-07-01');
const Q6 = PayPeriodSchema.parse('2025-07-16');
const Q7 = PayPeriodSchema.parse('2025-08-01');

const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };
/** The contractor's words: they never leave the Paie (ADR 0039 § 2). */
const REASON = 'Une vente du 3 manque';

describe('Équipe › Factures : l’acceptation, la contestation et ses deux fins (EQ-06 lot 6, ADR 0039)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let lea: TeamMember;
  let leaCookie: string;
  let noa: TeamMember;
  let noaCookie: string;
  let miaCookie: string;
  /** Pay's clock: the system's, unless a test issues in the past. */
  let shift = 0;

  const db = () => team.test.admin.db;
  const payroll = () => team.app.modules.payroll;

  /** Validates the member's statement of `period` and issues its invoice, `daysAgo` days ago by pay's clock. */
  async function issued(member: TeamMember, period: typeof Q1, daysAgo = 0): Promise<InvoiceId> {
    expect((await team.validate(team.owner, member, period)).statusCode).toBe(200);
    const { id } = await team.statementOf(member, period);
    shift = daysAgo * DAY;
    try {
      await payroll().jobs.issueInvoices(CommissionStatementIdSchema.parse(id), quiet);
    } finally {
      shift = 0;
    }
    // The statement's own invoice, never a corrective one it issued (ADR 0040).
    const [invoice] = await db()
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.statementId, id),
          eq(schema.invoices.kind, 'invoice'),
          sql`${schema.invoices.reissuedInvoiceId} is null`,
        ),
      );
    if (invoice === undefined) throw new Error('no invoice');
    return InvoiceIdSchema.parse(invoice.id);
  }

  /** The documents a statement issued, in the order of their numbers. */
  const documentsOf = (statementId: string) =>
    db()
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.statementId, statementId))
      .orderBy(schema.invoices.sequence);

  /** A document's lines, in their order. */
  const linesOf = (invoiceId: string) =>
    db()
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoiceId))
      .orderBy(schema.invoiceLines.position);

  /** Whether the job that renders `invoiceId`'s PDF is enqueued, as for any document (ADR 0037). */
  const renderQueued = async (invoiceId: string) =>
    (
      await db().execute(
        sql`select 1 from graphile_worker._private_jobs where key = ${`payroll.render_invoice_pdf:${invoiceId}`}`,
      )
    ).rows.length === 1;

  const send = (cookie: string, invoiceId: InvoiceId, step: string, payload?: object) =>
    team.call('POST', `/payroll/invoices/${invoiceId}/${step}`, cookie, payload);

  const view = (response: { json: () => unknown }) => InvoiceAcceptanceViewSchema.parse(response.json());

  const read = async (cookie: string, invoiceId: InvoiceId) => {
    const response = await team.call('GET', `/payroll/invoices/${invoiceId}/acceptance`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return view(response);
  };

  /** The jobs under `key`, with when each one starts. */
  const jobOf = async (key: string) => {
    const jobs = await db().execute<{ payload: unknown; run_at: string; max_attempts: number }>(
      sql`select payload, run_at, max_attempts from graphile_worker._private_jobs where key = ${key}`,
    );
    return jobs.rows.map((row) => ({ ...row, run_at: new Date(row.run_at) }));
  };

  const contestAlerts = (invoiceId: InvoiceId) =>
    db()
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.type, 'invoice_contested'),
          sql`${schema.domainEvents.payload}->>'invoiceId' = ${invoiceId}`,
        ),
      );

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      payrollClock: () => new Date(Date.now() - shift),
    });
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: noa, cookie: noaCookie } = await team.addMember('noa@example.test', 'Noa'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
      { member: noa, prefix: 'NOA', legalName: 'Noa Inventée' },
    ]);
    for (const member of [theo, lea, noa]) await invoicing.acceptMandate(member);
    for (const period of [Q1, Q2, Q3, Q4]) await team.report(theo, period, 10_000);
    for (const period of [Q1, Q2]) await team.report(lea, period, 10_000);
    await team.report(noa, Q1, 10_000);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('enqueues the tacit acceptance for the deadline in the issue, and lets the contractor alone accept, once', async () => {
    const id = await issued(theo, Q1);
    const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (invoice === undefined) throw new Error('no invoice');
    expect(await jobOf(`payroll.lapse_invoice:${id}`)).toEqual([
      {
        payload: { invoiceId: id },
        run_at: invoice.acceptanceDeadline,
        max_attempts: JOB_MAX_ATTEMPTS['payroll.lapse_invoice'],
      },
    ]);

    const pending = await read(theoCookie, id);
    expect(pending).toMatchObject({
      invoiceId: id,
      kind: 'invoice',
      memberId: theo.id,
      number: invoice.number,
      acceptance: { state: 'pending', deadline: invoice.acceptanceDeadline.toISOString(), reason: null },
      events: [{ kind: 'issued', by: null }],
    });
    // The owner and an active manager read it too; another contractor never.
    expect(await read(team.owner, id)).toEqual(pending);
    expect(await read(miaCookie, id)).toEqual(pending);
    const hidden = await team.call('GET', `/payroll/invoices/${id}/acceptance`, leaCookie);
    expect([hidden.statusCode, team.refusal(hidden).code]).toEqual([404, 'invoice_not_found']);
    const unknown = await team.call(
      'GET',
      `/payroll/invoices/${newId(InvoiceIdSchema)}/acceptance`,
      theoCookie,
    );
    expect([unknown.statusCode, team.refusal(unknown).code]).toEqual([404, 'invoice_not_found']);

    // Nobody answers in the contractor's place: not the owner, not a manager.
    for (const cookie of [team.owner, miaCookie]) {
      const refused = await send(cookie, id, 'accept');
      expect([refused.statusCode, team.refusal(refused).code]).toEqual([403, 'invoice_answer_forbidden']);
    }
    const elsewhere = await send(leaCookie, id, 'accept');
    expect([elsewhere.statusCode, team.refusal(elsewhere).code]).toEqual([404, 'invoice_not_found']);

    const accepted = await send(theoCookie, id, 'accept');
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(view(accepted)).toMatchObject({
      acceptance: { state: 'accepted', reason: null },
      events: [{ kind: 'issued' }, { kind: 'accepted', by: theo.userId, reason: null }],
    });
    // Sent again, the same answer gives back what was recorded; another one is refused.
    const again = await send(theoCookie, id, 'accept');
    expect([again.statusCode, view(again)]).toEqual([200, view(accepted)]);
    const late = await send(theoCookie, id, 'contest', { reason: REASON });
    expect([late.statusCode, team.refusal(late)]).toEqual([
      409,
      { code: 'invoice_acceptance_conflict', details: { state: 'accepted' } },
    ]);
    expect(await team.audited('invoice.accept')).toBe(1);
    const [audited] = await db()
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'invoice.accept'), eq(schema.auditLog.entityId, id)));
    expect(audited).toMatchObject({
      userId: theo.userId,
      entity: 'invoice',
      details: { number: invoice.number },
    });

    // Answered, the dated job does nothing when its time comes.
    expect(await payroll().jobs.lapseInvoice(id, quiet)).toBe('answered');
  });

  it('keeps the contest’s reason, tells the owner once without it, and lets the owner alone refuse it', async () => {
    await team.recalculate(Q2);
    const id = await issued(theo, Q2);

    const empty = await send(theoCookie, id, 'contest', { reason: '   ' });
    expect(empty.statusCode).toBe(400);

    const contested = await send(theoCookie, id, 'contest', { reason: `  ${REASON} ` });
    expect(contested.statusCode, contested.body).toBe(200);
    expect(view(contested)).toMatchObject({
      acceptance: { state: 'contested', reason: REASON },
      events: [{ kind: 'issued' }, { kind: 'contested', by: theo.userId, reason: REASON }],
    });
    const again = await send(theoCookie, id, 'contest', { reason: REASON });
    expect([again.statusCode, view(again)]).toEqual([200, view(contested)]);
    const other = await send(theoCookie, id, 'contest', { reason: 'Un autre motif' });
    expect([other.statusCode, team.refusal(other).code]).toEqual([409, 'invoice_acceptance_conflict']);

    // The alert goes through a job enqueued with the contest, once, whatever the number of runs.
    expect(await jobOf(`payroll.announce_invoice_contest:${id}`)).toEqual([
      expect.objectContaining({
        payload: { invoiceId: id },
        max_attempts: JOB_MAX_ATTEMPTS['payroll.announce_invoice_contest'],
      }),
    ]);
    expect(await contestAlerts(id)).toEqual([]);
    expect(await payroll().jobs.announceInvoiceContest(id, quiet)).toBe('published');
    expect(await payroll().jobs.announceInvoiceContest(id, quiet)).toBe('already');
    const alerts = await contestAlerts(id);
    expect(alerts).toHaveLength(1);
    const [alert] = alerts;
    expect(alert).toMatchObject({ creatorId: null, actor: 'system', correlationId: `invoice_contest:${id}` });
    expect(EVENT_PAYLOADS.invoice_contested.parse(alert?.payload)).toEqual({
      invoiceId: id,
      memberId: theo.id,
      number: view(contested).number,
      document: 'invoice',
    });
    // Neither the reason nor a name leaves the Paie.
    expect(JSON.stringify(alert?.payload)).not.toMatch(/vente|Théo|Inventé/u);
    expect(await team.audited('invoice.contest_alert')).toBe(1);

    // The contractor, a manager: only the owner ends a contest.
    for (const cookie of [theoCookie, miaCookie]) {
      const refused = await send(cookie, id, 'contest/refuse', { reason: 'La vente est du 18' });
      expect([refused.statusCode, team.refusal(refused).code]).toEqual([403, 'payroll_forbidden']);
    }
    const blank = await send(team.owner, id, 'contest/refuse', { reason: '' });
    expect(blank.statusCode).toBe(400);
    const refusal = await send(team.owner, id, 'contest/refuse', { reason: 'La vente est du 18' });
    expect(refusal.statusCode, refusal.body).toBe(200);
    expect(view(refusal)).toMatchObject({
      // The document keeps the contractor's words; the refusal's are its event's.
      acceptance: { state: 'contest_refused', reason: REASON },
      events: [
        { kind: 'issued' },
        { kind: 'contested', reason: REASON },
        { kind: 'contest_refused', by: team.ownerId, reason: 'La vente est du 18' },
      ],
    });
    const replay = await send(team.owner, id, 'contest/refuse', { reason: 'La vente est du 18' });
    expect([replay.statusCode, view(replay)]).toEqual([200, view(refusal)]);
    const changed = await send(team.owner, id, 'contest/refuse', { reason: 'Autre motif' });
    expect([changed.statusCode, team.refusal(changed)]).toEqual([
      409,
      { code: 'invoice_acceptance_conflict', details: { state: 'contest_refused' } },
    ]);
    expect([await team.audited('invoice.contest'), await team.audited('invoice.contest_refuse')]).toEqual([
      1, 1,
    ]);
    // A refusal publishes nothing more.
    expect(await contestAlerts(id)).toHaveLength(1);
  });

  it('accepts tacitly once the deadline has passed, and only then', async () => {
    // Issued ten days ago by pay's clock: seven days to answer, over three days ago.
    const late = await issued(lea, Q1, 10);
    for (const [step, payload] of [
      ['accept', undefined],
      ['contest', { reason: REASON }],
    ] as const) {
      const refused = await send(leaCookie, late, step, payload);
      expect([refused.statusCode, team.refusal(refused)]).toEqual([
        409,
        { code: 'invoice_acceptance_conflict', details: { state: 'pending' } },
      ]);
    }
    const [job] = await jobOf(`payroll.lapse_invoice:${late}`);
    expect(job?.run_at.getTime()).toBeLessThan(Date.now());
    expect(await payroll().jobs.lapseInvoice(late, quiet)).toBe('lapsed');
    expect(await payroll().jobs.lapseInvoice(late, quiet)).toBe('answered');
    expect(await read(leaCookie, late)).toMatchObject({
      acceptance: { state: 'tacitly_accepted', reason: null },
      events: [{ kind: 'issued' }, { kind: 'lapsed', by: null, reason: null }],
    });
    expect(await team.audited('invoice.lapse')).toBe(1);
    expect(await payroll().jobs.lapseInvoice(newId(InvoiceIdSchema), quiet)).toBe('not_found');
  });

  it('waits for the deadline again when its job runs early', async () => {
    await team.recalculate(Q2);
    const id = await issued(lea, Q2);
    const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (invoice === undefined) throw new Error('no invoice');
    // Started by hand before its time: nothing is written, the job waits for the deadline under the same key.
    await db().execute(
      sql`update graphile_worker._private_jobs set run_at = now() where key = ${`payroll.lapse_invoice:${id}`}`,
    );
    expect(await payroll().jobs.lapseInvoice(id, quiet)).toBe('early');
    expect(await jobOf(`payroll.lapse_invoice:${id}`)).toEqual([
      {
        payload: { invoiceId: id },
        run_at: invoice.acceptanceDeadline,
        max_attempts: JOB_MAX_ATTEMPTS['payroll.lapse_invoice'],
      },
    ]);
    expect((await read(leaCookie, id)).acceptance.state).toBe('pending');
    // The contractor still answers in time.
    const accepted = await send(leaCookie, id, 'accept');
    expect([accepted.statusCode, view(accepted).acceptance.state]).toEqual([200, 'accepted']);
  });

  it('says nothing of a contest the owner ended before its alert went out', async () => {
    await team.recalculate(Q3);
    const id = await issued(theo, Q3);
    expect((await send(theoCookie, id, 'contest', { reason: REASON })).statusCode).toBe(200);
    expect((await send(team.owner, id, 'contest/refuse', { reason: 'La vente est du 18' })).statusCode).toBe(
      200,
    );
    // The job ran late: the owner, who refused the contest, knows of it.
    expect(await payroll().jobs.announceInvoiceContest(id, quiet)).toBe('closed');
    expect(await contestAlerts(id)).toEqual([]);
    expect(await team.audited('invoice.contest_alert')).toBe(1);
  });

  it('catches up each hour what a job left undone: a tacit acceptance, an alert', async () => {
    // Noa's document, issued ten days ago, and Théo's contest, each without its job (lost, or failed for good).
    const late = await issued(noa, Q1, 10);
    await team.recalculate(Q4);
    const contested = await issued(theo, Q4);
    expect((await send(theoCookie, contested, 'contest', { reason: REASON })).statusCode).toBe(200);
    for (const key of [`payroll.lapse_invoice:${late}`, `payroll.announce_invoice_contest:${contested}`]) {
      await db().execute(sql`delete from graphile_worker._private_jobs where key = ${key}`);
      expect(await jobOf(key)).toEqual([]);
    }

    // Answered documents, ended contests and alerts already said are left as they are.
    expect(await payroll().jobs.sweepInvoiceAcceptance(quiet)).toEqual({
      lapsed: 1,
      announced: 1,
      failed: 0,
    });
    expect(await read(noaCookie, late)).toMatchObject({
      acceptance: { state: 'tacitly_accepted' },
      events: [{ kind: 'issued' }, { kind: 'lapsed', by: null }],
    });
    const alerts = await contestAlerts(contested);
    expect(alerts).toEqual([expect.objectContaining({ creatorId: null, actor: 'system' })]);
    expect(EVENT_PAYLOADS.invoice_contested.parse(alerts[0]?.payload).memberId).toBe(theo.id);
    expect(await payroll().jobs.sweepInvoiceAcceptance(quiet)).toEqual({
      lapsed: 0,
      announced: 0,
      failed: 0,
    });
  });

  /** The adjustments that correct document `invoiceId`, negative first. */
  const correctionOf = (invoiceId: InvoiceId) =>
    db()
      .select()
      .from(schema.payAdjustments)
      .where(eq(schema.payAdjustments.contestedInvoiceId, invoiceId))
      .orderBy(schema.payAdjustments.amountMinor);

  it('upholds a contest with the cancel and reissue of the invoice: its cancel and a corrective invoice, under its regime (ADR 0040)', async () => {
    // Léa's first half of July, contested for an error of text; her second half is open, a draft. (June is closed.)
    await team.report(lea, Q5, 10_000);
    await team.recalculate(Q5);
    const id = await issued(lea, Q5);
    const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (invoice === undefined) throw new Error('no invoice');
    expect((await send(leaCookie, id, 'contest', { reason: 'Mon adresse est fausse' })).statusCode).toBe(200);
    await team.report(lea, Q6, 10_000);
    await team.recalculate(Q6);

    const body = { reason: '  Adresse corrigée dans le dossier ', correction: { kind: 'reissue' } };
    // Only the owner ends a contest: neither its contractor nor a manager.
    for (const cookie of [leaCookie, miaCookie]) {
      const refused = await send(cookie, id, 'contest/uphold', body);
      expect([refused.statusCode, team.refusal(refused).code]).toEqual([403, 'payroll_forbidden']);
    }
    const unknown = await send(team.owner, newId(InvoiceIdSchema), 'contest/uphold', body);
    expect([unknown.statusCode, team.refusal(unknown).code]).toEqual([404, 'invoice_not_found']);
    for (const wrong of [
      { ...body, reason: ' ' },
      { reason: 'Montant', correction: { kind: 'amount', amountMinor: 0 } },
      { reason: 'Montant', correction: { kind: 'amount', amountMinor: 12.5 } },
      { reason: 'Rien' },
    ]) {
      expect((await send(team.owner, id, 'contest/uphold', wrong)).statusCode).toBe(400);
    }
    const adjustmentsBefore = await team.audited('pay_adjustment.create');

    const upheld = await send(team.owner, id, 'contest/uphold', body);
    expect(upheld.statusCode, upheld.body).toBe(200);
    expect(view(upheld)).toMatchObject({
      // The document keeps the contractor's words; the owner's are its event's.
      acceptance: { state: 'contest_upheld', reason: 'Mon adresse est fausse' },
      events: [
        { kind: 'issued' },
        { kind: 'contested' },
        { kind: 'contest_upheld', by: team.ownerId, reason: 'Adresse corrigée dans le dossier' },
      ],
    });
    // The pair, of what the invoice bills, on Léa's first open period, correcting the period of the invoice.
    const corrected = (await team.statementOf(lea, Q5)).id;
    const which = `la facture ${invoice.number} du ${longDay(invoice.issuedOn)}`;
    const pair = await correctionOf(id);
    expect(
      pair.map((one) => [one.memberId, one.period, one.amountMinor, one.correctsStatementId, one.createdBy]),
    ).toEqual([
      [lea.id, Q6, -invoice.exclVatMinor, corrected, team.ownerId],
      [lea.id, Q6, invoice.exclVatMinor, corrected, team.ownerId],
    ]);
    expect(pair.map((one) => one.reason)).toEqual([`Annulation de ${which}`, `Refacturation de ${which}`]);
    expect(await team.audited('invoice.contest_uphold')).toBe(1);
    expect(await team.audited('pay_adjustment.create')).toBe(adjustmentsBefore + 2);
    expect(await team.jobsFor(Q6)).not.toEqual([]);

    // Sent again, the same uphold gives back what was recorded; another correction, or a refusal, is a conflict.
    const again = await send(team.owner, id, 'contest/uphold', body);
    expect([again.statusCode, view(again)]).toEqual([200, view(upheld)]);
    for (const [step, payload] of [
      ['contest/uphold', { ...body, correction: { kind: 'amount', amountMinor: 500 } }],
      ['contest/refuse', { reason: 'Finalement non' }],
    ] as const) {
      const other = await send(team.owner, id, step, payload);
      expect([other.statusCode, team.refusal(other)]).toEqual([
        409,
        { code: 'invoice_acceptance_conflict', details: { state: 'contest_upheld' } },
      ]);
    }
    expect(await correctionOf(id)).toHaveLength(2);

    // Ended before its alert went out: the job and the hourly sweep leave it, without waiting on its lock.
    const held = await team.holding([`invoices.acceptance:${id}`]);
    try {
      expect(await payroll().jobs.sweepInvoiceAcceptance(quiet)).toEqual({
        lapsed: 0,
        announced: 0,
        failed: 0,
      });
    } finally {
      await held.release();
    }
    expect(await payroll().jobs.announceInvoiceContest(id, quiet)).toBe('closed');

    // Léa leaves the regime of her July invoice before her second half is issued: from that day, another VAT.
    const exempt = newId(BillingRegimeIdSchema);
    await db()
      .insert(schema.billingRegimes)
      .values({
        id: exempt,
        name: 'France, franchise en base',
        countries: ['FR'],
        vatTreatment: 'exempt',
        vatRateBps: null,
        withholding: 'none',
        mentions: ['Autofacturation', 'TVA non applicable, art. 293 B du CGI'],
        documents: ['urssaf_vigilance'],
        taxIdRequired: true,
        createdBy: team.ownerId,
      });
    await db()
      .insert(schema.billingRegimeValidations)
      .values({ regimeId: exempt, validatedOn: '2025-01-01', recordedBy: team.ownerId });
    await db()
      .insert(schema.contractorRegimes)
      .values({
        id: newId(ContractorRegimeIdSchema),
        memberId: lea.id,
        regimeId: exempt,
        effectiveFrom: invoice.issuedOn,
        createdBy: team.ownerId,
      });

    // Léa's second half of July: its own invoice under the regime of the day; then the cancel, citing the July
    // invoice, and the corrective invoice of the same amount, numbered next, under the July invoice's regime.
    await team.recalculate(Q6);
    const own = await issued(lea, Q6);
    const second = (await team.statementOf(lea, Q6)).id;
    const [regular, cancel, corrective, ...more] = await documentsOf(second);
    if (regular === undefined || cancel === undefined || corrective === undefined) throw new Error('no pair');
    expect(more).toEqual([]);
    expect(regular).toMatchObject({ id: own, kind: 'invoice', period: Q6, regimeId: exempt, vatMinor: 0 });
    expect((await linesOf(own)).some((line) => line.detail?.includes('Refacturation') ?? false)).toBe(false);
    expect(cancel).toMatchObject({
      kind: 'credit_note',
      creditedInvoiceId: id,
      reissuedInvoiceId: id,
      period: Q5,
      regimeId: invoice.regimeId,
      exclVatMinor: -invoice.exclVatMinor,
      vatMinor: -invoice.vatMinor,
    });
    expect(corrective).toMatchObject({
      kind: 'invoice',
      creditedInvoiceId: null,
      reissuedInvoiceId: id,
      period: Q5,
      regimeId: invoice.regimeId,
      regime: invoice.regime,
      exclVatMinor: invoice.exclVatMinor,
      vatMinor: invoice.vatMinor,
      inclVatMinor: invoice.inclVatMinor,
      sequence: cancel.sequence + 1,
    });
    // Its own first mention, the regime's as the July invoice froze them, then its own payment terms.
    expect(corrective.mentions.slice(0, -1)).toEqual([
      `Facture rectificative de la facture ${invoice.number} du ${longDay(invoice.issuedOn)}`,
      ...invoice.mentions.slice(0, -1),
    ]);
    expect(corrective.mentions.at(-1)).toMatch(/^Échéance/u);
    const [line, ...otherLines] = await linesOf(corrective.id);
    expect(otherLines).toEqual([]);
    expect([line?.kind, line?.amountMinor]).toEqual(['adjustment', invoice.exclVatMinor]);
    expect(line?.detail).toContain(`Refacturation de ${which}`);
    // Each rendered and kept as any document (ADR 0037).
    for (const one of [cancel, corrective]) expect(await renderQueued(one.id)).toBe(true);

    // A credit note is never cancelled and reissued: upholding its contest so is refused, with the reason, before
    // anything is written.
    const cancelId = InvoiceIdSchema.parse(cancel.id);
    expect(
      (await send(leaCookie, cancelId, 'contest', { reason: 'Cet avoir me retire tout' })).statusCode,
    ).toBe(200);
    const notReissued = await send(team.owner, cancelId, 'contest/uphold', body);
    expect([notReissued.statusCode, team.refusal(notReissued)]).toEqual([
      422,
      { code: 'invoice_correction_unprocessable', details: { reason: 'reissue_credit_note' } },
    ]);
    expect(await correctionOf(cancelId)).toEqual([]);
    expect((await read(leaCookie, cancelId)).acceptance.state).toBe('contested');
    // What the cancel took off counts: nothing is left of the July invoice, and no credit note of an amount on it.
    const tooMuch = await send(team.owner, cancelId, 'contest/uphold', {
      reason: 'Avoir de trop',
      correction: { kind: 'amount', amountMinor: -1 },
    });
    expect([tooMuch.statusCode, team.refusal(tooMuch)]).toEqual([
      422,
      { code: 'credit_note_amount_unprocessable', details: { leftMinor: 0 } },
    ]);
    expect(await correctionOf(cancelId)).toEqual([]);

    // Nothing is left of the invoice now: the same uphold sent again is still the one recorded.
    const replay = await send(team.owner, id, 'contest/uphold', body);
    expect([replay.statusCode, view(replay)]).toEqual([200, view(upheld)]);

    // The corrective invoice stays an invoice: contested in its turn, it is cancelled and billed again. Its pair
    // corrects the period it bills, July's first half, never the statement that issued it, and lands on Léa's first
    // open period; its own corrective invoice keeps July's period and regime, whatever the regime of the day.
    const replacing = InvoiceIdSchema.parse(corrective.id);
    expect(
      (await send(leaCookie, replacing, 'contest', { reason: 'Mon nom est mal écrit' })).statusCode,
    ).toBe(200);
    await team.report(lea, Q7, 10_000);
    await team.recalculate(Q7);
    const upheldTwice = await send(team.owner, replacing, 'contest/uphold', {
      ...body,
      reason: 'Nom corrigé',
    });
    expect(upheldTwice.statusCode, upheldTwice.body).toBe(200);
    const twice = `la facture ${corrective.number} du ${longDay(corrective.issuedOn)}`;
    expect(
      (await correctionOf(replacing)).map((one) => [
        one.period,
        one.amountMinor,
        one.correctsStatementId,
        one.reason,
      ]),
    ).toEqual([
      [Q7, -invoice.exclVatMinor, corrected, `Annulation de ${twice}`],
      [Q7, invoice.exclVatMinor, corrected, `Refacturation de ${twice}`],
    ]);
    await team.recalculate(Q7);
    await issued(lea, Q7);
    const [, recancel, recorrective, ...rest] = await documentsOf((await team.statementOf(lea, Q7)).id);
    expect(rest).toEqual([]);
    expect(recancel).toMatchObject({
      kind: 'credit_note',
      creditedInvoiceId: replacing,
      reissuedInvoiceId: replacing,
    });
    expect(recorrective).toMatchObject({
      kind: 'invoice',
      reissuedInvoiceId: replacing,
      period: Q5,
      regimeId: invoice.regimeId,
      exclVatMinor: invoice.exclVatMinor,
    });
    expect(recorrective?.mentions[0]).toBe(
      `Facture rectificative de la facture ${corrective.number} du ${longDay(corrective.issuedOn)}`,
    );
  });

  it('upholds a contest with an amount, in either favour, never crediting the invoice below zero', async () => {
    // Théo's second half of June, contested and said to the owner: he has no draft, the correction goes on the team's
    // first open period.
    const [contested] = await db()
      .select({ id: schema.invoices.id, exclVatMinor: schema.invoices.exclVatMinor })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.memberId, theo.id),
          eq(schema.invoices.period, Q4),
          eq(schema.invoices.kind, 'invoice'),
        ),
      );
    if (contested === undefined) throw new Error('no invoice');
    const id = InvoiceIdSchema.parse(contested.id);
    expect((await read(theoCookie, id)).acceptance.state).toBe('contested');

    const tooMuch = await send(team.owner, id, 'contest/uphold', {
      reason: 'Vente remboursée',
      correction: { kind: 'amount', amountMinor: -(contested.exclVatMinor + 1) },
    });
    expect([tooMuch.statusCode, team.refusal(tooMuch)]).toEqual([
      422,
      { code: 'credit_note_amount_unprocessable', details: { leftMinor: contested.exclVatMinor } },
    ]);
    expect(await correctionOf(id)).toEqual([]);
    expect((await read(theoCookie, id)).acceptance.state).toBe('contested');

    const upheld = await send(team.owner, id, 'contest/uphold', {
      reason: 'La vente du 3 manquait',
      correction: { kind: 'amount', amountMinor: 1_500 },
    });
    expect(upheld.statusCode, upheld.body).toBe(200);
    expect(view(upheld).acceptance.state).toBe('contest_upheld');
    expect(await correctionOf(id)).toEqual([
      expect.objectContaining({
        memberId: theo.id,
        amountMinor: 1_500,
        reason: 'La vente du 3 manquait',
        correctsStatementId: (await team.statementOf(theo, Q4)).id,
        contestedInvoiceId: id,
      }),
    ]);
  });
});
