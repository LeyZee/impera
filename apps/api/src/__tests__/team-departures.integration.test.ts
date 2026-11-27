import {
  ApiErrorSchema,
  MemberDepartureIdSchema,
  MemberDepartureListSchema,
  MemberDepartureSchema,
  UserIdSchema,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema, sql, withMember } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/* Invented people (ADR 0010). */
const codeOf = (body: string): string => ApiErrorSchema.parse(JSON.parse(body)).error.code;
const inHours = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('« Faire partir » : une heure de fin, la coche Reveal, appliqué par le job (ADR 0166)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let lou: TeamMember;
  let louCookie: string;
  let mia: TeamMember;
  let miaCookie: string;
  let manager: TeamMember;
  let managerCookie: string;

  const db = () => team.test.admin.db;
  const leave = (member: TeamMember, body: object, cookie = team.owner) =>
    team.call('POST', `/team/members/${member.id}/departure`, cookie, body);
  const departureOf = (body: string) => MemberDepartureSchema.parse(JSON.parse(body));
  const statusOf = async (member: TeamMember) => {
    const [row] = await db()
      .select({ status: schema.teamMembers.status, leftOn: schema.teamMembers.leftOn })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, member.id));
    return row;
  };
  const creatorsOf = async (member: TeamMember) => {
    const [row] = await db()
      .select({ creatorIds: schema.user.creatorIds })
      .from(schema.user)
      .where(eq(schema.user.id, member.userId));
    return row?.creatorIds;
  };
  const auditOf = (action: string, member: TeamMember) =>
    db()
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(sql`${schema.auditLog.action} = ${action} and ${schema.auditLog.entityId} = ${member.id}`);

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lou, cookie: louCookie } = await team.addMember('lou@example.test', 'Lou'));
    ({ member: mia, cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia'));
    ({ member: manager, cookie: managerCookie } = await team.addMember(
      'nora@example.test',
      'Nora',
      'manager',
      undefined,
      {
        teamShareBps: 1_000,
      },
    ));
  });

  const owner = () => UserIdSchema.parse(team.ownerId);

  afterAll(async () => {
    await team.close();
  });

  it('sets a departure for later: he still works until then, its reason is a note, its job waits for its hour', async () => {
    const endsAt = inHours(2);
    const set = await leave(theo, { endsAt, reason: 'Fin de mission' });
    expect(set.statusCode, set.body).toBe(201);
    const departure = departureOf(set.body);
    expect(departure).toMatchObject({ memberId: theo.id, state: 'scheduled', appliedAt: null, late: false });
    expect(Date.parse(departure.endsAt)).toBe(Date.parse(endsAt));
    expect((await team.call('GET', '/me', theoCookie)).statusCode).toBe(200);
    expect(await statusOf(theo)).toMatchObject({ status: 'active' });

    const notes = await db()
      .select({ body: schema.teamMemberNotes.body })
      .from(schema.teamMemberNotes)
      .where(eq(schema.teamMemberNotes.memberId, theo.id));
    expect(notes).toEqual([{ body: 'Motif du départ : Fin de mission' }]);
    // His own record never shows him the reason: the notes are the team's.
    const own = await team.call('GET', `/team/members/${theo.id}/notes`, theoCookie);
    expect(own.statusCode).toBe(403);

    const jobs = await db().execute(
      sql`select run_at, key from graphile_worker.jobs where task_identifier = 'team.member_departure'`,
    );
    const [job] = z.array(z.object({ run_at: z.coerce.date(), key: z.string() })).parse(jobs.rows);
    expect(job?.key).toBe(`team.member_departure:${departure.id}`);
    // Its payload names who set it, checked against the departure before it applies.
    const [payload] = z
      .array(z.object({ payload: z.unknown() }))
      .parse(
        (
          await db().execute(
            sql`select payload from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id where t.identifier = 'team.member_departure'`,
          )
        ).rows,
      );
    expect(payload?.payload).toEqual({ departureId: departure.id, scheduledBy: team.ownerId });
    expect(job?.run_at.getTime()).toBe(Date.parse(endsAt));

    const [scheduled] = await auditOf('team_member.departure_schedule', theo);
    expect(scheduled?.details).toEqual({ endsAt: new Date(endsAt).toISOString() });

    const twice = await leave(theo, { endsAt: inHours(3), reason: null });
    expect(twice.statusCode).toBe(409);
    expect(codeOf(twice.body)).toBe('member_departure_conflict');
  });

  it('refuses an hour past or more than 31 days ahead', async () => {
    for (const endsAt of [inHours(-1), inHours(32 * 24)]) {
      const refused = await leave(lou, { endsAt, reason: null });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(codeOf(refused.body)).toBe('member_departure_date_invalid');
    }
  });

  it('cancels a departure before its hour, once; the job then does nothing', async () => {
    const set = departureOf((await leave(lou, { endsAt: inHours(1), reason: null })).body);
    const cancelled = await team.call('POST', `/team/departures/${set.id}/cancel`, team.owner);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(departureOf(cancelled.body).state).toBe('cancelled');
    const again = await team.call('POST', `/team/departures/${set.id}/cancel`, team.owner);
    expect(codeOf(again.body)).toBe('member_departure_conflict');
    expect(await team.app.modules.team.jobs.applyDeparture(set.id, owner())).toBe(false);
    expect(await statusOf(lou)).toMatchObject({ status: 'active' });
  });

  it('applies at its hour, never before: left, no creator in the base, nothing signed in; replayed, nothing more', async () => {
    const set = departureOf((await leave(lou, { endsAt: inHours(1 / 3600), reason: null })).body);
    await expect(team.app.modules.team.jobs.applyDeparture(set.id, owner())).rejects.toThrow(
      /before its hour/u,
    );
    // A payload naming another than the owner who set it applies nothing.
    await expect(
      team.app.modules.team.jobs.applyDeparture(set.id, UserIdSchema.parse(manager.userId)),
    ).rejects.toThrow(/not set by the owner named/u);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await team.app.modules.team.jobs.applyDeparture(set.id, owner())).toBe(true);
    expect(await statusOf(lou)).toMatchObject({ status: 'left' });
    expect(await creatorsOf(lou)).toEqual([]);
    expect((await team.call('GET', '/me', louCookie)).statusCode).toBe(401);
    const sessions = await db().select().from(schema.session).where(eq(schema.session.userId, lou.userId));
    expect(sessions).toEqual([]);
    const [applied] = await auditOf('team_member.departure_apply', lou);
    // Two sessions: the activation of his code left one, his sign-in with the code another (ADR 0046).
    expect(applied?.details).toMatchObject({
      sessionsEnded: 2,
      passkeysRemoved: 0,
      scheduledBy: team.ownerId,
    });
    expect(await team.app.modules.team.jobs.applyDeparture(set.id, owner())).toBe(false);
    expect(await auditOf('team_member.departure_apply', lou)).toHaveLength(1);
  });

  it('applies at once without an hour, and asks Reveal to be ticked until it is', async () => {
    const now = await leave(mia, { endsAt: null, reason: null });
    expect(now.statusCode, now.body).toBe(201);
    const departure = departureOf(now.body);
    expect(departure.state).toBe('applied');
    expect(await statusOf(mia)).toMatchObject({ status: 'left' });
    expect((await team.call('GET', '/me', miaCookie)).statusCode).toBe(401);

    const listed = async () =>
      MemberDepartureListSchema.parse(
        (await team.call('GET', '/team/departures', team.owner)).json(),
      ).departures.map((one) => [one.memberId, one.state, one.revealRemovedAt === null]);
    expect(await listed()).toEqual(
      expect.arrayContaining([
        [theo.id, 'scheduled', true],
        [mia.id, 'applied', true],
      ]),
    );
    const ticked = await team.call('POST', `/team/departures/${departure.id}/reveal-removed`, team.owner);
    expect(ticked.statusCode, ticked.body).toBe(200);
    const first = departureOf(ticked.body);
    expect(first.revealRemovedBy).toBe(team.ownerId);
    const again = departureOf(
      (await team.call('POST', `/team/departures/${departure.id}/reveal-removed`, team.owner)).body,
    );
    expect(again.revealRemovedAt).toBe(first.revealRemovedAt);
    expect((await listed()).map(([memberId]) => memberId)).not.toContain(mia.id);
    expect(await auditOf('team_member.reveal_removed', mia)).toHaveLength(1);
  });

  it('writes a departure applied at once when « Parti » is set through the status', async () => {
    const { member: zoe } = await team.addMember('zoe@example.test', 'Zoé');
    const left = await team.call('PUT', `/team/members/${zoe.id}/status`, team.owner, { status: 'left' });
    expect(left.statusCode, left.body).toBe(200);
    const rows = await db()
      .select()
      .from(schema.teamMemberDepartures)
      .where(eq(schema.teamMemberDepartures.memberId, zoe.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appliedAt).not.toBe(null);
  });

  it('is the owner’s alone: a manager and a chatter are refused, the base agrees, the service role reads nothing', async () => {
    for (const cookie of [managerCookie, theoCookie]) {
      expect((await team.call('GET', '/team/departures', cookie)).statusCode).toBe(403);
      expect((await leave(mia, { endsAt: null, reason: null }, cookie)).statusCode).toBe(403);
    }
    // In the base: the manager reads none, Théo his own only, and neither writes one.
    const seen = (userId: string) =>
      withMember(team.test.app.db, userId, async (tx) =>
        (await tx.select().from(schema.teamMemberDepartures)).map((row) => row.memberId),
      );
    expect(await seen(manager.userId)).toEqual([]);
    expect(await seen(theo.userId)).toEqual([theo.id]);
    await expect(
      withMember(team.test.app.db, manager.userId, (tx) =>
        tx.insert(schema.teamMemberDepartures).values({
          id: MemberDepartureIdSchema.parse('0199f2a0-0000-7000-8000-000000000601'),
          memberId: mia.id,
          endsAt: sql`now()`,
          createdBy: manager.userId,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(team.test.service.db.select().from(schema.teamMemberDepartures)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('never changes an end, a tick or the hour once written, and never deletes one', async () => {
    const [row] = await db()
      .select()
      .from(schema.teamMemberDepartures)
      .where(eq(schema.teamMemberDepartures.memberId, mia.id));
    if (row === undefined) throw new Error('no departure');
    await expect(
      db()
        .update(schema.teamMemberDepartures)
        .set({ revealRemovedAt: null, revealRemovedBy: null })
        .where(eq(schema.teamMemberDepartures.id, row.id)),
    ).rejects.toThrow();
    await expect(
      db()
        .update(schema.teamMemberDepartures)
        .set({ endsAt: new Date() })
        .where(eq(schema.teamMemberDepartures.id, row.id)),
    ).rejects.toThrow();
    await expect(
      db().delete(schema.teamMemberDepartures).where(eq(schema.teamMemberDepartures.id, row.id)),
    ).rejects.toThrow();
  });

  it('is applied by an owner in office when the one who set it no longer is one, and the entry says both', async () => {
    const { member: paul } = await team.addMember('paul@example.test', 'Paul');
    const { member: ines } = await team.addMember('ines@example.test', 'Inès');
    const roleOf = async () => {
      const [row] = await db()
        .select({ role: schema.user.role })
        .from(schema.user)
        .where(eq(schema.user.id, ines.userId));
      return row?.role;
    };
    const before = await roleOf();
    if (before === undefined) throw new Error('no account');
    const setRole = (role: string) =>
      db().update(schema.user).set({ role }).where(eq(schema.user.id, ines.userId));
    await setRole('owner');
    const id = MemberDepartureIdSchema.parse('0199f2a0-0000-7000-8000-000000000611');
    await withMember(team.test.app.db, ines.userId, (tx) =>
      tx.insert(schema.teamMemberDepartures).values({
        id,
        memberId: paul.id,
        endsAt: sql`now()`,
        createdBy: ines.userId,
      }),
    );
    // Inès is no longer an owner when its hour comes: the departure applies all the same.
    await setRole(before);
    expect(await team.app.modules.team.jobs.applyDeparture(id, UserIdSchema.parse(ines.userId))).toBe(true);
    expect(await statusOf(paul)).toMatchObject({ status: 'left' });
    const [entry] = await db()
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.action} = 'team_member.departure_apply' and ${schema.auditLog.entityId} = ${paul.id}`,
      );
    expect(entry).toMatchObject({ userId: team.ownerId, details: { scheduledBy: ines.userId } });
  });

  it('never lets an owner sign a cancel or a tick in another account’s name', async () => {
    const [waiting] = await db()
      .select({ id: schema.teamMemberDepartures.id })
      .from(schema.teamMemberDepartures)
      .where(
        sql`${schema.teamMemberDepartures.memberId} = ${theo.id} and ${schema.teamMemberDepartures.appliedAt} is null`,
      );
    if (waiting === undefined) throw new Error('no departure');
    for (const set of [
      { cancelledAt: new Date(), cancelledBy: theo.userId },
      { revealRemovedAt: new Date(), revealRemovedBy: theo.userId },
    ]) {
      await expect(
        withMember(team.test.app.db, team.ownerId, (tx) =>
          tx
            .update(schema.teamMemberDepartures)
            .set(set)
            .where(eq(schema.teamMemberDepartures.id, waiting.id)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    }
  });
});
