import {
  CreatorIdSchema,
  newId,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type {
  CreatorDirectory,
  PlanningStore,
  ShiftReportStore,
  StoredShift,
  StoredShiftReport,
} from '../../domain/ports';
import { createSchedulingReads, type ScheduleReader } from '../team-reads';

type PlanningRead = Awaited<ReturnType<PlanningStore['read']>>;
type ReportsRead = Awaited<ReturnType<ShiftReportStore['list']>>;

const anna = newId(CreatorIdSchema);
const bea = newId(CreatorIdSchema);
const gone = newId(CreatorIdSchema);
const annas = newId(PlatformAccountIdSchema);
const beas = newId(PlatformAccountIdSchema);
const theo = newId(TeamMemberIdSchema);
const lou = newId(TeamMemberIdSchema);
const owner: ScheduleReader = { userId: newId(UserIdSchema), role: 'owner' };
const P1 = PayPeriodSchema.parse('2026-11-01');
const range = { from: new Date('2026-11-02T00:00:00Z'), to: new Date('2026-11-03T00:00:00Z') };

const directory: CreatorDirectory = {
  list: () =>
    Promise.resolve([
      { id: anna, displayName: 'Anna', timezone: 'Europe/Paris', archived: false },
      { id: bea, displayName: 'Béa', timezone: 'Europe/Paris', archived: true },
    ]),
};

const shift = (patch: Partial<StoredShift>): StoredShift => ({
  id: newId(ShiftIdSchema),
  creatorId: anna,
  platformAccountId: annas,
  memberId: theo,
  startsAt: new Date('2026-11-02T08:00:00Z'),
  endsAt: new Date('2026-11-02T12:00:00Z'),
  templateId: null,
  stoppedAt: null,
  ...patch,
});

const planningRead = (patch: Partial<PlanningRead>): PlanningRead => ({
  scope: 'owner',
  planned: null,
  shifts: [],
  accounts: [],
  templates: [],
  made: new Set(),
  leaves: [],
  members: [
    { id: theo, displayName: 'Théo', color: null, status: 'active' },
    { id: lou, displayName: 'Lou', color: null, status: 'active' },
  ],
  ...patch,
});

/** The planning's store in memory: what it was asked, and what it answers. */
function planningStore(answer: PlanningRead) {
  const asked: { actor: string; creatorIds: readonly CreatorId[] }[] = [];
  const store: Pick<PlanningStore, 'read'> = {
    read: (actor, creatorIds) => {
      asked.push({ actor, creatorIds });
      return Promise.resolve(answer);
    },
  };
  return { asked, store };
}

const report = (patch: Partial<StoredShiftReport>): StoredShiftReport => ({
  id: newId(ShiftReportIdSchema),
  shiftId: newId(ShiftIdSchema),
  creatorId: anna,
  platformAccountId: annas,
  memberId: theo,
  period: P1,
  correctsId: null,
  amountMinor: 12_000,
  currency: 'EUR',
  comment: 'Un texte que seul l’écran montre',
  incident: 'Un incident raconté par le chatteur',
  status: 'rejected',
  version: 2,
  byAgency: false,
  submittedBy: owner.userId,
  submittedAt: new Date('2026-11-02T13:00:00Z'),
  reviewedAt: new Date('2026-11-02T15:00:00Z'),
  reviewNote: 'Une note de refus',
  reviewKind: 'human',
  explanation: 'Une explication',
  check: null,
  earningsSource: 'declared',
  createdAt: new Date('2026-11-02T13:00:00Z'),
  ...patch,
});

function reportStore(reports: StoredShiftReport[]) {
  const asked: { creatorIds: readonly CreatorId[]; period: string | null }[] = [];
  const store: Pick<ShiftReportStore, 'list'> = {
    list: (_actor, creatorIds, period) => {
      asked.push({ creatorIds, period });
      const read: ReportsRead = {
        reports,
        shifts: [],
        accounts: [],
        members: [{ id: theo, displayName: 'Théo', color: null, status: 'active' }],
        reader: { memberId: null, scope: 'owner', userId: owner.userId },
      };
      return Promise.resolve(read);
    },
  };
  return { asked, store };
}

const noReports = reportStore([]).store;

describe('createSchedulingReads (ADR 0026 § 1)', () => {
  it('refuses a creator’s account before reading anything, as the routes refuse her session', async () => {
    const planning = planningStore(planningRead({}));
    const reports = reportStore([]);
    const reads = createSchedulingReads(planning.store, reports.store, directory);
    const creator: ScheduleReader = { userId: owner.userId, role: 'creator' };
    await expect(reads.shifts(creator, 'all', range)).rejects.toMatchObject({ code: 'role_forbidden' });
    await expect(reads.shiftReports(creator, 'all', P1)).rejects.toMatchObject({ code: 'role_forbidden' });
    expect(planning.asked).toEqual([]);
    expect(reports.asked).toEqual([]);
  });

  it('reads only the creators named that exist, archived ones included, and nothing for none', async () => {
    const planning = planningStore(planningRead({}));
    const reads = createSchedulingReads(planning.store, noReports, directory);
    await reads.shifts(owner, 'all', range);
    await reads.shifts(owner, [bea, gone], range);
    expect(await reads.shifts(owner, [gone], range)).toEqual([]);
    expect(await reads.shifts(owner, [], range)).toEqual([]);
    expect(planning.asked).toEqual([
      { actor: owner.userId, creatorIds: [anna, bea] },
      { actor: owner.userId, creatorIds: [bea] },
    ]);
  });

  it('keeps a manager to what he plans and to the range, the earliest first, by name, stopped ones said', async () => {
    const late = shift({
      startsAt: new Date('2026-11-02T18:00:00Z'),
      endsAt: new Date('2026-11-02T20:00:00Z'),
    });
    const early = shift({
      memberId: lou,
      startsAt: new Date('2026-11-01T22:00:00Z'),
      endsAt: new Date('2026-11-02T01:30:00Z'),
      stoppedAt: new Date('2026-11-02T01:30:00Z'),
    });
    const elsewhere = shift({ creatorId: bea, platformAccountId: beas });
    const before = shift({
      startsAt: new Date('2026-11-01T08:00:00Z'),
      endsAt: new Date('2026-11-01T12:00:00Z'),
    });
    const planning = planningStore(
      planningRead({ scope: 'agency', planned: new Set([anna]), shifts: [late, elsewhere, before, early] }),
    );
    const reads = createSchedulingReads(planning.store, noReports, directory);
    const manager: ScheduleReader = { userId: newId(UserIdSchema), role: 'operator' };
    expect(await reads.shifts(manager, 'all', range)).toEqual([
      {
        id: early.id,
        creatorId: anna,
        platformAccountId: annas,
        memberId: lou,
        memberName: 'Lou',
        startsAt: '2026-11-01T22:00:00.000Z',
        endsAt: '2026-11-02T01:30:00.000Z',
        stopped: true,
      },
      {
        id: late.id,
        creatorId: anna,
        platformAccountId: annas,
        memberId: theo,
        memberName: 'Théo',
        startsAt: '2026-11-02T18:00:00.000Z',
        endsAt: '2026-11-02T20:00:00.000Z',
        stopped: false,
      },
    ]);
  });

  it('refuses a range the planning refuses', async () => {
    const reads = createSchedulingReads(planningStore(planningRead({})).store, noReports, directory);
    await expect(
      reads.shifts(owner, 'all', { from: range.from, to: new Date('2027-01-01T00:00:00Z') }),
    ).rejects.toMatchObject({ code: 'planning_range_invalid' });
    await expect(reads.shifts(owner, 'all', { from: range.to, to: range.from })).rejects.toMatchObject({
      code: 'planning_range_invalid',
    });
  });

  it('reads a report’s amount, state and dates, never a text a person wrote nor its check', async () => {
    const first = report({
      submittedAt: new Date('2026-11-02T09:00:00Z'),
      reviewedAt: null,
      status: 'submitted',
    });
    const second = report({ memberId: lou });
    const reports = reportStore([second, first]);
    const reads = createSchedulingReads(planningStore(planningRead({})).store, reports.store, directory);
    const read = await reads.shiftReports(owner, [anna], P1);
    expect(reports.asked).toEqual([{ creatorIds: [anna], period: P1 }]);
    expect(read.map((one) => one.id)).toEqual([first.id, second.id]);
    expect(read[1]).toEqual({
      id: second.id,
      shiftId: second.shiftId,
      creatorId: anna,
      platformAccountId: annas,
      memberId: lou,
      memberName: null,
      period: P1,
      correctsId: null,
      amountMinor: 12_000,
      currency: 'EUR',
      status: 'rejected',
      byAgency: false,
      submittedAt: '2026-11-02T13:00:00.000Z',
      reviewedAt: '2026-11-02T15:00:00.000Z',
    });
    const text = JSON.stringify(read);
    for (const written of ['écran', 'incident', 'refus', 'explication']) expect(text).not.toContain(written);
  });
});
