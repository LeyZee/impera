import {
  CommissionRateIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
  type UserId,
} from '@impera/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { withAdmin, withMember } from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

const ZoneRowSchema = z.object({ zone: z.string() });
const FOLLOW = 'team_member.time_zone_follow';

/**
 * `follow_own_time_zone` (0217, recette CHT-01): a member's own zone follows his phone. SECURITY DEFINER, so it holds
 * its own boundary; called here the way the API calls it, on the application role. Invented people only (ADR 0010).
 */
describe('a member’s zone follows his phone, his record only (0217)', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const other = newId(UserIdSchema);
  const gone = newId(UserIdSchema);
  const capped = newId(UserIdSchema);
  const stranger = newId(UserIdSchema);
  const memberOf = new Map<string, string>();

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.user).values([
        { id: owner, name: 'Compte owner', email: `${owner}@example.test`, role: 'owner' },
        { id: stranger, name: 'Compte sans fiche', email: `${stranger}@example.test`, role: 'operator' },
      ]);
      for (const [userId, status] of [
        [chatter, 'active'],
        [other, 'active'],
        [gone, 'left'],
        [capped, 'active'],
      ] as const) {
        await tx.insert(s.user).values({
          id: userId,
          name: 'Compte operator',
          email: `${userId}@example.test`,
          role: 'operator',
        });
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole: 'chatter',
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: 'Membre inventé',
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          status,
          joinedOn: '2026-10-01',
          leftOn: status === 'left' ? '2026-11-01' : null,
        });
        await tx.insert(s.memberCommissionRates).values({
          id: newId(CommissionRateIdSchema),
          memberId,
          rateBps: 2500,
          effectiveFrom: '2026-10-01',
          createdBy: owner,
        });
      }
    });
  });

  afterAll(async () => {
    await test.close();
  });

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const follow = (userId: UserId, zone: string): Promise<string> =>
    withMember(test.app.db, userId, async (tx) => {
      const { rows } = await tx.execute(sql`select public.follow_own_time_zone(${zone}) as zone`);
      return ZoneRowSchema.parse(rows[0]).zone;
    });

  const record = (userId: string) =>
    withAdmin(test.admin.db, async (tx) => {
      const [row] = await tx
        .select({
          timeZone: s.teamMembers.timeZone,
          teamRole: s.teamMembers.teamRole,
          status: s.teamMembers.status,
          displayName: s.teamMembers.displayName,
        })
        .from(s.teamMembers)
        .where(eq(s.teamMembers.userId, userId));
      return row;
    });

  const traces = (userId: string) =>
    withAdmin(test.admin.db, (tx) =>
      tx
        .select({ userId: s.auditLog.userId, details: s.auditLog.details, ip: s.auditLog.ip })
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, FOLLOW), eq(s.auditLog.entityId, member(userId)))),
    );

  it('writes the zone of his own record, and a trace of before and after, without an IP', async () => {
    expect(await follow(chatter, 'Europe/Paris')).toBe('Europe/Paris');
    expect(await record(chatter)).toEqual({
      timeZone: 'Europe/Paris',
      teamRole: 'chatter',
      status: 'active',
      displayName: 'Membre inventé',
    });
    expect(await traces(chatter)).toEqual([
      { userId: chatter, details: { from: 'Africa/Porto-Novo', to: 'Europe/Paris' }, ip: null },
    ]);
  });

  it('leaves every other record, rate and role as they were', async () => {
    expect(await record(other)).toEqual({
      timeZone: 'Africa/Porto-Novo',
      teamRole: 'chatter',
      status: 'active',
      displayName: 'Membre inventé',
    });
    const rates = await withAdmin(test.admin.db, (tx) =>
      tx.select({ rateBps: s.memberCommissionRates.rateBps }).from(s.memberCommissionRates),
    );
    expect(rates.every((rate) => rate.rateBps === 2500)).toBe(true);
    expect(await traces(other)).toEqual([]);
  });

  it('writes nothing when the zone is his already', async () => {
    expect(await follow(chatter, 'Europe/Paris')).toBe('Europe/Paris');
    expect(await traces(chatter)).toHaveLength(1);
  });

  it('refuses what is not a place of the IANA regions, before any write', async () => {
    for (const zone of [
      'Etc/GMT+3',
      'posix/Europe/Paris',
      'UTC',
      'Factory',
      'localtime',
      'Europe/Nulle_Part',
      "Europe/Paris'); update team_members set team_role = 'manager'; --",
      `Europe/${'A'.repeat(60)}`,
    ]) {
      expect(await failure(follow(chatter, zone)), zone).toMatch(/unknown zone/);
    }
    expect((await record(chatter))?.teamRole).toBe('chatter');
    expect(await traces(chatter)).toHaveLength(1);
  });

  it('refuses a transaction that names no account, or an empty one', async () => {
    const bare = test.app.db.transaction((tx) =>
      tx.execute(sql`select public.follow_own_time_zone('Europe/Paris')`),
    );
    expect(await failure(bare)).toMatch(/no reader for the zone/);
    const empty = test.app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', '', true)`);
      return tx.execute(sql`select public.follow_own_time_zone('Europe/Paris')`);
    });
    expect(await failure(empty)).toMatch(/no reader for the zone/);
  });

  it('refuses an account without a record: the owner, an operator not in the team', async () => {
    expect(await failure(follow(owner, 'Europe/Paris'))).toMatch(/no record of the reader/);
    expect(await failure(follow(stranger, 'Europe/Paris'))).toMatch(/no record of the reader/);
  });

  it('writes nothing for a member who left', async () => {
    expect(await follow(gone, 'Europe/Paris')).toBe('Africa/Porto-Novo');
    expect((await record(gone))?.timeZone).toBe('Africa/Porto-Novo');
    expect(await traces(gone)).toEqual([]);
  });

  it('takes 10 changes a day at most, then keeps the zone', async () => {
    const zones = ['Europe/Paris', 'Africa/Lagos'];
    for (let i = 0; i < 10; i += 1) {
      const zone = zones[i % 2] ?? 'Europe/Paris';
      expect(await follow(capped, zone)).toBe(zone);
    }
    expect(await follow(capped, 'Asia/Tokyo')).toBe('Africa/Lagos');
    expect((await record(capped))?.timeZone).toBe('Africa/Lagos');
    expect(await traces(capped)).toHaveLength(10);
  });

  it('is a door of the application role alone: neither PUBLIC nor the service role may call it', async () => {
    const { rows } = await test.admin.db.execute(sql`
      select has_function_privilege('nirvana_app', 'public.follow_own_time_zone(text)', 'EXECUTE') as app,
             has_function_privilege('impera_service', 'public.follow_own_time_zone(text)', 'EXECUTE') as service,
             exists (select from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = 'public.follow_own_time_zone(text)'::regprocedure and a.grantee = 0) as public,
             p.prosecdef as definer, p.pronargs as arguments, p.proconfig as config
        from pg_proc p where p.oid = 'public.follow_own_time_zone(text)'::regprocedure`);
    expect(rows[0]).toEqual({
      app: true,
      service: false,
      public: false,
      definer: true,
      arguments: 1,
      config: ['search_path=pg_catalog, pg_temp'],
    });
    expect(
      await failure(test.service.db.execute(sql`select public.follow_own_time_zone('Europe/Paris')`)),
    ).toMatch(/permission denied for function follow_own_time_zone/);
  });

  it('keeps the record written by the owner alone otherwise: a member still cannot update it', async () => {
    const write = withMember(test.app.db, chatter, (tx) =>
      tx
        .update(s.teamMembers)
        .set({ timeZone: 'Asia/Tokyo', teamRole: 'manager' })
        .where(eq(s.teamMembers.userId, chatter))
        .returning({ id: s.teamMembers.id }),
    );
    expect(await write).toEqual([]);
    expect(await record(chatter)).toMatchObject({ timeZone: 'Europe/Paris', teamRole: 'chatter' });
  });
});
