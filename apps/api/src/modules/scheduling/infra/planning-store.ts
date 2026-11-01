import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  SchedulingSettingsSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type CreatorId,
  type ShiftId,
  type UserId,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  SNAPSHOT_READ,
  withAdmin,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@nirvana/db';

import { OwnerOnly, ShiftNotFound, ShiftTemplateNotFound } from '../domain/errors';
import type {
  Actor,
  PlanningAdmin,
  PlanningClock,
  PlanningStore,
  ShiftChange,
  StoredAccount,
  StoredMember,
  StoredShift,
  StoredTemplate,
} from '../domain/ports';
import {
  assertCancellable,
  assertEndsAhead,
  assertPlans,
  assertShiftRange,
  assertTemplateStart,
  decideUpdate,
  firstStartOf,
  occurrenceKey,
  occurrencesAhead,
} from '../domain/shifts';
import { addDays, calendarDayIn } from '../domain/time';

import {
  assertAccountOf,
  assertMemberJoined,
  assertMemberWorks,
  assertNotOnLeave,
  assertNotReported,
  audit,
  creatorOfUnscoped,
  leaveCovering,
  leavesOf,
  lockMembers,
  memberColumns,
  pgErrorOf,
  placed,
  shiftColumns,
  StoredAccountSchema,
  templateColumns,
  toMember,
  toShift,
  toTemplate,
} from './rows';

const { platformAccounts, schedulingSettings, shiftTemplates, shifts, teamMembers, user } = schema;

/** A shift that changed hands between its read and its lock (a swap): `updateShift` tries again. */
class MovedMeanwhile extends Error {}

/**
 * The shifts a template makes ahead, each once, under its member's lock: the occurrence key skips those already
 * made, an occurrence during the member's leave is not made (the planning shows it in `conflicts`, ADR 0031), and one
 * that overlaps another shift of its member or its account is skipped in its own savepoint. The member exclusion is
 * deferrable since 0023 (a swap of two shifts at the same hours), and a deferrable constraint is no arbiter of
 * `ON CONFLICT`: only the occurrence key is.
 */
async function makeShifts(
  tx: Transaction,
  template: StoredTemplate,
  by: string,
  clock: { readonly now: Date; readonly timeZone: string },
): Promise<number> {
  const ahead = occurrencesAhead(template, clock.now, clock.timeZone);
  const last = ahead.at(-1);
  if (last === undefined) return 0;
  await lockMembers(tx, [template.memberId]);
  const leaves = await leavesOf(tx, [template.memberId], clock.now, last.endsAt);
  let made = 0;
  for (const occurrence of ahead) {
    if (leaveCovering(leaves, template.memberId, occurrence.startsAt, occurrence.endsAt) !== undefined)
      continue;
    try {
      const rows = await tx.transaction((savepoint) =>
        savepoint
          .insert(shifts)
          .values({
            id: newId(ShiftIdSchema),
            creatorId: template.creatorId,
            platformAccountId: template.platformAccountId,
            memberId: template.memberId,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            templateId: template.id,
            templateStartsAt: occurrence.startsAt,
            createdBy: by,
            updatedBy: by,
          })
          .onConflictDoNothing({ target: [shifts.templateId, shifts.templateStartsAt] })
          .returning({ id: shifts.id }),
      );
      made += rows.length;
    } catch (error) {
      if (pgErrorOf(error)?.code !== '23P01') throw error;
    }
  }
  return made;
}

/**
 * The planning's tables through `withMember` and `withTenantMember` (the policies of ADR 0023 decide what each scope
 * reads and writes), plus Better Auth's `user` for a member's creators and `platform_accounts` for the accounts, both
 * read under the same policies. The admin connection is used for what crosses creators only.
 */
export function createDrizzlePlanningStore(db: Database, adminDb: Database): PlanningStore {
  /** The row about to change, locked; `null` when cancelled or out of the actor's sight. */
  const lockShift = async (tx: Transaction, id: ShiftId): Promise<StoredShift | null> => {
    const [row] = await tx
      .select({ ...shiftColumns, cancelledAt: shifts.cancelledAt })
      .from(shifts)
      .where(eq(shifts.id, id))
      .for('update');
    return row?.cancelledAt === null ? toShift(row) : null;
  };

  const inCreatorOf = async <T>(
    table: typeof shifts | typeof shiftTemplates,
    id: string,
    actor: Actor,
    notFound: () => Error,
    fn: (tx: Transaction, creatorId: CreatorId) => Promise<T>,
  ): Promise<T> => {
    const creatorId = await creatorOfUnscoped(adminDb, table, id);
    if (creatorId === null) throw notFound();
    return withTenantMember(db, creatorId, actor.userId, (tx, scope) => {
      assertPlans(scope);
      return fn(tx, CreatorIdSchema.parse(creatorId));
    });
  };

  /**
   * One try of `updateShift`. The member the shift goes to is locked before the row, as on every path (ADR 0031):
   * the shift is read first to know its member when the change keeps it.
   */
  const updateShiftOnce = (actor: Actor, id: ShiftId, change: ShiftChange, clock: PlanningClock) =>
    inCreatorOf(
      shifts,
      id,
      actor,
      () => new ShiftNotFound(),
      async (tx, creatorId) => {
        const [current] = await tx
          .select({ memberId: shifts.memberId })
          .from(shifts)
          .where(eq(shifts.id, id));
        if (current === undefined) throw new ShiftNotFound();
        await lockMembers(tx, [change.memberId ?? current.memberId]);
        const shift = await lockShift(tx, id);
        if (shift === null) throw new ShiftNotFound();
        if (change.memberId === undefined && shift.memberId !== current.memberId) throw new MovedMeanwhile();
        const update = decideUpdate(shift, change, clock.now);
        const signed = { updatedBy: actor.userId, updatedAt: clock.now };
        const byId = eq(shifts.id, id);
        switch (update.kind) {
          case 'plan': {
            if (update.memberId !== shift.memberId) {
              await assertMemberWorks(
                tx,
                TeamMemberIdSchema.parse(update.memberId),
                creatorId,
                update.startsAt,
              );
            } else if (update.startsAt.getTime() < shift.startsAt.getTime()) {
              await assertMemberJoined(tx, TeamMemberIdSchema.parse(update.memberId), update.startsAt);
            }
            await assertNotOnLeave(tx, update.memberId, update.startsAt, update.endsAt);
            const times = { memberId: update.memberId, startsAt: update.startsAt, endsAt: update.endsAt };
            await placed(
              adminDb,
              tx
                .update(shifts)
                .set({ ...times, ...signed })
                .where(byId),
              {
                ...shift,
                ...times,
              },
            );
            break;
          }
          case 'shorten':
            await tx
              .update(shifts)
              .set({ endsAt: update.endsAt, ...signed })
              .where(byId);
            break;
          case 'stop':
            await tx
              .update(shifts)
              .set({ endsAt: update.endsAt, stoppedAt: update.stoppedAt, ...signed })
              .where(byId);
            break;
          case 'cancel':
            await assertNotReported(tx, id);
            await tx
              .update(shifts)
              .set({ cancelledAt: clock.now, ...signed })
              .where(byId);
            break;
        }
        await audit(
          tx,
          actor,
          update.kind === 'cancel' ? 'shift.cancel' : 'shift.update',
          { kind: 'shift', id },
          {
            change: update.kind,
          },
        );
        return update.kind === 'cancel' ? null : lockShift(tx, id);
      },
    );

  return {
    settings: (actor) =>
      withMember(db, actor, async (tx) => {
        const [row] = await tx
          .select({
            timeZone: schedulingSettings.timeZone,
            slotStartMinute: schedulingSettings.slotStartMinute,
            slotLengthMinutes: schedulingSettings.slotLengthMinutes,
            accessMarginMinutes: schedulingSettings.accessMarginMinutes,
          })
          .from(schedulingSettings);
        return row === undefined ? null : SchedulingSettingsSchema.parse(row);
      }),

    saveSettings: (actor, settings) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new OwnerOnly();
        const values = { ...settings, updatedBy: actor.userId, updatedAt: new Date() };
        await tx
          .insert(schedulingSettings)
          .values({ id: 1, ...values })
          .onConflictDoUpdate({ target: schedulingSettings.id, set: values });
        await audit(
          tx,
          actor,
          'scheduling_settings.update',
          { kind: 'scheduling_settings', id: '1' },
          settings,
        );
      }),

    read: (actor, creatorIds, range) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          const plans = scope === 'owner' || scope === 'agency';
          const found: {
            shifts: StoredShift[];
            accounts: StoredAccount[];
            templates: StoredTemplate[];
            made: Set<string>;
          } = { shifts: [], accounts: [], templates: [], made: new Set() };
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select(shiftColumns)
              .from(shifts)
              .where(
                and(
                  sql`${shifts.cancelledAt} is null`,
                  sql`${shifts.startsAt} < ${range.to}`,
                  sql`${shifts.endsAt} > ${range.from}`,
                ),
              );
            found.shifts.push(...rows.map(toShift));
            const accounts = await tx
              .select({
                id: platformAccounts.id,
                creatorId: platformAccounts.creatorId,
                platform: platformAccounts.platform,
                handle: platformAccounts.handle,
              })
              .from(platformAccounts);
            found.accounts.push(...accounts.map((row) => StoredAccountSchema.parse(row)));
            if (!plans) continue;
            const templates = await tx
              .select(templateColumns)
              .from(shiftTemplates)
              .where(
                sql`${shiftTemplates.validUntil} is null or ${shiftTemplates.validUntil} >= ${addDays(range.from.toISOString().slice(0, 10), -1)}`,
              );
            found.templates.push(...templates.map(toTemplate));
            const made = await tx
              .select({ templateId: shifts.templateId, templateStartsAt: shifts.templateStartsAt })
              .from(shifts)
              .where(
                and(
                  sql`${shifts.templateId} is not null`,
                  sql`${shifts.templateStartsAt} >= ${range.from}`,
                  sql`${shifts.templateStartsAt} < ${range.to}`,
                ),
              );
            for (const row of made) {
              if (row.templateId !== null && row.templateStartsAt !== null) {
                found.made.add(occurrenceKey(row.templateId, row.templateStartsAt));
              }
            }
          }
          const named = [...new Set([...found.shifts, ...found.templates].map((row) => row.memberId))];
          const members =
            named.length === 0
              ? []
              : await tx.select(memberColumns).from(teamMembers).where(inArray(teamMembers.id, named));
          const planned = [...new Set(found.templates.map((template) => template.memberId))];
          const leaves = plans ? await leavesOf(tx, planned, range.from, range.to) : [];
          return { scope, ...found, leaves, members: members.map(toMember) };
        },
        SNAPSHOT_READ,
      ),

    onDuty: (actor, creatorIds, at) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          assertPlans(scope);
          const onDuty: { shift: StoredShift; member: StoredMember }[] = [];
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select({ shift: shiftColumns, member: memberColumns })
              .from(shifts)
              .innerJoin(teamMembers, eq(teamMembers.id, shifts.memberId))
              .where(
                and(
                  sql`${shifts.cancelledAt} is null`,
                  sql`${shifts.startsAt} <= ${at}`,
                  sql`${shifts.endsAt} > ${at}`,
                  eq(teamMembers.status, 'active'),
                ),
              );
            onDuty.push(...rows.map((row) => ({ shift: toShift(row.shift), member: toMember(row.member) })));
          }
          return onDuty;
        },
        SNAPSHOT_READ,
      ),

    createShift: (actor, shift, clock) =>
      withTenantMember(db, shift.creatorId, actor.userId, async (tx, scope) => {
        assertPlans(scope);
        assertShiftRange(shift.startsAt, shift.endsAt);
        assertEndsAhead(shift.endsAt, clock.now);
        await lockMembers(tx, [shift.memberId]);
        await assertMemberWorks(tx, shift.memberId, shift.creatorId, shift.startsAt);
        await assertAccountOf(tx, shift.platformAccountId);
        await assertNotOnLeave(tx, shift.memberId, shift.startsAt, shift.endsAt);
        await placed(
          adminDb,
          tx.insert(shifts).values({ ...shift, createdBy: actor.userId, updatedBy: actor.userId }),
          shift,
        );
        await audit(tx, actor, 'shift.create', { kind: 'shift', id: shift.id });
        return { ...shift, templateId: null, stoppedAt: null };
      }),

    updateShift: async (actor, id, change, clock) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await updateShiftOnce(actor, id, change, clock);
        } catch (error) {
          // The shift changed hands between its read and its lock (a swap): read and lock again.
          if (!(error instanceof MovedMeanwhile) || attempt === 3) throw error;
        }
      }
    },

    cancelShift: (actor, id, clock) =>
      inCreatorOf(
        shifts,
        id,
        actor,
        () => new ShiftNotFound(),
        async (tx) => {
          const shift = await lockShift(tx, id);
          if (shift === null) throw new ShiftNotFound();
          assertCancellable(shift, clock.now);
          await assertNotReported(tx, id);
          await tx
            .update(shifts)
            .set({ cancelledAt: clock.now, updatedBy: actor.userId, updatedAt: clock.now })
            .where(eq(shifts.id, id));
          await audit(tx, actor, 'shift.cancel', { kind: 'shift', id });
        },
      ),

    templates: (actor, creatorIds, today) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          assertPlans(scope);
          const running: StoredTemplate[] = [];
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select(templateColumns)
              .from(shiftTemplates)
              .where(sql`${shiftTemplates.validUntil} is null or ${shiftTemplates.validUntil} >= ${today}`);
            running.push(...rows.map(toTemplate));
          }
          return running.toSorted(
            (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute || a.id.localeCompare(b.id),
          );
        },
        SNAPSHOT_READ,
      ),

    createTemplate: (actor, template, clock) =>
      withTenantMember(db, template.creatorId, actor.userId, async (tx, scope) => {
        assertPlans(scope);
        assertTemplateStart(template.validFrom, calendarDayIn(clock.now, clock.timeZone));
        await assertMemberWorks(
          tx,
          template.memberId,
          template.creatorId,
          firstStartOf({ ...template, validUntil: null }, clock.timeZone),
        );
        await assertAccountOf(tx, template.platformAccountId);
        await tx.insert(shiftTemplates).values({ ...template, createdBy: actor.userId });
        const stored = { ...template, validUntil: null };
        const made = await makeShifts(tx, stored, actor.userId, clock);
        await audit(
          tx,
          actor,
          'shift_template.create',
          { kind: 'shift_template', id: template.id },
          { shiftsMade: made },
        );
        return stored;
      }),

    endTemplate: (actor, id, clock) =>
      inCreatorOf(
        shiftTemplates,
        id,
        actor,
        () => new ShiftTemplateNotFound(),
        async (tx) => {
          const [row] = await tx
            .select(templateColumns)
            .from(shiftTemplates)
            .where(eq(shiftTemplates.id, id))
            .for('update');
          // An ended template no longer changes (`shift_templates_kept`): ended once, it is not found again.
          if (row?.validUntil !== null) throw new ShiftTemplateNotFound();
          const today = calendarDayIn(clock.now, clock.timeZone);
          const dayBefore = addDays(row.validFrom, -1);
          // A template that has not started yet ends the day before its first: it never runs.
          await tx
            .update(shiftTemplates)
            .set({ validUntil: today > dayBefore ? today : dayBefore })
            .where(eq(shiftTemplates.id, id));
          const cancelled = await tx
            .update(shifts)
            .set({ cancelledAt: clock.now, updatedBy: actor.userId, updatedAt: clock.now })
            .where(
              and(
                eq(shifts.templateId, id),
                sql`${shifts.cancelledAt} is null`,
                sql`${shifts.startsAt} > ${clock.now}`,
              ),
            )
            .returning({ id: shifts.id });
          await audit(
            tx,
            actor,
            'shift_template.end',
            { kind: 'shift_template', id },
            { shiftsCancelled: cancelled.length },
          );
        },
      ),
  };
}

/** The reads and the job that cross creators, on the admin connection (BYPASSRLS): named `*Unscoped`. */
export function createDrizzlePlanningAdmin(adminDb: Database): PlanningAdmin {
  return {
    memberShiftsUnscoped: (userId: UserId, since: Date) =>
      withAdmin(adminDb, async (tx) => {
        const [member] = await tx
          .select({ id: teamMembers.id, status: teamMembers.status })
          .from(teamMembers)
          .where(eq(teamMembers.userId, userId));
        if (member === undefined) return null;
        const rows = await tx
          .select({
            shift: shiftColumns,
            platform: platformAccounts.platform,
            handle: platformAccounts.handle,
          })
          .from(shifts)
          .innerJoin(platformAccounts, eq(platformAccounts.id, shifts.platformAccountId))
          .where(
            and(
              eq(shifts.memberId, member.id),
              sql`${shifts.cancelledAt} is null`,
              sql`${shifts.endsAt} > ${since}`,
            ),
          );
        return {
          status: TeamMemberStatusSchema.parse(member.status),
          shifts: rows.map((row) => ({
            ...toShift(row.shift),
            platform: PlatformSchema.parse(row.platform),
            handle: row.handle,
          })),
        };
      }),

    onShiftUnscoped: (creatorId, at) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            memberId: shifts.memberId,
            platformAccountId: shifts.platformAccountId,
            shiftId: shifts.id,
            endsAt: shifts.endsAt,
          })
          .from(shifts)
          .innerJoin(teamMembers, eq(teamMembers.id, shifts.memberId))
          .where(
            and(
              eq(shifts.creatorId, creatorId),
              sql`${shifts.cancelledAt} is null`,
              sql`${shifts.startsAt} <= ${at}`,
              sql`${shifts.endsAt} > ${at}`,
              eq(teamMembers.status, 'active'),
            ),
          );
        return rows.map((row) => ({
          memberId: TeamMemberIdSchema.parse(row.memberId),
          platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
          shiftId: ShiftIdSchema.parse(row.shiftId),
          endsAt: row.endsAt,
        }));
      }),

    settingsUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            timeZone: schedulingSettings.timeZone,
            slotStartMinute: schedulingSettings.slotStartMinute,
            slotLengthMinutes: schedulingSettings.slotLengthMinutes,
            accessMarginMinutes: schedulingSettings.accessMarginMinutes,
          })
          .from(schedulingSettings);
        return row === undefined ? null : SchedulingSettingsSchema.parse(row);
      }),

    runningTemplatesUnscoped: (today) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ id: shiftTemplates.id })
          .from(shiftTemplates)
          .where(sql`${shiftTemplates.validUntil} is null or ${shiftTemplates.validUntil} >= ${today}`);
        return rows.map((row) => ShiftTemplateIdSchema.parse(row.id));
      }),

    makeTemplateShiftsUnscoped: (id, clock) =>
      withAdmin(adminDb, async (tx) => {
        // Locked as `endTemplate` locks it: a template ended meanwhile is read ended, and makes nothing past its end.
        const [row] = await tx
          .select({
            template: templateColumns,
            createdBy: shiftTemplates.createdBy,
            status: teamMembers.status,
            creatorIds: user.creatorIds,
          })
          .from(shiftTemplates)
          .innerJoin(teamMembers, eq(teamMembers.id, shiftTemplates.memberId))
          .innerJoin(user, eq(user.id, teamMembers.userId))
          .where(eq(shiftTemplates.id, id))
          .for('update', { of: shiftTemplates });
        if (row === undefined) return 0;
        const template = toTemplate(row.template);
        // A member who left, is away or no longer works on the creator gets no new shift from it.
        if (row.status !== 'active' || !row.creatorIds.includes(template.creatorId)) return 0;
        // An occurrence that overlaps another shift is skipped, not an error (`ON CONFLICT DO NOTHING`).
        return makeShifts(tx, template, row.createdBy, clock);
      }),
  };
}
