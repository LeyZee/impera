import {
  ApiErrorSchema,
  BonusIdSchema,
  BonusSchema,
  calendarDayAt,
  CommissionStatementSchema,
  newId,
  nextPayPeriod,
  PayAdjustmentIdSchema,
  PayAdjustmentSchema,
  payPeriodAt,
  PayPeriodSchema,
  PenaltyIdSchema,
  PenaltySchema,
  TeamMemberIdSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');
const Q5 = PayPeriodSchema.parse('2025-07-01');
const Q6 = PayPeriodSchema.parse('2025-07-16');
const Q7 = PayPeriodSchema.parse('2025-08-01');

describe('Équipe › Paie : primes, malus, ajustements et paiement (EQ-04, ADR 0032 et 0035)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let monaCookie: string;
  let penaltyId: string;

  const post = (url: string, cookie: string, payload: object = {}) => team.call('POST', url, cookie, payload);

  const bonus = (member: TeamMember, period: PayPeriod, patch: object = {}) => ({
    id: newId(BonusIdSchema),
    memberId: member.id,
    period,
    amountMinor: 2_000,
    reason: 'Renfort du samedi',
    ...patch,
  });

  const waiting = () => team.waiting();
  const until = (check: () => Promise<boolean>) => team.until(check);
  const holding = (keys: readonly string[]) => team.holding(keys);
  const memberPeriod = (member: TeamMember, period: PayPeriod) =>
    `payroll.member_period:${member.id}:${period}`;
  const today = () => payPeriodAt(new Date(), 'Europe/Paris');

  const audited = (action: string) => team.audited(action);

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: mona, cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
  });

  afterAll(() => team.close());

  it('waits for the closing’s lock while no period is closed, and gives a bonus back on a retry', async () => {
    const body = bonus(theo, Q1);
    const lock = await holding(['payroll.close']);
    const sent = post('/payroll/bonuses', monaCookie, body);
    try {
      await until(async () => (await waiting()) === 1);
    } finally {
      await lock.release();
    }
    const created = await sent;
    expect(created.statusCode, created.body).toBe(201);
    expect(BonusSchema.parse(created.json())).toMatchObject({
      ...body,
      createdBy: mona.userId,
      cancellation: null,
    });
    expect(await team.jobsFor(Q1)).toEqual([{ period: Q1 }]);
    expect(await audited('bonus.create')).toBe(1);

    // The same bonus sent again is given back; the same id with other values is refused.
    const again = await post('/payroll/bonuses', monaCookie, body);
    expect([again.statusCode, again.json()]).toEqual([200, created.json()]);
    const other = await post('/payroll/bonuses', monaCookie, { ...body, amountMinor: 3_000 });
    expect(team.refusal(other).code).toBe('bonus_conflict');
    expect(await audited('bonus.create')).toBe(1);
  });

  it('lets the owner or an active manager write a member’s pay, never their own', async () => {
    const refused = async (cookie: string, payload: object) =>
      team.refusal(await post('/payroll/bonuses', cookie, payload)).code;
    expect(await refused(theoCookie, bonus(lea, Q1))).toBe('payroll_forbidden');
    expect(await refused(monaCookie, bonus(mona, Q1))).toBe('payroll_own_forbidden');
    expect(await refused(team.owner, { ...bonus(lea, Q1), memberId: newId(TeamMemberIdSchema) })).toBe(
      'team_member_not_found',
    );
    // A slip of the year: a bonus goes no further than the next period.
    const far = await post('/payroll/bonuses', team.owner, bonus(lea, nextPayPeriod(nextPayPeriod(today()))));
    expect([far.statusCode, team.refusal(far).code]).toEqual([400, 'request_invalid']);
    // Before Léa joined: nothing is owed then, and that is what is said, not a missing rate.
    const early = await post('/payroll/bonuses', team.owner, bonus(lea, PayPeriodSchema.parse('2024-12-16')));
    const { code, message } = ApiErrorSchema.parse(early.json()).error;
    expect([code, message]).toEqual([
      'pay_period_closed_conflict',
      'Cette quinzaine est d’avant l’arrivée de ce membre',
    ]);
  });

  it('cancels a bonus once, and the same answer after', async () => {
    const [found] = await team.test.admin.db.select({ id: schema.bonuses.id }).from(schema.bonuses);
    if (found === undefined) throw new Error('no bonus');
    const { id } = found;
    expect(team.refusal(await post(`/payroll/bonuses/${id}/cancel`, theoCookie)).code).toBe(
      'payroll_own_forbidden',
    );
    const cancelled = await post(`/payroll/bonuses/${id}/cancel`, monaCookie);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(BonusSchema.parse(cancelled.json()).cancellation).toMatchObject({ cancelledBy: mona.userId });
    const again = await post(`/payroll/bonuses/${id}/cancel`, team.owner);
    expect([again.statusCode, again.json()]).toEqual([200, cancelled.json()]);
    expect(await audited('bonus.cancel')).toBe(1);
    expect(team.refusal(await post(`/payroll/bonuses/${newId(BonusIdSchema)}/cancel`, team.owner)).code).toBe(
      'bonus_not_found',
    );
  });

  it('refuses an entry on a period closed for the member, never on one still open for them', async () => {
    await team.report(theo, Q2, 10_000);
    await team.report(lea, Q2, 10_000);
    await team.recalculate(Q2);
    // The first closing: the bonus cancelled in May no longer holds it back.
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);

    const closed = await post('/payroll/bonuses', monaCookie, bonus(theo, Q2));
    expect(team.refusal(closed)).toEqual(
      expect.objectContaining({ code: 'pay_period_closed_conflict', details: { period: Q2 } }),
    );
    // Before the team's first closing, every period is closed for good.
    expect(team.refusal(await post('/payroll/bonuses', monaCookie, bonus(lea, Q1))).code).toBe(
      'pay_period_closed_conflict',
    );
    // Closed for the team, open for Léa: her statement of the period is still a draft, and counts it.
    expect((await post('/payroll/bonuses', monaCookie, bonus(lea, Q2))).statusCode).toBe(201);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    expect((await team.statementOf(lea, Q2)).bonusesMinor).toBe(2_000);

    const penalty = {
      id: newId(PenaltyIdSchema),
      memberId: theo.id,
      fromPeriod: Q2,
      toPeriod: Q4,
      amount: { kind: 'fixed', amountMinor: 500 },
      reason: 'Retard au shift',
    };
    expect(team.refusal(await post('/payroll/penalties', monaCookie, penalty))).toEqual(
      expect.objectContaining({ code: 'pay_period_closed_conflict', details: { period: Q2 } }),
    );
    const created = await post('/payroll/penalties', monaCookie, { ...penalty, fromPeriod: Q3 });
    expect(created.statusCode, created.body).toBe(201);
    penaltyId = PenaltySchema.parse(created.json()).id;
    expect(await team.jobsFor(Q4)).toEqual([{ period: Q4 }]);
    const again = await post('/payroll/penalties', monaCookie, { ...penalty, fromPeriod: Q3 });
    expect([again.statusCode, again.json()]).toEqual([200, created.json()]);
    const other = { ...penalty, fromPeriod: Q3, amount: { kind: 'percent', bps: 500 } };
    expect(team.refusal(await post('/payroll/penalties', monaCookie, other)).code).toBe('penalty_conflict');
  });

  it('refuses a period closed for the member before taking any lock (ADR 0035)', async () => {
    // Another transaction holds Théo's lock on Q2, which his validation closed: a write that took it would wait.
    const held = await holding([memberPeriod(theo, Q2)]);
    const answered = async (url: string, payload: object) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('The write waited for a lock'));
        }, 2_000);
      });
      try {
        return team.refusal(await Promise.race([post(url, monaCookie, payload), waited]));
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      expect(await answered('/payroll/bonuses', bonus(theo, Q2))).toEqual(
        expect.objectContaining({ code: 'pay_period_closed_conflict', details: { period: Q2 } }),
      );
      const penalty = {
        id: newId(PenaltyIdSchema),
        memberId: theo.id,
        fromPeriod: Q2,
        toPeriod: Q2,
        amount: { kind: 'fixed', amountMinor: 500 },
        reason: 'Retard au shift',
      };
      expect((await answered('/payroll/penalties', penalty)).code).toBe('pay_period_closed_conflict');
      expect(await waiting()).toBe(0);
    } finally {
      await held.release();
    }
  });

  it('cancels a penalty from the member’s first open period, and not when every period is closed', async () => {
    await team.report(theo, Q3, 10_000);
    await team.recalculate(Q3);
    expect((await team.validate(team.owner, theo, Q3)).statusCode).toBe(200);
    expect((await team.statementOf(theo, Q3)).penaltiesMinor).toBe(500);

    const cancelled = await post(`/payroll/penalties/${penaltyId}/cancel`, team.owner);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(PenaltySchema.parse(cancelled.json()).cancellation).toMatchObject({
      cancelledBy: team.ownerId,
      cancelledFrom: Q4,
    });
    const again = await post(`/payroll/penalties/${penaltyId}/cancel`, monaCookie);
    expect([again.statusCode, again.json()]).toEqual([200, cancelled.json()]);

    const percent = {
      id: newId(PenaltyIdSchema),
      memberId: theo.id,
      fromPeriod: Q4,
      toPeriod: Q4,
      amount: { kind: 'percent', bps: 1_000 },
      reason: 'Réponses en retard',
    };
    expect((await post('/payroll/penalties', monaCookie, percent)).statusCode).toBe(201);
    await team.report(theo, Q4, 10_000);
    await team.report(lea, Q4, 10_000);
    await team.recalculate(Q4);
    expect((await team.validate(team.owner, theo, Q4)).statusCode).toBe(200);
    // 10 % of Théo's 80 € net.
    expect((await team.statementOf(theo, Q4)).penaltiesMinor).toBe(800);
    expect(team.refusal(await post(`/payroll/penalties/${percent.id}/cancel`, monaCookie)).code).toBe(
      'penalty_cancel_conflict',
    );
  });

  it('puts an adjustment on the member’s first open period, correcting a statement already validated', async () => {
    const corrected = await team.statementOf(theo, Q3);
    const body = {
      id: newId(PayAdjustmentIdSchema),
      memberId: theo.id,
      amountMinor: -100,
      reason: 'Vente remboursée par la plateforme',
      correctsStatementId: corrected.id,
    };
    const created = await post('/payroll/adjustments', monaCookie, body);
    expect(created.statusCode, created.body).toBe(201);
    // Théo's statements are validated up to June: the team's first open period.
    expect(PayAdjustmentSchema.parse(created.json())).toMatchObject({ ...body, period: Q5 });
    const again = await post('/payroll/adjustments', monaCookie, body);
    expect([again.statusCode, again.json()]).toEqual([200, created.json()]);
    expect(
      team.refusal(await post('/payroll/adjustments', monaCookie, { ...body, amountMinor: 1_000 })).code,
    ).toBe('pay_adjustment_conflict');

    // Léa's June statement is still a draft, in a period the team closed: her next statement to validate.
    const leas = await post('/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: lea.id,
      amountMinor: 1_500,
      reason: 'Oubli du 20 juin',
    });
    expect(PayAdjustmentSchema.parse(leas.json())).toMatchObject({ period: Q4, correctsStatementId: null });
    expect(await team.jobsFor(Q4)).toContainEqual({ period: Q4 });

    const correcting = (statementId: string) =>
      post('/payroll/adjustments', team.owner, {
        id: newId(PayAdjustmentIdSchema),
        memberId: lea.id,
        amountMinor: 100,
        reason: 'Correction',
        correctsStatementId: statementId,
      });
    expect(team.refusal(await correcting((await team.statementOf(lea, Q4)).id)).code).toBe(
      'commission_statement_status_conflict',
    );
    expect(team.refusal(await correcting(corrected.id)).code).toBe('commission_statement_not_found');
  });

  it('lets the owner alone pay a validated statement, once, saying how', async () => {
    const { id, revision, payableMinor } = await team.statementOf(theo, Q2);
    const payment = { revision, paidOn: '2025-06-02', method: 'worldremit', sentMinor: payableMinor };
    const pay = (cookie: string, patch: Record<string, unknown> = {}) =>
      post(`/payroll/statements/${id}/pay`, cookie, { ...payment, ...patch });
    expect(team.refusal(await pay(monaCookie)).code).toBe('payroll_forbidden');
    expect(team.refusal(await pay(theoCookie)).code).toBe('payroll_forbidden');
    expect(team.refusal(await pay(team.owner, { revision: revision + 1 })).code).toBe(
      'commission_statement_changed_conflict',
    );
    // A transfer to come, one before the period began (a slip of the year), another amount, a method off the list
    // (0031's default ones included: WorldRemit only), no amount, an IBAN for a reference: nothing is written.
    const later = calendarDayAt(new Date(Date.now() + 2 * 86_400_000), 'Europe/Paris');
    expect(team.refusal(await pay(team.owner, { paidOn: later })).code).toBe(
      'payment_in_future_unprocessable',
    );
    for (const paidOn of ['2015-06-02', '2025-05-15'])
      expect(team.refusal(await pay(team.owner, { paidOn }))).toEqual({
        code: 'payment_before_period_unprocessable',
        details: { period: Q2 },
      });
    expect(team.refusal(await pay(team.owner, { sentMinor: payableMinor + 1 }))).toEqual({
      code: 'payment_amount_unprocessable',
      details: { payableMinor },
    });
    for (const method of ['cash', 'bank_transfer', 'wise', 'paypal', 'other'])
      expect((await pay(team.owner, { method })).statusCode, method).toBe(400);
    expect((await pay(team.owner, { sentMinor: undefined })).statusCode).toBe(400);
    expect(
      (await pay(team.owner, { reference: 'Transfert FR62 1234 5678 9000 00AB C123 456' })).statusCode,
    ).toBe(400);
    expect((await team.statementOf(theo, Q2)).status).toBe('validated');

    const paid = await pay(team.owner, { reference: '  WR-0412 ' });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(CommissionStatementSchema.parse(paid.json())).toMatchObject({
      status: 'paid',
      paidBy: team.ownerId,
      payment: {
        paidOn: '2025-06-02',
        method: 'worldremit',
        reference: 'WR-0412',
        sentMinor: payableMinor,
      },
    });
    expect(team.refusal(await pay(team.owner)).code).toBe('commission_statement_status_conflict');
    expect(await audited('commission_statement.pay')).toBe(1);

    const draft = await team.statementOf(lea, Q4);
    const refused = await post(`/payroll/statements/${draft.id}/pay`, team.owner, {
      ...payment,
      revision: draft.revision,
    });
    expect(team.refusal(refused).code).toBe('commission_statement_status_conflict');
  });

  it('makes a bonus wait for a validation of the same member, then refuses it', async () => {
    await team.report(theo, Q5, 10_000);
    await team.recalculate(Q5);
    const lock = await holding([memberPeriod(theo, Q5)]);
    const validating = team.validate(team.owner, theo, Q5);
    let sent: ReturnType<typeof post> | undefined;
    try {
      await until(async () => (await waiting()) === 1);
      sent = post('/payroll/bonuses', monaCookie, bonus(theo, Q5));
      await until(async () => (await waiting()) === 2);
    } finally {
      await lock.release();
    }
    const [validated, refused] = await Promise.all([validating, sent]);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(team.refusal(refused)).toEqual(
      expect.objectContaining({ code: 'pay_period_closed_conflict', details: { period: Q5 } }),
    );

    // Once a period is closed, an entry never waits for the closing's lock.
    const closing = await holding(['payroll.close']);
    try {
      expect((await post('/payroll/bonuses', monaCookie, bonus(lea, Q6))).statusCode).toBe(201);
    } finally {
      await closing.release();
    }
  });

  it('makes a later validation wait for a bonus on an earlier period, then asks for that period first', async () => {
    // Nina closes July's second half; Théo has nothing in it, it stays open for him.
    const { member: nina } = await team.addMember('nina@example.test', 'Nina');
    await team.report(nina, Q6, 10_000);
    await team.recalculate(Q6);
    expect((await team.validate(team.owner, nina, Q6)).statusCode).toBe(200);
    await team.report(theo, Q7, 10_000);
    await team.recalculate(Q7);

    // The bonus holds Théo's periods from July's second half on, and waits for today's.
    const lock = await holding([memberPeriod(theo, today())]);
    const sent = post('/payroll/bonuses', monaCookie, bonus(theo, Q6));
    let validating: ReturnType<typeof post> | undefined;
    try {
      await until(async () => (await waiting()) === 1);
      validating = team.validate(team.owner, theo, Q7);
      await until(async () => (await waiting()) === 2);
    } finally {
      await lock.release();
    }
    const [created, refused] = await Promise.all([sent, validating]);
    expect(created.statusCode, created.body).toBe(201);
    expect(team.refusal(refused)).toEqual(
      expect.objectContaining({ code: 'commission_statement_order_conflict', details: { period: Q6 } }),
    );

    await team.recalculate(Q6);
    expect((await team.validate(team.owner, theo, Q6)).statusCode).toBe(200);
    expect((await team.statementOf(theo, Q6)).bonusesMinor).toBe(2_000);
    expect((await team.validate(team.owner, theo, Q7)).statusCode).toBe(200);
  });
});
