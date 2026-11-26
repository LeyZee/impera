import {
  AvailabilityWeekIdSchema,
  MemberAvailabilitySchema,
  newId,
  TeamAvailabilitySchema,
  type TeamMember,
} from '@impera/contracts';
import { schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Invented people only (ADR 0010). */
describe('Équipe › Planning : les dispos de la semaine (ADR 0171, trou 16)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let samCookie: string;

  const evenings = [
    { weekday: 1, startMinute: 18 * 60, endMinute: 24 * 60 },
    { weekday: 3, startMinute: 18 * 60, endMinute: 23 * 60 + 30 },
  ];
  const put = (cookie: string, path: string, ranges: unknown, id: string = newId(AvailabilityWeekIdSchema)) =>
    team.call('PUT', `/scheduling/availability/${path}`, cookie, { id, ranges });
  const mine = async (cookie: string) => {
    const response = await team.call('GET', '/scheduling/availability/mine', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return MemberAvailabilitySchema.parse(response.json());
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa', 'manager'));
    ({ cookie: samCookie } = await team.addMember('sam@example.test', 'Sam'));
  });

  afterAll(async () => {
    await team.close();
  });

  it('gives a member with no week an empty one in his own zone', async () => {
    const read = await mine(theoCookie);
    expect(read).toMatchObject({
      memberId: theo.id,
      weekId: null,
      ranges: [],
      setAt: null,
      timeZone: 'Europe/Paris',
    });
  });

  it('writes his week once, in the order of the week, and the same id again gives it back', async () => {
    const id = newId(AvailabilityWeekIdSchema);
    const first = await put(theoCookie, 'mine', [...evenings].reverse(), id);
    expect(first.statusCode, first.body).toBe(201);
    expect(MemberAvailabilitySchema.parse(first.json())).toMatchObject({
      ranges: evenings,
      setByMember: true,
    });
    expect((await put(theoCookie, 'mine', evenings, id)).statusCode).toBe(200);
    const changed = await put(theoCookie, 'mine', [evenings[0]], id);
    expect(changed.statusCode).toBe(409);
    expect(team.refusal(changed).code).toBe('availability_conflict');
    expect((await mine(theoCookie)).ranges).toEqual(evenings);
    expect(await team.audited('member_availability.set')).toBe(1);
  });

  it('refuses overlapping plages, a plage off the quarter hour, and more than 21', async () => {
    const overlap = [
      { weekday: 2, startMinute: 600, endMinute: 900 },
      { weekday: 2, startMinute: 840, endMinute: 960 },
    ];
    expect((await put(theoCookie, 'mine', overlap)).statusCode).toBe(400);
    expect(
      (await put(theoCookie, 'mine', [{ weekday: 2, startMinute: 610, endMinute: 900 }])).statusCode,
    ).toBe(400);
    const many = Array.from({ length: 22 }, (_, n) => ({
      weekday: (n % 7) + 1,
      startMinute: Math.floor(n / 7) * 120,
      endMinute: Math.floor(n / 7) * 120 + 60,
    }));
    expect((await put(theoCookie, 'mine', many)).statusCode).toBe(400);
  });

  it('lets a manager set a member’s week and read the team’s, and keeps the older week', async () => {
    const forTheo = await put(leaCookie, theo.id, [{ weekday: 6, startMinute: 0, endMinute: 360 }]);
    expect(forTheo.statusCode, forTheo.body).toBe(201);
    expect(MemberAvailabilitySchema.parse(forTheo.json()).setByMember).toBe(false);
    const response = await team.call('GET', '/scheduling/availability', leaCookie);
    expect(response.statusCode).toBe(200);
    const read = TeamAvailabilitySchema.parse(response.json());
    expect(read.members.find((one) => one.memberId === theo.id)?.ranges).toEqual([
      { weekday: 6, startMinute: 0, endMinute: 360 },
    ]);
    expect(read.members.find((one) => one.memberId === lea.id)?.weekId).toBeNull();
    const [count] = await team.test.admin.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.memberAvailabilityWeeks);
    expect(count?.n).toBe(2);
  });

  it('keeps a chatter to his own week: he reads no other and writes none', async () => {
    expect((await team.call('GET', '/scheduling/availability', samCookie)).statusCode).toBe(403);
    // Théo's member row is not his to read: the week is refused as a member he cannot see.
    expect((await put(samCookie, theo.id, evenings)).statusCode).toBe(404);
    expect((await mine(samCookie)).ranges).toEqual([]);
    // Under his own scope the base shows him none of Théo's rows, and refuses a row in Théo's name.
    const seen = await team.test.app.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.user_id', ${'nobody'}, true), set_config('app.team_scope', 'self', true)`,
      );
      return tx.select().from(schema.memberAvailabilityWeeks);
    });
    expect(seen).toEqual([]);
  });

  it('keeps every week as written: no change, no removal', async () => {
    const refused = await team.test.app.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.user_id', ${theo.userId}, true), set_config('app.team_scope', 'self', true)`,
        );
        await tx.execute(sql`delete from member_availability_weeks`);
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refused).not.toBeNull();
  });
});
