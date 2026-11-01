import {
  newId,
  PlanningConflictSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  type CreateShiftBody,
  type CreateShiftTemplateBody,
  type CreatorId,
  type CreatorSummary,
  type MyShift,
  type MyShifts,
  type OnDuty,
  type Planning,
  type PlanningQuery,
  type SchedulingSettings,
  type Shift,
  type ShiftId,
  type ShiftTemplate,
  type ShiftTemplateId,
  type UpdateShiftBody,
  type UserId,
} from '@nirvana/contracts';

import { CreatorNotFound } from '../domain/errors';
import { leaveCover } from '../domain/leaves';
import type {
  Actor,
  CreatorDirectory,
  PlanningAdmin,
  PlanningClock,
  PlanningStore,
  StoredShift,
  StoredTemplate,
} from '../domain/ports';
import {
  accessWindow,
  assertPlanningRange,
  conflictsOf,
  DEFAULT_SCHEDULING_SETTINGS,
  myShiftsOf,
} from '../domain/shifts';
import { addMinutes, calendarDayIn } from '../domain/time';

import { toPlanningAccount, toPlanningMember, toShiftDto } from './dto';

/** Équipe › Planning and Aujourd'hui (EQ-02, ADR 0025): reads for every member, writes for the planners. */
export interface SchedulingService {
  settings(actor: UserId): Promise<SchedulingSettings>;
  saveSettings(actor: Actor, settings: SchedulingSettings): Promise<SchedulingSettings>;
  planning(actor: UserId, query: PlanningQuery): Promise<Planning>;
  onDuty(actor: UserId): Promise<OnDuty[]>;
  myShifts(actor: UserId): Promise<MyShifts>;
  createShift(actor: Actor, body: CreateShiftBody): Promise<Shift>;
  /** `null` when the change cancelled the shift: stopped in the minute it started. */
  updateShift(actor: Actor, id: ShiftId, body: UpdateShiftBody): Promise<Shift | null>;
  cancelShift(actor: Actor, id: ShiftId): Promise<void>;
  templates(actor: UserId): Promise<ShiftTemplate[]>;
  createTemplate(actor: Actor, body: CreateShiftTemplateBody): Promise<ShiftTemplate>;
  endTemplate(actor: Actor, id: ShiftTemplateId): Promise<void>;
}

const toTemplate = (template: StoredTemplate): ShiftTemplate => ({ ...template });

export function createSchedulingService(
  store: PlanningStore,
  admin: PlanningAdmin,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): SchedulingService {
  const settingsOf = async (actor: UserId): Promise<SchedulingSettings> =>
    (await store.settings(actor)) ?? DEFAULT_SCHEDULING_SETTINGS;

  const clockOf = async (actor: UserId): Promise<PlanningClock> => ({
    now: now(),
    timeZone: (await settingsOf(actor)).timeZone,
  });

  const names = async (): Promise<ReadonlyMap<string, CreatorSummary>> =>
    new Map((await creators.list()).map((creator) => [creator.id, creator]));

  /** Every creator there is: the policies narrow what each scope reads of her. */
  const everyCreator = async (): Promise<CreatorId[]> => (await creators.list()).map((creator) => creator.id);

  const assertCreatorExists = async (creatorId: CreatorId): Promise<void> => {
    if (!(await names()).has(creatorId)) throw new CreatorNotFound();
  };

  return {
    settings: settingsOf,

    saveSettings: async (actor, settings) => {
      await store.saveSettings(actor, settings);
      return settings;
    },

    planning: async (actor, query) => {
      const from = new Date(query.from);
      const to = new Date(query.to);
      assertPlanningRange(from, to);
      const settings = await settingsOf(actor);
      // Every creator is read even when one is asked: a member busy on another creator stands in the way too.
      const read = await store.read(actor, await everyCreator(), {
        from: addMinutes(from, -24 * 60),
        to: addMinutes(to, 24 * 60),
      });
      const asked = (creatorId: string) => query.creatorId === undefined || creatorId === query.creatorId;
      const inRange = (shift: StoredShift) =>
        shift.startsAt.getTime() < to.getTime() && from.getTime() < shift.endsAt.getTime();
      const shifts = read.shifts.filter((shift) => asked(shift.creatorId) && inRange(shift));
      const templates = read.templates.filter((template) => asked(template.creatorId));
      // An occurrence during its member's leave is a shift to fill (ADR 0031), shown before anything else in its way.
      const leaves = read.leaves.flatMap((leave) => {
        const cover = leaveCover(leave);
        return cover === null ? [] : [{ id: leave.id, memberId: leave.memberId, ...cover }];
      });
      const conflicts = conflictsOf(
        templates,
        read.made,
        read.shifts,
        { from, to },
        now(),
        settings.timeZone,
        leaves,
      );
      const named = new Set([
        ...shifts.map((shift) => shift.memberId),
        ...templates.map((template) => template.memberId),
      ]);
      const creatorNames = await names();
      const accounts = read.accounts
        .filter((account) =>
          read.scope === 'self'
            ? shifts.some((shift) => shift.platformAccountId === account.id)
            : asked(account.creatorId),
        )
        .map((account) => toPlanningAccount(account, creatorNames));
      return {
        settings,
        accounts,
        members: read.members.filter((member) => named.has(member.id)).map(toPlanningMember),
        shifts: shifts.map(toShiftDto),
        conflicts:
          read.scope === 'self'
            ? []
            : conflicts.map((conflict) =>
                PlanningConflictSchema.parse({
                  ...conflict,
                  startsAt: conflict.startsAt.toISOString(),
                  endsAt: conflict.endsAt.toISOString(),
                }),
              ),
      };
    },

    onDuty: async (actor) => {
      const rows = await store.onDuty(actor, await everyCreator(), now());
      return rows.map(({ shift, member }) => ({
        creatorId: shift.creatorId,
        platformAccountId: shift.platformAccountId,
        member: toPlanningMember(member),
        shiftId: shift.id,
        endsAt: shift.endsAt.toISOString(),
      }));
    },

    myShifts: async (actor) => {
      const at = now();
      const { accessMarginMinutes: margin } = await settingsOf(actor);
      const mine = await admin.memberShiftsUnscoped(actor, addMinutes(at, -margin));
      if (mine?.status !== 'active') return { current: null, next: null, ended: null };
      const creatorNames = await names();
      const toMine = (shift: (typeof mine.shifts)[number] | null): MyShift | null => {
        if (shift === null) return null;
        const window = accessWindow(shift, margin);
        return {
          ...toShiftDto(shift),
          creatorName: creatorNames.get(shift.creatorId)?.displayName ?? '—',
          platform: shift.platform,
          handle: shift.handle,
          accessStartsAt: window.startsAt.toISOString(),
          accessEndsAt: window.endsAt.toISOString(),
        };
      };
      const picked = myShiftsOf(mine.shifts, at, margin);
      return { current: toMine(picked.current), next: toMine(picked.next), ended: toMine(picked.ended) };
    },

    createShift: async (actor, body) => {
      await assertCreatorExists(body.creatorId);
      const shift = await store.createShift(
        actor,
        {
          id: newId(ShiftIdSchema),
          creatorId: body.creatorId,
          platformAccountId: body.platformAccountId,
          memberId: body.memberId,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
        },
        await clockOf(actor.userId),
      );
      return toShiftDto(shift);
    },

    updateShift: async (actor, id, body) => {
      const shift = await store.updateShift(
        actor,
        id,
        {
          ...(body.memberId !== undefined && { memberId: body.memberId }),
          ...(body.startsAt !== undefined && { startsAt: new Date(body.startsAt) }),
          ...(body.endsAt !== undefined && { endsAt: new Date(body.endsAt) }),
        },
        await clockOf(actor.userId),
      );
      return shift === null ? null : toShiftDto(shift);
    },

    cancelShift: async (actor, id) => store.cancelShift(actor, id, await clockOf(actor.userId)),

    templates: async (actor) => {
      const today = calendarDayIn(now(), (await settingsOf(actor)).timeZone);
      return (await store.templates(actor, await everyCreator(), today)).map(toTemplate);
    },

    createTemplate: async (actor, body) => {
      await assertCreatorExists(body.creatorId);
      const template = await store.createTemplate(
        actor,
        { id: newId(ShiftTemplateIdSchema), ...body },
        await clockOf(actor.userId),
      );
      return toTemplate(template);
    },

    endTemplate: async (actor, id) => store.endTemplate(actor, id, await clockOf(actor.userId)),
  };
}
