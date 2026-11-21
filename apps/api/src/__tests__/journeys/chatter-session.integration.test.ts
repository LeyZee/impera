import { MeSchema, MyShiftsSchema, ShiftSchema, type TeamMember } from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { Server } from '../../server';
import { clockedScheduling } from '../support/clocked-scheduling';
import { iso } from '../support/paris';
import { MEMBER_PASSWORD, startPayrollTeam, type PayrollTeam } from '../support/payroll-team';
import { sessionTimes } from '../support/session-times';
import { signIn } from '../support/sign-in';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EMAIL = 'theo@recette.test';

/**
 * A chatter's session during his shift (ADR 0160 × EQ-13): 12 hours without activity close it, whatever his shift
 * says; a request before then keeps it; signed in again, he finds his post as he left it. The planning's and the
 * access window's clock is fixed at the test's start; the session's times are moved in the base, Better Auth reading
 * its own clock. Invented team only (ADR 0010).
 */
describe('a chatter’s session during his shift', () => {
  let team: PayrollTeam;
  let planning: Server;
  let theo: TeamMember;
  let cookie: string;
  /** The planning's clock, on the minute: the shift is made ahead of it, then the access window looks into it. */
  const planned = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  let now = planned;
  const times = () => sessionTimes(team.test.admin.db);

  const me = (who: string) => team.call('GET', '/me', who);
  const shiftCreatorsOf = async (who: string) => {
    const response = await me(who);
    expect(response.statusCode, response.body).toBe(200);
    return MeSchema.parse(response.json()).shiftCreatorIds;
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { accessClock: () => now });
    planning = await clockedScheduling(team, () => now);
    ({ member: theo } = await team.addMember(EMAIL, 'Théo'));
    // The owner puts Théo on Anna for the coming 14 hours.
    const made = await team.call(
      'POST',
      '/scheduling/shifts',
      team.owner,
      {
        memberId: theo.id,
        creatorId: team.anna,
        platformAccountId: team.annas,
        startsAt: iso(new Date(planned.getTime() + HOUR)),
        endsAt: iso(new Date(planned.getTime() + 15 * HOUR)),
      },
      planning,
    );
    expect(made.statusCode, made.body).toBe(201);
    ShiftSchema.parse(made.json());
    // Thirteen hours into his shift.
    now = new Date(planned.getTime() + 14 * HOUR);
    cookie = await signIn(team.server, EMAIL, MEMBER_PASSWORD);
    await times().keepOnly(EMAIL, cookie);
  });

  afterAll(async () => {
    await planning.close();
    await team.close();
  });

  it('keeps him at his post while he is active, each request moving his 12 hours on', async () => {
    expect(await shiftCreatorsOf(cookie)).toEqual([team.anna]);
    await times().idle(EMAIL, '11 hours 59 minutes');
    expect(await shiftCreatorsOf(cookie)).toEqual([team.anna]);
    expect(Date.now() - (await times().lastActive(EMAIL)).getTime()).toBeLessThan(HOUR);
    // Another 11 hours 59 minutes from that request: almost 24 hours since he signed in, still alive.
    await times().idle(EMAIL, '11 hours 59 minutes');
    expect(await shiftCreatorsOf(cookie)).toEqual([team.anna]);
    expect(await times().count(EMAIL)).toBe(1);
  });

  it('closes the session after 12 hours without activity, though his shift is still running', async () => {
    await times().idle(EMAIL, '12 hours 1 minute');
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await times().count(EMAIL)).toBe(0);
    // Closed for good: the next request on any route is refused as well.
    expect((await team.call('GET', '/scheduling/my-shifts', cookie, undefined, planning)).statusCode).toBe(
      401,
    );
    expect((await team.call('GET', `/payroll/periods`, cookie)).statusCode).toBe(401);
  });

  it('opens a fresh session at his next sign-in, on the post he left', async () => {
    const again = await signIn(team.server, EMAIL, MEMBER_PASSWORD);
    await times().keepOnly(EMAIL, again);
    expect(await shiftCreatorsOf(again)).toEqual([team.anna]);
    const shifts = await team.call('GET', '/scheduling/my-shifts', again, undefined, planning);
    expect(shifts.statusCode, shifts.body).toBe(200);
    expect(MyShiftsSchema.parse(shifts.json()).current?.creatorId).toBe(team.anna);
    expect(await times().count(EMAIL)).toBe(1);
    // The old cookie stays closed.
    expect((await me(cookie)).statusCode).toBe(401);
  });
});
