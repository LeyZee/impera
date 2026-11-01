import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember, withTenantMember, type Transaction } from './client';
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

/** Invented people and creators only (ADR 0010). */
describe('planning tables (EQ-02): the creator and the member, through withTenantMember', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const shiftOfA = newId(ShiftIdSchema);
  const shiftOfB = newId(ShiftIdSchema);
  const shiftOnInes = newId(ShiftIdSchema);

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const shiftRow = (
    creator: { creatorId: string; accountId: string },
    userId: string,
    startsAt: string,
    endsAt: string,
    by = owner,
  ) => ({
    id: newId(ShiftIdSchema),
    creatorId: creator.creatorId,
    platformAccountId: creator.accountId,
    memberId: member(userId),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    createdBy: by,
    updatedBy: by,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creator] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const) {
        await tx.insert(s.creators).values({
          id: creator.creatorId,
          nameKey: creator.creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
        await tx.insert(s.platformAccounts).values({
          id: creator.accountId,
          creatorId: creator.creatorId,
          platform: 'reveal',
          handle: `handle-${label}`,
        });
      }
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx
          .insert(s.user)
          .values({ id: userId, name: `Compte ${role}`, email: `${userId}@example.test`, role });
        if (teamRole === null) continue;
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-10-01',
        });
      }
      await tx.insert(s.shifts).values([
        { ...shiftRow(nora, chatterA, '2099-11-02T00:00:00Z', '2099-11-02T06:00:00Z'), id: shiftOfA },
        { ...shiftRow(nora, chatterB, '2099-11-02T06:00:00Z', '2099-11-02T12:00:00Z'), id: shiftOfB },
        { ...shiftRow(ines, chatterA, '2099-11-03T00:00:00Z', '2099-11-03T06:00:00Z'), id: shiftOnInes },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  const shiftIds = (tx: Transaction) =>
    tx
      .select({ id: s.shifts.id })
      .from(s.shifts)
      .then((rows) => rows.map((row) => row.id).toSorted());

  it('shows no shift outside a creator, nor to a member scope alone', async () => {
    const outside = await test.app.db.transaction(shiftIds);
    const memberOnly = await withMember(test.app.db, owner, shiftIds);
    expect(outside).toEqual([]);
    expect(memberOnly).toEqual([]);
  });

  it('a chatter reads their own shifts of a creator, never another chatter’s on the same creator', async () => {
    expect(await withTenantMember(test.app.db, nora.creatorId, chatterA, shiftIds)).toEqual([shiftOfA]);
    expect(await withTenantMember(test.app.db, nora.creatorId, chatterB, shiftIds)).toEqual([shiftOfB]);
    expect(await withTenantMember(test.app.db, ines.creatorId, chatterA, shiftIds)).toEqual([shiftOnInes]);
  });

  it('the owner and an active manager read every shift of the creator they are in, and only hers', async () => {
    const both = [shiftOfA, shiftOfB].toSorted();
    expect(await withTenantMember(test.app.db, nora.creatorId, owner, shiftIds)).toEqual(both);
    expect(await withTenantMember(test.app.db, nora.creatorId, manager, shiftIds)).toEqual(both);
    expect(await withTenantMember(test.app.db, ines.creatorId, manager, shiftIds)).toEqual([shiftOnInes]);
  });

  it('a manager who is not active plans nothing and reads their own shifts only', async () => {
    await withAdmin(test.admin.db, (tx) =>
      tx.update(s.teamMembers).set({ status: 'on_leave' }).where(eq(s.teamMembers.userId, manager)),
    );
    try {
      expect(await withTenantMember(test.app.db, nora.creatorId, manager, shiftIds)).toEqual([]);
    } finally {
      await withAdmin(test.admin.db, (tx) =>
        tx.update(s.teamMembers).set({ status: 'active' }).where(eq(s.teamMembers.userId, manager)),
      );
    }
  });

  it('a chatter writes no shift; a planner writes their own name on what they set, in the creator they are in', async () => {
    const row = shiftRow(nora, chatterA, '2099-11-04T00:00:00Z', '2099-11-04T06:00:00Z', chatterA);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, chatterA, (tx) => tx.insert(s.shifts).values(row)),
      ),
    ).toMatch(/row-level security/u);
    const byOwner = shiftRow(nora, chatterA, '2099-11-04T00:00:00Z', '2099-11-04T06:00:00Z', manager);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, manager, (tx) => tx.insert(s.shifts).values(byOwner)),
      ),
    ).toBe('no error');
    const elsewhere = shiftRow(ines, chatterB, '2099-11-05T00:00:00Z', '2099-11-05T06:00:00Z', manager);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, manager, (tx) => tx.insert(s.shifts).values(elsewhere)),
      ),
    ).toMatch(/row-level security/u);
  });

  it('keeps a member off two shifts at once, even on two creators, and an account off two members at once', async () => {
    const plan = (creatorId: string, row: ReturnType<typeof shiftRow>) =>
      failure(withTenantMember(test.app.db, creatorId, owner, (tx) => tx.insert(s.shifts).values(row)));
    // Chatter A is on Nora 00:00–06:00 on 2 November: Inès at 05:00 overlaps them.
    expect(
      await plan(ines.creatorId, shiftRow(ines, chatterA, '2099-11-02T05:00:00Z', '2099-11-02T09:00:00Z')),
    ).toMatch(/shifts_member_overlap_excl/u);
    // Nora's account has chatter B from 06:00: the manager there at 08:00 overlaps the account.
    expect(
      await plan(nora.creatorId, shiftRow(nora, manager, '2099-11-02T08:00:00Z', '2099-11-02T10:00:00Z')),
    ).toMatch(/shifts_account_overlap_excl/u);
    // [00:00, 06:00) and [06:00, 12:00) touch without overlapping.
    expect(
      await plan(ines.creatorId, shiftRow(ines, chatterA, '2099-11-02T06:00:00Z', '2099-11-02T08:00:00Z')),
    ).toBe('no error');
  });

  it('frees the time of a cancelled shift', async () => {
    const row = shiftRow(ines, chatterB, '2099-11-06T00:00:00Z', '2099-11-06T06:00:00Z');
    await withTenantMember(test.app.db, ines.creatorId, owner, async (tx) => {
      await tx.insert(s.shifts).values(row);
      await tx
        .update(s.shifts)
        .set({ cancelledAt: new Date(), updatedBy: owner })
        .where(eq(s.shifts.id, row.id));
    });
    const again = shiftRow(ines, chatterB, '2099-11-06T00:00:00Z', '2099-11-06T06:00:00Z');
    expect(
      await failure(
        withTenantMember(test.app.db, ines.creatorId, owner, (tx) => tx.insert(s.shifts).values(again)),
      ),
    ).toBe('no error');
  });

  it('refuses a shift longer than a day, ending at its start, or off the minute', async () => {
    const plan = (startsAt: string, endsAt: string) =>
      failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.insert(s.shifts).values(shiftRow(nora, chatterB, startsAt, endsAt)),
        ),
      );
    expect(await plan('2099-11-10T00:00:00Z', '2099-11-11T00:01:00Z')).toMatch(/shifts_range_check/u);
    expect(await plan('2099-11-10T00:00:00Z', '2099-11-10T00:00:00Z')).toMatch(/shifts_range_check/u);
    expect(await plan('2099-11-10T00:00:30Z', '2099-11-10T06:00:00Z')).toMatch(/shifts_whole_minutes_check/u);
  });

  it('deletes nothing, and changes neither the creator, the account nor the template of a shift', async () => {
    const asOwner = <T>(fn: (tx: Transaction) => Promise<T>) =>
      failure(withTenantMember(test.app.db, nora.creatorId, owner, fn));
    expect(await asOwner((tx) => tx.delete(s.shifts).where(eq(s.shifts.id, shiftOfA)))).toMatch(
      /permission denied/u,
    );
    expect(
      await asOwner((tx) =>
        tx.update(s.shifts).set({ platformAccountId: ines.accountId }).where(eq(s.shifts.id, shiftOfA)),
      ),
    ).toMatch(/permission denied/u);
    expect(
      await asOwner((tx) =>
        tx
          .update(s.shifts)
          .set({ endsAt: new Date('2099-11-02T05:00:00Z'), updatedBy: owner })
          .where(eq(s.shifts.id, shiftOfA)),
      ),
    ).toBe('no error');
  });

  it('makes a template’s occurrence once, cancelled, moved or not, and lets a template change only its end', async () => {
    const templateId = newId(ShiftTemplateIdSchema);
    const occurrence = new Date('2099-11-09T17:00:00Z');
    const moved = newId(ShiftIdSchema);
    await withTenantMember(test.app.db, nora.creatorId, owner, async (tx) => {
      await tx.insert(s.shiftTemplates).values({
        id: templateId,
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        memberId: member(chatterB),
        weekday: 1,
        startMinute: 1080,
        endMinute: 0,
        validFrom: '2099-11-09',
        createdBy: owner,
      });
      await tx.insert(s.shifts).values({
        ...shiftRow(nora, chatterB, '2099-11-09T17:00:00Z', '2099-11-09T23:00:00Z'),
        templateId,
        templateStartsAt: occurrence,
        cancelledAt: new Date(),
      });
      // The next Monday's, moved an hour later by hand: it stays that template's occurrence.
      await tx.insert(s.shifts).values({
        ...shiftRow(nora, chatterB, '2099-11-16T17:00:00Z', '2099-11-16T23:00:00Z'),
        id: moved,
        templateId,
        templateStartsAt: new Date('2099-11-16T17:00:00Z'),
      });
      await tx
        .update(s.shifts)
        .set({ startsAt: new Date('2099-11-16T18:00:00Z'), updatedBy: owner })
        .where(eq(s.shifts.id, moved));
    });
    const again = (startsAt: string, templateStartsAt: string) =>
      failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.insert(s.shifts).values({
            ...shiftRow(nora, chatterB, startsAt, startsAt.replace('T17', 'T23')),
            templateId,
            templateStartsAt: new Date(templateStartsAt),
          }),
        ),
      );
    expect(await again('2099-11-09T17:00:00Z', '2099-11-09T17:00:00Z')).toMatch(
      /shifts_template_occurrence_unique/u,
    );
    expect(await again('2099-11-23T17:00:00Z', '2099-11-16T17:00:00Z')).toMatch(
      /shifts_template_occurrence_unique/u,
    );
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.insert(s.shifts).values({
            ...shiftRow(nora, chatterB, '2099-11-30T17:00:00Z', '2099-11-30T23:00:00Z'),
            templateId,
          }),
        ),
      ),
    ).toMatch(/shifts_template_check/u);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.update(s.shiftTemplates).set({ weekday: 2 }).where(eq(s.shiftTemplates.id, templateId)),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx
            .update(s.shiftTemplates)
            .set({ validUntil: '2099-11-08' })
            .where(eq(s.shiftTemplates.id, templateId)),
        ),
      ),
    ).toBe('no error');
  });

  it('keeps a row’s account on its creator, whoever writes', async () => {
    const crossed = {
      ...shiftRow(nora, chatterB, '2099-11-20T00:00:00Z', '2099-11-20T06:00:00Z'),
      platformAccountId: ines.accountId,
    };
    expect(await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.shifts).values(crossed)))).toMatch(
      /shifts_account_creator_fk/u,
    );
    const template = {
      id: newId(ShiftTemplateIdSchema),
      creatorId: nora.creatorId,
      platformAccountId: ines.accountId,
      memberId: member(chatterB),
      weekday: 3,
      startMinute: 0,
      endMinute: 360,
      validFrom: '2099-11-04',
      createdBy: owner,
    };
    expect(
      await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.shiftTemplates).values(template))),
    ).toMatch(/shift_templates_account_creator_fk/u);
  });

  it('keeps a template within 23 hours, so a change of time never stretches it past a day', async () => {
    const template = (startMinute: number, endMinute: number) => ({
      id: newId(ShiftTemplateIdSchema),
      creatorId: nora.creatorId,
      platformAccountId: nora.accountId,
      memberId: member(chatterB),
      weekday: 4,
      startMinute,
      endMinute,
      validFrom: '2099-11-05',
      createdBy: owner,
    });
    expect(
      await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.shiftTemplates).values(template(60, 0)))),
    ).toBe('no error');
    expect(
      await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.shiftTemplates).values(template(59, 0)))),
    ).toMatch(/shift_templates_length_check/u);
  });

  it('keeps the past of the planning, even for the admin role of the job', async () => {
    const templateId = newId(ShiftTemplateIdSchema);
    const past = {
      ...shiftRow(nora, chatterB, '2020-03-02T00:00:00Z', '2020-03-02T06:00:00Z'),
      templateId,
      templateStartsAt: new Date('2020-03-02T00:00:00Z'),
    };
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.shiftTemplates).values({
        id: templateId,
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        memberId: member(chatterB),
        weekday: 1,
        startMinute: 60,
        endMinute: 420,
        validFrom: '2020-03-02',
        createdBy: owner,
      });
      await tx.insert(s.shifts).values(past);
    });
    const asAdmin = (fn: (tx: Transaction) => Promise<unknown>) => failure(withAdmin(test.admin.db, fn));
    // An ended shift no longer changes, and nothing is deleted.
    expect(
      await asAdmin((tx) =>
        tx.update(s.shifts).set({ cancelledAt: new Date() }).where(eq(s.shifts.id, past.id)),
      ),
    ).toMatch(/keeps its past/u);
    expect(await asAdmin((tx) => tx.delete(s.shifts).where(eq(s.shifts.id, past.id)))).toMatch(
      /keeps its past/u,
    );
    // A template changes nothing but its end, once.
    expect(
      await asAdmin((tx) =>
        tx.update(s.shiftTemplates).set({ startMinute: 120 }).where(eq(s.shiftTemplates.id, templateId)),
      ),
    ).toMatch(/keeps its past/u);
    expect(
      await asAdmin((tx) =>
        tx
          .update(s.shiftTemplates)
          .set({ validUntil: '2020-03-09' })
          .where(eq(s.shiftTemplates.id, templateId)),
      ),
    ).toBe('no error');
    expect(
      await asAdmin((tx) =>
        tx
          .update(s.shiftTemplates)
          .set({ validUntil: '2020-03-16' })
          .where(eq(s.shiftTemplates.id, templateId)),
      ),
    ).toMatch(/keeps its past/u);
    expect(
      await asAdmin((tx) => tx.delete(s.shiftTemplates).where(eq(s.shiftTemplates.id, templateId))),
    ).toMatch(/keeps its past/u);
  });

  it('a cancelled shift no longer changes; a stopped one ends on the minute it was stopped', async () => {
    const row = shiftRow(nora, chatterB, '2099-11-21T00:00:00Z', '2099-11-21T06:00:00Z');
    await withTenantMember(test.app.db, nora.creatorId, owner, async (tx) => {
      await tx.insert(s.shifts).values(row);
      await tx
        .update(s.shifts)
        .set({ cancelledAt: new Date(), updatedBy: owner })
        .where(eq(s.shifts.id, row.id));
    });
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.update(s.shifts).set({ cancelledAt: null, updatedBy: owner }).where(eq(s.shifts.id, row.id)),
        ),
      ),
    ).toMatch(/keeps its past/u);
    const stopped = {
      ...shiftRow(nora, chatterB, '2099-11-22T00:00:00Z', '2099-11-22T06:00:00Z'),
      stoppedAt: new Date('2099-11-22T03:12:40Z'),
    };
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) => tx.insert(s.shifts).values(stopped)),
      ),
    ).toMatch(/shifts_stopped_check/u);
    expect(
      await failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx.insert(s.shifts).values({ ...stopped, endsAt: new Date('2099-11-22T03:12:00Z') }),
        ),
      ),
    ).toBe('no error');
  });

  it('a shift under way keeps its start and its member and only ends earlier, even for the admin role', async () => {
    const minute = 60_000;
    const startsAt = new Date(Math.floor(Date.now() / minute) * minute - 60 * minute);
    const endsAt = new Date(startsAt.getTime() + 6 * 60 * minute);
    const row = shiftRow(nora, chatterB, startsAt.toISOString(), endsAt.toISOString());
    await withAdmin(test.admin.db, (tx) => tx.insert(s.shifts).values(row));
    const asOwner = (set: Partial<typeof s.shifts.$inferInsert>) =>
      failure(
        withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
          tx
            .update(s.shifts)
            .set({ ...set, updatedBy: owner })
            .where(eq(s.shifts.id, row.id)),
        ),
      );
    const later = (at: Date, minutes: number) => new Date(at.getTime() + minutes * minute);
    // Its start, earlier or later, its member and a later end are refused.
    expect(await asOwner({ startsAt: later(startsAt, -60) })).toMatch(/keeps its past/u);
    expect(await asOwner({ startsAt: later(startsAt, 30) })).toMatch(/keeps its past/u);
    expect(await asOwner({ memberId: member(chatterA) })).toMatch(/keeps its past/u);
    expect(await asOwner({ endsAt: later(endsAt, 60) })).toMatch(/keeps its past/u);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .update(s.shifts)
            .set({ endsAt: later(endsAt, 60) })
            .where(eq(s.shifts.id, row.id)),
        ),
      ),
    ).toMatch(/keeps its past/u);
    // It ends earlier, then stops on the minute; stopped, it has ended and no longer changes.
    expect(await asOwner({ endsAt: later(endsAt, -60) })).toBe('no error');
    const stoppedAt = new Date();
    expect(
      await asOwner({ endsAt: new Date(Math.floor(stoppedAt.getTime() / minute) * minute), stoppedAt }),
    ).toBe('no error');
    expect(await asOwner({ cancelledAt: new Date() })).toMatch(/keeps its past/u);
  });

  it('gives the application role neither DELETE nor TRUNCATE, whatever the base gave it', async () => {
    for (const table of ['scheduling_settings', 'shift_templates', 'shifts']) {
      expect(await failure(test.app.db.execute(sql.raw(`truncate "${table}"`)))).toMatch(
        /permission denied/u,
      );
      expect(await failure(test.app.db.execute(sql.raw(`delete from "${table}"`)))).toMatch(
        /permission denied/u,
      );
    }
  });

  it('every member reads the settings; the owner alone writes them, under their own name', async () => {
    const settings = {
      id: 1,
      timeZone: 'Europe/Paris',
      slotStartMinute: 0,
      slotLengthMinutes: 360,
      accessMarginMinutes: 15,
    };
    expect(
      await failure(
        withMember(test.app.db, manager, (tx) =>
          tx.insert(s.schedulingSettings).values({ ...settings, updatedBy: manager }),
        ),
      ),
    ).toMatch(/row-level security/u);
    await withMember(test.app.db, owner, (tx) =>
      tx.insert(s.schedulingSettings).values({ ...settings, updatedBy: owner }),
    );
    const read = await withMember(test.app.db, chatterA, (tx) =>
      tx.select({ margin: s.schedulingSettings.accessMarginMinutes }).from(s.schedulingSettings),
    );
    expect(read).toEqual([{ margin: 15 }]);
    const outside = await test.app.db.transaction((tx) => tx.select().from(s.schedulingSettings));
    expect(outside).toEqual([]);
    expect(
      await failure(
        withMember(test.app.db, owner, (tx) =>
          tx.insert(s.schedulingSettings).values({ ...settings, id: 2, updatedBy: owner }),
        ),
      ),
    ).toMatch(/scheduling_settings_single_check/u);
  });

  it('keeps the creator setting of withTenantMember inside its transaction', async () => {
    await withTenantMember(test.app.db, nora.creatorId, owner, () => Promise.resolve());
    const leaked = await test.app.db.execute<{ value: string | null }>(
      sql`select nullif(current_setting('app.creator_id', true), '') as value`,
    );
    expect(leaked.rows[0]?.value ?? null).toBeNull();
  });
});
