import {
  MySaleClaimsSchema,
  newId,
  payPeriodAt,
  PendingSaleClaimsSchema,
  SaleClaimIdSchema,
  SaleClaimSchema,
  ShiftIdSchema,
  type ShiftId,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * « J'ai été décisif sur une vente » (ADR 0101 §§ 18 to 22, trou 15): Théo signals one of his own ended shifts, the
 * claim waits in the manager's « Ventes en attente », the owner or a manager who is not its member answers it. Every
 * name below is invented (ADR 0010); the shifts are put around the real now, the window being 15 days back from it.
 */
describe('Équipe › Paie : « J’ai été décisif sur une vente » arrive chez le manager (trou 15)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let samCookie: string;
  const theirs: ShiftId[] = [];
  let ongoing: ShiftId;
  let old: ShiftId;
  let leas: ShiftId;

  const shift = async (member: TeamMember, startsAt: Date, hours = 2): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await team.test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: team.anna,
      platformAccountId: team.annas,
      memberId: member.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + hours * HOUR),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    return id;
  };

  const claim = (
    cookie: string,
    shiftId: ShiftId,
    note = 'Le fan a acheté le pack après ma relance',
    id?: string,
  ) =>
    team.call('POST', '/payroll/sale-claims', cookie, { id: id ?? newId(SaleClaimIdSchema), shiftId, note });
  const answer = (cookie: string, id: string, outcome: string, note: string | null = null) =>
    team.call('POST', `/payroll/sale-claims/${id}/answer`, cookie, { outcome, note });
  const mine = async (cookie = theoCookie) => {
    const response = await team.call('GET', '/payroll/sale-claims/mine', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return MySaleClaimsSchema.parse(response.json());
  };
  const pending = async (cookie = team.owner) => {
    const response = await team.call('GET', '/payroll/sale-claims', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return PendingSaleClaimsSchema.parse(response.json()).claims;
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    const lea = await team.addMember('lea@example.test', 'Léa', 'manager');
    leaCookie = lea.cookie;
    ({ cookie: samCookie } = await team.addMember('sam@example.test', 'Sam'));
    const hour = Math.floor(Date.now() / HOUR) * HOUR;
    for (const days of [1, 2, 3, 4, 5]) theirs.push(await shift(theo, new Date(hour - days * DAY)));
    ongoing = await shift(theo, new Date(hour - HOUR), 3);
    old = await shift(theo, new Date(hour - 20 * DAY));
    leas = await shift(lea.member, new Date(hour - DAY));
  });

  afterAll(async () => {
    await team.close();
  });

  it('offers Théo his ended shifts of the last 15 days only, the newest first', async () => {
    const read = await mine();
    expect(read.claims).toEqual([]);
    const offered = read.shifts.map((one) => one.shiftId);
    expect(offered).toEqual(theirs);
    expect(offered).not.toContain(ongoing);
    expect(offered).not.toContain(old);
    expect(offered).not.toContain(leas);
    expect(read.shifts[0]?.creatorName).toBe('Anna');
  });

  it('writes a claim once, and the same id again gives it back without a second line', async () => {
    const id = newId(SaleClaimIdSchema);
    const first = await claim(theoCookie, theirs[0] ?? ongoing, undefined, id);
    expect(first.statusCode, first.body).toBe(201);
    const written = SaleClaimSchema.parse(first.json());
    expect(written.state).toBe('waiting');
    expect(written.memberId).toBe(theo.id);
    const again = await claim(theoCookie, theirs[0] ?? ongoing, undefined, id);
    expect(again.statusCode).toBe(200);
    expect(SaleClaimSchema.parse(again.json()).id).toBe(id);
    const changed = await claim(theoCookie, theirs[0] ?? ongoing, 'Un autre texte', id);
    expect(team.refusal(changed).code).toBe('sale_claim_conflict');
    expect(await team.audited('sale_claim.create')).toBe(1);
    const read = await mine();
    expect(read.claims.map((one) => one.id)).toEqual([id]);
    expect(read.shifts.map((one) => one.shiftId)).not.toContain(theirs[0]);
  });

  it('refuses a shift claimed already, still running, too old or not his', async () => {
    for (const shiftId of [theirs[0], ongoing, old, leas]) {
      const response = await claim(theoCookie, shiftId ?? ongoing);
      expect(response.statusCode).toBe(409);
      expect(team.refusal(response).code).toBe('sale_claim_shift_conflict');
    }
  });

  it('keeps three claims waiting at most for one member', async () => {
    for (const shiftId of [theirs[1], theirs[2]]) {
      expect((await claim(theoCookie, shiftId ?? ongoing)).statusCode).toBe(201);
    }
    const fourth = await claim(theoCookie, theirs[3] ?? ongoing);
    expect(fourth.statusCode).toBe(409);
    expect(team.refusal(fourth).code).toBe('sale_claims_too_many_conflict');
  });

  it('shows the waiting claims to the owner and a manager, oldest first, and to no chatter', async () => {
    const byOwner = await pending();
    expect(byOwner.map((one) => [one.memberName, one.shift.shiftId, one.state])).toEqual([
      ['Théo', theirs[0], 'waiting'],
      ['Théo', theirs[1], 'waiting'],
      ['Théo', theirs[2], 'waiting'],
    ]);
    expect((await pending(leaCookie)).length).toBe(3);
    const bySam = await team.call('GET', '/payroll/sale-claims', samCookie);
    expect(bySam.statusCode).toBe(403);
    // Sam reads none of Théo's claims through his own list either.
    expect((await mine(samCookie)).claims).toEqual([]);
  });

  it('lets the owner settle one and a manager refuse one with a note, each answer given once', async () => {
    const [a, b, c] = (await pending()).map((one) => one.id);
    expect(c).toBeDefined();
    const settled = await answer(team.owner, a ?? '', 'settled');
    expect(settled.statusCode, settled.body).toBe(200);
    expect(SaleClaimSchema.parse(settled.json()).state).toBe('settled');
    expect((await answer(team.owner, a ?? '', 'settled')).statusCode).toBe(200);
    expect(team.refusal(await answer(team.owner, a ?? '', 'not_retained', 'Non')).code).toBe(
      'sale_claim_answered_conflict',
    );
    expect((await answer(leaCookie, b ?? '', 'not_retained')).statusCode).toBe(400);
    const refused = await answer(leaCookie, b ?? '', 'not_retained', 'La vente est arrivée après ton shift');
    expect(refused.statusCode, refused.body).toBe(200);
    expect(await team.audited('sale_claim.answer')).toBe(2);
    const read = await mine();
    expect(read.claims.map((one) => [one.shift.shiftId, one.state, one.answerNote])).toEqual([
      [theirs[2], 'waiting', null],
      [theirs[1], 'not_retained', 'La vente est arrivée après ton shift'],
      [theirs[0], 'settled', null],
    ]);
    // An answered claim no longer counts among the three waiting.
    expect((await claim(theoCookie, theirs[3] ?? ongoing)).statusCode).toBe(201);
  });

  it('lets only Théo withdraw his claim, and no one answer a claim of his own', async () => {
    const waiting = (await mine()).claims.find((one) => one.shift.shiftId === theirs[2]);
    expect(waiting).toBeDefined();
    expect(team.refusal(await answer(theoCookie, waiting?.id ?? '', 'settled')).code).toBe(
      'sale_claim_answered_conflict',
    );
    expect(team.refusal(await answer(team.owner, waiting?.id ?? '', 'withdrawn')).code).toBe(
      'sale_claim_answered_conflict',
    );
    expect((await answer(theoCookie, waiting?.id ?? '', 'withdrawn')).statusCode).toBe(200);

    const leasClaim = await claim(leaCookie, leas);
    expect(leasClaim.statusCode, leasClaim.body).toBe(201);
    const id = SaleClaimSchema.parse(leasClaim.json()).id;
    expect(team.refusal(await answer(leaCookie, id, 'settled')).code).toBe('sale_claim_answered_conflict');
    // Théo does not even see Léa's claim.
    expect((await answer(theoCookie, id, 'withdrawn')).statusCode).toBe(404);
    expect((await answer(team.owner, id, 'settled')).statusCode).toBe(200);
  });

  it('refuses a claim in a period already validated and stops offering its shifts', async () => {
    const last = theirs[4] ?? ongoing;
    const [row] = await team.test.admin.db
      .select({ startsAt: schema.shifts.startsAt })
      .from(schema.shifts)
      .where(eq(schema.shifts.id, last));
    const period = payPeriodAt(row?.startsAt ?? new Date(), 'Europe/Paris');
    await team.recalculate(period);
    // The base closes only an ended period (ADR 0032) and the window is the last 15 days: the fixture writes the
    // closing of the running one past its guard, as the tables' owner, to put the store before a closed period.
    await team.test.admin.db.transaction(async (tx) => {
      await tx.execute(sql`alter table pay_period_closings disable trigger user`);
      await tx.insert(schema.payPeriodClosings).values({
        period,
        teamNetMinor: 0,
        collective: null,
        exchangeRates: [],
        closedBy: team.ownerId,
      });
      await tx.execute(sql`alter table pay_period_closings enable trigger user`);
    });
    expect((await mine()).shifts.map((one) => one.shiftId)).not.toContain(last);
    const response = await claim(theoCookie, last);
    expect(team.refusal(response).code).toBe('pay_period_closed_conflict');
  });
});
