import { describe, expect, it } from 'vitest';

import {
  AnswerShiftSwapRequestBodySchema,
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

const settings = {
  timeZone: 'Europe/Paris',
  slotStartMinute: 0,
  slotLengthMinutes: 360,
  accessMarginMinutes: 15,
};

describe('planning settings', () => {
  it('tiles the day with Imperium’s four 6-hour slots by default', () => {
    expect(shiftSlotsOf(SchedulingSettingsSchema.parse(settings))).toEqual([
      { startMinute: 0, endMinute: 360 },
      { startMinute: 360, endMinute: 720 },
      { startMinute: 720, endMinute: 1080 },
      { startMinute: 1080, endMinute: 0 },
    ]);
  });

  it('lets the last slot run past midnight when the day starts later', () => {
    const slots = shiftSlotsOf({ slotStartMinute: 120, slotLengthMinutes: 360 });
    expect(slots.at(0)).toEqual({ startMinute: 120, endMinute: 480 });
    expect(slots.at(-1)).toEqual({ startMinute: 1200, endMinute: 120 });
  });

  it('refuses a length that does not divide the day, and a first slot that starts after its own end', () => {
    expect(SchedulingSettingsSchema.safeParse({ ...settings, slotLengthMinutes: 300 }).success).toBe(false);
    expect(SchedulingSettingsSchema.safeParse({ ...settings, slotStartMinute: 360 }).success).toBe(false);
    expect(SchedulingSettingsSchema.safeParse({ ...settings, slotStartMinute: 359 }).success).toBe(true);
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
    const empty = { settings, accounts: [], members: [], shifts: [], conflicts: [] };
    expect(PlanningSchema.parse(empty).shifts).toEqual([]);
  });

  it('gives a chatter their own shifts, the accounts those are on, themselves alone and no conflict', () => {
    const chatterPlanning = {
      settings,
      accounts: [
        { id: ACCOUNT, creatorId: CREATOR, creatorName: 'Nora Vidal', platform: 'reveal', handle: 'nora' },
      ],
      members: [{ id: MEMBER, displayName: 'Théo', color: '#c2410c' }],
      shifts: [{ ...shift, stoppedAt: null }],
      conflicts: [],
    };
    const planning = PlanningSchema.parse(chatterPlanning);
    expect(planning.members.map((member) => member.id)).toEqual([MEMBER]);
    expect(planning.shifts.every((one) => one.memberId === MEMBER)).toBe(true);
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
