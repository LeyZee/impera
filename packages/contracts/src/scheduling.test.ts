import { describe, expect, it } from 'vitest';

import { CREATOR_TASK_CATEGORY_EMOJI } from './creator-tasks';
import {
  AnswerShiftSwapRequestBodySchema,
  CREATOR_REPLIES_EMOJI,
  CreateLeaveRequestBodySchema,
  CreateShiftBodySchema,
  CreateShiftSwapRequestBodySchema,
  CreateShiftTemplateBodySchema,
  DecideLeaveRequestBodySchema,
  LeaveRequestSchema,
  MyShiftsSchema,
  PlanningConflictSchema,
  PlanningSchema,
  SCHEDULING_ERROR_CODES,
  SchedulingSettingsSchema,
  ShiftSlotsSchema,
  slotVersionAt,
  SlotVersionSchema,
  slotWindowsOf,
  SHIFT_TEMPLATE_MAX_MINUTES,
  ShiftSwapListSchema,
  ShiftSwapRequestSchema,
  shiftSlotsOf,
  SwapCandidatesSchema,
  templateLengthMinutes,
  UpdateShiftBodySchema,
} from './scheduling';

const CREATOR = '0199f2a0-0000-7000-8000-0000000000c1';
const ACCOUNT = '0199f2a0-0000-7000-8000-0000000000a1';
const MEMBER = '0199f2a0-0000-7000-8000-0000000000e1';
const COLLEAGUE = '0199f2a0-0000-7000-8000-0000000000e2';
const TEMPLATE = '0199f2a0-0000-7000-8000-0000000000b1';
const LEAVE = '0199f2a0-0000-7000-8000-0000000000d1';
const SWAP = '0199f2a0-0000-7000-8000-0000000000d2';

const shift = {
  id: '0199f2a0-0000-7000-8000-0000000000f1',
  creatorId: CREATOR,
  platformAccountId: ACCOUNT,
  memberId: MEMBER,
  startsAt: '2026-10-28T23:00:00Z',
  endsAt: '2026-10-29T05:00:00Z',
  templateId: null,
};

const four = (start = 0) =>
  [0, 1, 2, 3].map((index) => ({
    startMinute: (start + index * 360) % 1440,
    endMinute: (start + (index + 1) * 360) % 1440,
    name: null,
  }));

const settings = {
  timeZone: 'Europe/Paris',
  accessMarginMinutes: 15,
  versions: [{ id: null, effectiveAt: null, slots: four(), seats: [] }],
};

/** Wall-clock minutes read as UTC: enough for the cuts, the zones are the apps' (their tests cover the changes of time). */
const utc = (day: string, minute: number): Date => new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000);
const hours = (windows: readonly { from: Date; to: Date }[]) =>
  windows.map(
    (window) => `${window.from.toISOString().slice(5, 16)}→${window.to.toISOString().slice(11, 16)}`,
  );

describe('planning settings', () => {
  it('reads the créneaux of the version in force', () => {
    expect(shiftSlotsOf(SchedulingSettingsSchema.parse(settings))).toEqual(four());
    const later = {
      id: '0199f2a0-0000-7000-8000-0000000000aa',
      effectiveAt: '2026-11-09T00:00:00Z',
      slots: four(120),
      seats: [],
    };
    const both = SchedulingSettingsSchema.parse({ ...settings, versions: [...settings.versions, later] });
    expect(slotVersionAt(both.versions, new Date('2026-11-08T23:59:00Z')).id).toBe(null);
    expect(shiftSlotsOf(both, new Date('2026-11-09T00:00:00Z'))[0]).toEqual({
      startMinute: 120,
      endMinute: 480,
      name: null,
    });
  });

  it('takes créneaux of 1 h to 12 h, on the hour, that cover the day once, two at least (ADR 0049 § 1)', () => {
    const ok = (slots: unknown) => ShiftSlotsSchema.safeParse(slots).success;
    expect(ok(four(120))).toBe(true);
    expect(
      ok([
        { startMinute: 1260, endMinute: 360, name: 'Nuit' },
        { startMinute: 360, endMinute: 1080, name: null },
        { startMinute: 1080, endMinute: 1260, name: 'Live' },
      ]),
    ).toBe(true);
    // Half past, a gap, an overlap, thirteen hours, a single créneau.
    expect(ok(four(30))).toBe(false);
    expect(ok([four()[0], four()[2], four()[3]])).toBe(false);
    expect(
      ok([
        { startMinute: 0, endMinute: 720, name: null },
        { startMinute: 600, endMinute: 0, name: null },
      ]),
    ).toBe(false);
    expect(
      ok([
        { startMinute: 0, endMinute: 780, name: null },
        { startMinute: 780, endMinute: 0, name: null },
      ]),
    ).toBe(false);
    expect(ok([{ startMinute: 0, endMinute: 0, name: null }])).toBe(false);
  });

  it('keeps a seat on a créneau of its version, one or two chatters', () => {
    const seat = { slotRank: 3, platformAccountId: ACCOUNT, seats: 2 };
    const version = { id: null, effectiveAt: null, slots: four(), seats: [seat] };
    expect(SlotVersionSchema.safeParse(version).success).toBe(true);
    expect(SlotVersionSchema.safeParse({ ...version, seats: [{ ...seat, slotRank: 4 }] }).success).toBe(
      false,
    );
    expect(SlotVersionSchema.safeParse({ ...version, seats: [{ ...seat, seats: 3 }] }).success).toBe(false);
  });

  it('cuts each day at its first créneau, the night after midnight on the day before', () => {
    const [version] = SchedulingSettingsSchema.parse({
      ...settings,
      versions: [{ ...settings.versions[0], slots: four(300) }],
    }).versions;
    const windows = slotWindowsOf(version === undefined ? [] : [version], ['2026-11-04'], utc);
    expect(hours(windows)).toEqual([
      '11-04T05:00→11:00',
      '11-04T11:00→17:00',
      '11-04T17:00→23:00',
      '11-04T23:00→05:00',
    ]);
    expect(windows.map((window) => [window.day, window.rank])).toEqual([
      ['2026-11-04', 0],
      ['2026-11-04', 1],
      ['2026-11-04', 2],
      ['2026-11-04', 3],
    ]);
  });

  it('cuts a day that changes version where the new one takes effect, the créneau before giving way or stretching', () => {
    const eight = [0, 1, 2].map((index) => ({
      startMinute: index * 480,
      endMinute: ((index + 1) * 480) % 1440,
      name: null,
    }));
    const versions = SchedulingSettingsSchema.parse({
      ...settings,
      versions: [
        ...settings.versions,
        {
          id: '0199f2a0-0000-7000-8000-0000000000aa',
          effectiveAt: '2026-11-04T10:00:00Z',
          slots: eight,
          seats: [],
        },
      ],
    }).versions;
    // 0–6 and 6–12 began under the old créneaux; the first new one to begin is 16 h: 6–12 stretches to it.
    expect(hours(slotWindowsOf(versions, ['2026-11-04'], utc))).toEqual([
      '11-04T00:00→06:00',
      '11-04T06:00→16:00',
      '11-04T16:00→00:00',
    ]);
    expect(hours(slotWindowsOf(versions, ['2026-11-05'], utc))).toEqual([
      '11-05T00:00→08:00',
      '11-05T08:00→16:00',
      '11-05T16:00→00:00',
    ]);
    // Before its date, the first version holds every day.
    expect(hours(slotWindowsOf(versions, ['2026-11-03'], utc))).toHaveLength(4);
  });

  it('keeps the old créneau that began before a version taking effect later in the day, cut where the new one begins', () => {
    const versions = SchedulingSettingsSchema.parse({
      ...settings,
      versions: [
        ...settings.versions,
        {
          id: '0199f2a0-0000-7000-8000-0000000000aa',
          effectiveAt: '2026-11-09T05:00:00Z',
          slots: four(300),
          seats: [],
        },
      ],
    }).versions;
    // Monday 0 h began under the old créneaux: it runs to 5 h, where the new ones begin, with no hole and no overlap.
    expect(hours(slotWindowsOf(versions, ['2026-11-08', '2026-11-09'], utc))).toEqual([
      '11-08T00:00→06:00',
      '11-08T06:00→12:00',
      '11-08T12:00→18:00',
      '11-08T18:00→00:00',
      '11-09T00:00→05:00',
      '11-09T05:00→11:00',
      '11-09T11:00→17:00',
      '11-09T17:00→23:00',
      '11-09T23:00→05:00',
    ]);
  });

  it('keeps the chatter’s margin short: two hours at most (ADR 0025)', () => {
    expect(SchedulingSettingsSchema.safeParse({ ...settings, accessMarginMinutes: 121 }).success).toBe(false);
    expect(SchedulingSettingsSchema.safeParse({ ...settings, accessMarginMinutes: 0 }).success).toBe(true);
  });

  it('refuses an unknown zone for the grid', () => {
    expect(SchedulingSettingsSchema.safeParse({ ...settings, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('shifts and templates', () => {
  it('takes a shift as two UTC instants, never a wall-clock time', () => {
    const body = {
      creatorId: CREATOR,
      platformAccountId: ACCOUNT,
      memberId: MEMBER,
      startsAt: '2026-10-28T23:00:00Z',
      endsAt: '2026-10-29T05:00:00Z',
    };
    expect(CreateShiftBodySchema.safeParse(body).success).toBe(true);
    expect(CreateShiftBodySchema.safeParse({ ...body, startsAt: '2026-10-29 00:00' }).success).toBe(false);
  });

  it('changes a shift only when something changes', () => {
    expect(UpdateShiftBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateShiftBodySchema.safeParse({ endsAt: '2026-10-29T03:00:00Z' }).success).toBe(true);
  });

  it('takes a night template that ends the next day, never one that ends when it starts', () => {
    const template = {
      creatorId: CREATOR,
      platformAccountId: ACCOUNT,
      memberId: MEMBER,
      weekday: 7,
      startMinute: 1080,
      endMinute: 0,
      validFrom: '2026-11-02',
    };
    expect(CreateShiftTemplateBodySchema.safeParse(template).success).toBe(true);
    const same = CreateShiftTemplateBodySchema.safeParse({ ...template, endMinute: 1080 });
    expect(same.success).toBe(false);
    // The rule, not a fact (recette 28/10, as her hours' ranges).
    expect(same.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['endMinute'],
        message: 'Un modèle doit commencer et finir à des heures différentes',
      }),
    );
    expect(CreateShiftTemplateBodySchema.safeParse({ ...template, weekday: 0 }).success).toBe(false);
  });

  it('keeps a template an hour short of a day, so the autumn change of time never stretches it past one', () => {
    const template = {
      creatorId: CREATOR,
      platformAccountId: ACCOUNT,
      memberId: MEMBER,
      weekday: 6,
      startMinute: 60,
      endMinute: 0,
      validFrom: '2026-11-02',
    };
    expect(templateLengthMinutes(template)).toBe(1380);
    expect(templateLengthMinutes({ startMinute: 1080, endMinute: 0 })).toBe(360);
    expect(SHIFT_TEMPLATE_MAX_MINUTES).toBe(1380);
    expect(CreateShiftTemplateBodySchema.safeParse(template).success).toBe(true);
    expect(CreateShiftTemplateBodySchema.safeParse({ ...template, startMinute: 59 }).success).toBe(false);
  });

  it('reads an empty planning', () => {
    const empty = { settings, accounts: [], members: [], shifts: [], conflicts: [], away: [] };
    expect(PlanningSchema.parse(empty).shifts).toEqual([]);
  });

  it('names the members away from the team, never one who is active (recette EQP-03)', () => {
    const empty = { settings, accounts: [], members: [], shifts: [], conflicts: [] };
    // A planning read before the field, still in a cache: nobody away.
    expect(PlanningSchema.parse(empty).away).toEqual([]);
    const away = PlanningSchema.parse({ ...empty, away: [{ memberId: MEMBER, status: 'suspended' }] }).away;
    expect(away).toEqual([{ memberId: MEMBER, status: 'suspended' }]);
    expect(
      PlanningSchema.safeParse({ ...empty, away: [{ memberId: MEMBER, status: 'active' }] }).success,
    ).toBe(false);
  });

  it('gives a chatter their own shifts, the accounts those are on, themselves alone and no conflict', () => {
    const chatterPlanning = {
      settings,
      accounts: [
        {
          id: ACCOUNT,
          creatorId: CREATOR,
          creatorName: 'Nora Vidal',
          platform: 'reveal',
          handle: 'nora',
          archived: false,
        },
      ],
      members: [{ id: MEMBER, displayName: 'Théo', color: '#c2410c' }],
      shifts: [{ ...shift, stoppedAt: null }],
      conflicts: [],
      away: [],
    };
    const planning = PlanningSchema.parse(chatterPlanning);
    expect(planning.members.map((member) => member.id)).toEqual([MEMBER]);
    expect(planning.shifts.every((one) => one.memberId === MEMBER)).toBe(true);
    // Whether her creator is archived is always said (ADR 0071 § 2): the screen never guesses it.
    const unsaid = {
      id: ACCOUNT,
      creatorId: CREATOR,
      creatorName: 'Nora Vidal',
      platform: 'reveal',
      handle: 'nora',
    };
    expect(PlanningSchema.safeParse({ ...chatterPlanning, accounts: [unsaid] }).success).toBe(false);
  });

  it('tells Aujourd’hui which account to open and when the creators open and close', () => {
    const mine = {
      ...shift,
      stoppedAt: null,
      creatorName: 'Nora Vidal',
      platform: 'reveal',
      handle: 'nora',
      accessStartsAt: '2026-10-28T22:45:00Z',
      accessEndsAt: '2026-10-29T05:15:00Z',
    };
    expect(MyShiftsSchema.parse({ current: null, next: mine, ended: null }).next?.handle).toBe('nora');
    expect(
      MyShiftsSchema.safeParse({ current: null, next: { ...mine, platform: undefined }, ended: null })
        .success,
    ).toBe(false);
    // In the end margin: on no shift, the creator still open until `accessEndsAt`.
    expect(MyShiftsSchema.parse({ current: null, next: null, ended: mine }).ended?.accessEndsAt).toBe(
      '2026-10-29T05:15:00Z',
    );
    expect(MyShiftsSchema.safeParse({ current: null, next: null }).success).toBe(false);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of SCHEDULING_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|forbidden)$/u);
    }
  });
});

describe('conflicts of the templates', () => {
  const occurrence = {
    templateId: TEMPLATE,
    startsAt: '2026-11-03T23:00:00Z',
    endsAt: '2026-11-04T05:00:00Z',
  };

  it('points a busy member or a taken account to the shift in the way', () => {
    expect(
      PlanningConflictSchema.safeParse({ ...occurrence, reason: 'member_busy', shiftId: shift.id }).success,
    ).toBe(true);
    expect(PlanningConflictSchema.safeParse({ ...occurrence, reason: 'account_taken' }).success).toBe(false);
  });

  it('points a member on leave to the leave, never to a shift (ADR 0031)', () => {
    const onLeave = PlanningConflictSchema.parse({
      ...occurrence,
      reason: 'member_on_leave',
      leaveRequestId: LEAVE,
    });
    expect(onLeave.reason === 'member_on_leave' && onLeave.leaveRequestId).toBe(LEAVE);
    expect(
      PlanningConflictSchema.safeParse({ ...occurrence, reason: 'member_on_leave', shiftId: shift.id })
        .success,
    ).toBe(false);
  });
});

describe('leaves (ADR 0031)', () => {
  const ask = { id: LEAVE, firstDay: '2026-12-24', lastDay: '2026-12-26', note: '  Noël en famille  ' };

  it('takes whole days of the member, a note trimmed, and none when it is empty', () => {
    expect(CreateLeaveRequestBodySchema.parse(ask).note).toBe('Noël en famille');
    expect(CreateLeaveRequestBodySchema.parse({ ...ask, note: '   ' }).note).toBe(null);
    expect(CreateLeaveRequestBodySchema.parse({ ...ask, note: undefined }).note).toBe(null);
    expect(CreateLeaveRequestBodySchema.safeParse({ ...ask, firstDay: '2026-12-24T00:00:00Z' }).success).toBe(
      false,
    );
  });

  it('takes one day, refuses a last day before the first, and more than 31 days', () => {
    expect(CreateLeaveRequestBodySchema.safeParse({ ...ask, lastDay: '2026-12-24' }).success).toBe(true);
    expect(CreateLeaveRequestBodySchema.safeParse({ ...ask, lastDay: '2026-12-23' }).success).toBe(false);
    expect(
      CreateLeaveRequestBodySchema.safeParse({ ...ask, firstDay: '2026-12-01', lastDay: '2026-12-31' })
        .success,
    ).toBe(true);
    expect(
      CreateLeaveRequestBodySchema.safeParse({ ...ask, firstDay: '2026-12-01', lastDay: '2027-01-01' })
        .success,
    ).toBe(false);
  });

  it('sends a leave back with the zone its days belong to and the instants fixed from them', () => {
    const leave = {
      id: LEAVE,
      memberId: MEMBER,
      firstDay: '2026-12-24',
      lastDay: '2026-12-26',
      timeZone: 'Indian/Antananarivo',
      startsAt: '2026-12-23T21:00:00Z',
      endsAt: '2026-12-26T21:00:00Z',
      note: null,
      status: 'pending',
      decidedAt: null,
      cancelledAt: null,
      decisionNote: null,
      createdAt: '2026-10-27T20:00:00Z',
    };
    expect(LeaveRequestSchema.parse(leave).timeZone).toBe('Indian/Antananarivo');
    expect(LeaveRequestSchema.safeParse({ ...leave, status: 'deleted' }).success).toBe(false);
  });

  it('keeps when it was approved once it is cancelled (ADR 0031)', () => {
    const cancelled = LeaveRequestSchema.parse({
      id: LEAVE,
      memberId: MEMBER,
      firstDay: '2026-12-24',
      lastDay: '2026-12-26',
      timeZone: 'Europe/Paris',
      startsAt: '2026-12-23T23:00:00Z',
      endsAt: '2026-12-26T23:00:00Z',
      note: null,
      status: 'cancelled',
      decidedAt: '2026-11-02T10:00:00Z',
      cancelledAt: '2026-12-25T09:30:00Z',
      decisionNote: 'Retour plus tôt',
      createdAt: '2026-10-27T20:00:00Z',
    });
    expect([cancelled.decidedAt, cancelled.cancelledAt, cancelled.endsAt]).toEqual([
      '2026-11-02T10:00:00Z',
      '2026-12-25T09:30:00Z',
      '2026-12-26T23:00:00Z',
    ]);
  });

  it('is approved or refused, with a note for the member', () => {
    expect(
      DecideLeaveRequestBodySchema.parse({ decision: 'refuse', note: 'Trop de monde absent' }).note,
    ).toBe('Trop de monde absent');
    expect(DecideLeaveRequestBodySchema.safeParse({ decision: 'cancel' }).success).toBe(false);
  });
});

describe('swaps (ADR 0031)', () => {
  const offer = { id: SWAP, shiftId: shift.id, targetMemberId: COLLEAGUE, targetShiftId: null, message: '' };

  it('gives a shift, or exchanges it for one of the colleague’s', () => {
    expect(CreateShiftSwapRequestBodySchema.parse(offer).message).toBe(null);
    const exchange = { ...offer, targetShiftId: '0199f2a0-0000-7000-8000-0000000000f2', message: 'Merci !' };
    expect(CreateShiftSwapRequestBodySchema.parse(exchange).targetShiftId).toBe(exchange.targetShiftId);
    expect(CreateShiftSwapRequestBodySchema.safeParse({ ...offer, targetShiftId: undefined }).success).toBe(
      false,
    );
  });

  it('is accepted or declined by the colleague, nothing else', () => {
    expect(AnswerShiftSwapRequestBodySchema.safeParse({ answer: 'accept' }).success).toBe(true);
    expect(AnswerShiftSwapRequestBodySchema.safeParse({ answer: 'approve' }).success).toBe(false);
  });

  it('names a colleague by display name and colour only, with the shifts an exchange could give back', () => {
    const candidates = SwapCandidatesSchema.parse({
      candidates: [
        {
          member: { id: COLLEAGUE, displayName: 'Basile', color: null, commissionBasisPoints: 1250 },
          freeThen: false,
          shifts: [
            { ...shift, id: '0199f2a0-0000-7000-8000-0000000000f2', memberId: COLLEAGUE, stoppedAt: null },
          ],
        },
      ],
      accounts: [],
    });
    expect(Object.keys(candidates.candidates[0]?.member ?? {})).toEqual(['id', 'displayName', 'color']);
  });

  const proposed = {
    ...offer,
    requesterId: MEMBER,
    creatorId: CREATOR,
    shiftStartsAt: shift.startsAt,
    shiftEndsAt: shift.endsAt,
    targetCreatorId: null,
    targetShiftStartsAt: null,
    targetShiftEndsAt: null,
    message: null,
    status: 'proposed',
    resolvedAt: null,
    revertedAt: null,
    withdrawnByAgency: false,
    createdAt: '2026-10-27T20:00:00Z',
  };

  it('lists the swaps with the shifts they name, as they are now', () => {
    const list = ShiftSwapListSchema.parse({
      swapRequests: [proposed],
      shifts: [{ ...shift, stoppedAt: null }],
      accounts: [],
      members: [],
    });
    expect(list.swapRequests[0]?.status).toBe('proposed');
  });

  it('keeps the hours a swap noted, to say one that ended without its shift', () => {
    const declined = { ...proposed, status: 'declined', resolvedAt: '2026-10-27T21:00:00Z' };
    const list = ShiftSwapListSchema.parse({
      swapRequests: [declined],
      shifts: [],
      accounts: [],
      members: [],
    });
    expect(list.swapRequests[0]).toMatchObject({ shiftStartsAt: shift.startsAt, shiftEndsAt: shift.endsAt });
    const forgotten = { ...declined, shiftStartsAt: undefined };
    expect(ShiftSwapListSchema.safeParse({ ...list, swapRequests: [forgotten] }).success).toBe(false);
  });

  it('says a proposal withdrawn by the agency, never by whom', () => {
    const withdrawn = {
      ...proposed,
      status: 'withdrawn',
      resolvedAt: '2026-10-27T21:00:00Z',
      withdrawnByAgency: true,
    };
    expect(ShiftSwapRequestSchema.parse(withdrawn).withdrawnByAgency).toBe(true);
    expect(ShiftSwapRequestSchema.safeParse({ ...withdrawn, withdrawnByAgency: undefined }).success).toBe(
      false,
    );
  });
});

describe('« Qui répond à tes fans » at a glance', () => {
  it('never wears one of her categories’ emojis, so a shift never reads as one of her tasks', () => {
    expect(Object.values(CREATOR_TASK_CATEGORY_EMOJI)).not.toContain(CREATOR_REPLIES_EMOJI);
  });
});
