import {
  ApiErrorSchema,
  LeaveRequestIdSchema,
  LeaveRequestListSchema,
  LeaveRequestSchema,
  newId,
  PlanningSchema,
  PlatformAccountIdSchema,
  ShiftSchema,
  ShiftSwapListSchema,
  ShiftSwapRequestIdSchema,
  ShiftSwapRequestSchema,
  SwapCandidatesSchema,
  TeamMemberSchema,
  type CreatorId,
  type LeaveRequest,
  type PlatformAccountId,
  type Shift,
  type ShiftSwapRequest,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, inArray, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { iso, parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;

/** Midnight of a day in the members' zone (Porto-Novo, UTC+1 all year). */
const memberMidnight = (day: string): string => new Date(`${day}T00:00:00+01:00`).toISOString();

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;
const detailsOf = (response: LightMyRequestResponse) => ApiErrorSchema.parse(response.json()).error.details;

/** The keys a colleague's entry carries in a response, as sent. */
const MemberKeysSchema = z.object({ members: z.array(z.record(z.string(), z.unknown())) });

describe('Équipe › Congés et échanges (/v1/scheduling, EQ-02, ADR 0031)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaMain: PlatformAccountId;
  let annaSecond: PlatformAccountId;
  let inesMain: PlatformAccountId;
  let theo: TeamMember;
  let basile: TeamMember;
  let nora: TeamMember;
  let lou: TeamMember;
  let iris: TeamMember;
  let theoCookie: string;
  let basileCookie: string;
  let noraCookie: string;
  let louCookie: string;
  let irisCookie: string;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const addMember = async (body: {
    email: string;
    displayName: string;
    teamRole: 'chatter' | 'manager';
    creatorIds: CreatorId[];
    joinedOn?: string;
  }): Promise<{ member: TeamMember; cookie: string }> => {
    const response = await call('POST', '/team/members', owner, {
      ...body,
      firstName: body.displayName,
      lastName: 'Inventé',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: parisDay(-30),
      ...body,
      commission: { rateBps: 1000 },
      teamShareBps: body.teamRole === 'manager' ? 500 : null,
    });
    expect(response.statusCode).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member, cookie: await signIn(server, body.email, PASSWORD) };
  };

  /** A shift placed by the owner, from `start` to `end` (minutes of the Paris day). */
  const place = async (
    member: TeamMember,
    creatorId: CreatorId,
    accountId: PlatformAccountId,
    day: number,
    start = 600,
    end = 720,
  ): Promise<Shift> => {
    const response = await call('POST', '/scheduling/shifts', owner, {
      memberId: member.id,
      creatorId,
      platformAccountId: accountId,
      startsAt: iso(parisInstant(parisDay(day), start)),
      endsAt: iso(parisInstant(parisDay(day), end)),
    });
    expect(response.statusCode).toBe(201);
    return ShiftSchema.parse(response.json());
  };

  const askLeave = (cookie: string, first: number, last = first, note: string | null = null) =>
    call('POST', '/scheduling/leave-requests', cookie, {
      id: newId(LeaveRequestIdSchema),
      firstDay: parisDay(first),
      lastDay: parisDay(last),
      note,
    });

  const leaveOf = (response: LightMyRequestResponse): LeaveRequest => {
    expect(response.statusCode).toBe(201);
    return LeaveRequestSchema.parse(response.json());
  };

  const decide = (
    cookie: string,
    leave: LeaveRequest,
    decision: 'approve' | 'refuse',
    note: string | null = null,
  ) => call('POST', `/scheduling/leave-requests/${leave.id}/decision`, cookie, { decision, note });

  const propose = (cookie: string, shift: Shift, target: TeamMember, back: Shift | null = null) =>
    call('POST', '/scheduling/swap-requests', cookie, {
      id: newId(ShiftSwapRequestIdSchema),
      shiftId: shift.id,
      targetMemberId: target.id,
      targetShiftId: back?.id ?? null,
      message: null,
    });

  const swapOf = (response: LightMyRequestResponse): ShiftSwapRequest => {
    expect(response.statusCode).toBe(201);
    return ShiftSwapRequestSchema.parse(response.json());
  };

  const answer = (cookie: string, swap: ShiftSwapRequest, choice: 'accept' | 'decline') =>
    call('POST', `/scheduling/swap-requests/${swap.id}/answer`, cookie, { answer: choice });

  const swaps = async (cookie: string) => {
    const response = await call('GET', '/scheduling/swap-requests', cookie);
    expect(response.statusCode).toBe(200);
    return ShiftSwapListSchema.parse(response.json());
  };

  const statusOf = async (swap: ShiftSwapRequest) =>
    (await swaps(owner)).swapRequests.find((one) => one.id === swap.id)?.status;

  /** The member a shift is on now, as the owner's planning says it. */
  const holderOf = async (shift: Shift) => {
    const query = new URLSearchParams({ from: shift.startsAt, to: shift.endsAt });
    const response = await call('GET', `/scheduling/planning?${query.toString()}`, owner);
    expect(response.statusCode).toBe(200);
    return PlanningSchema.parse(response.json()).shifts.find((one) => one.id === shift.id)?.memberId;
  };

  /** How many advisory locks someone waits on in this test's database. */
  const waitingOnLocks = (): Promise<number> => lockWaits(test.admin.db);

  const untilWaiting = async (count: number): Promise<void> => {
    for (let tries = 0; (await waitingOnLocks()) < count; tries += 1) {
      if (tries > 250) throw new Error('nobody waited for the member’s lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    annaMain = newId(PlatformAccountIdSchema);
    annaSecond = newId(PlatformAccountIdSchema);
    inesMain = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaMain, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: annaSecond, creatorId: anna, platform: 'reveal', handle: 'anna-bis-invente' },
      { id: inesMain, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    const team = [
      { email: 'theo@example.test', displayName: 'Théo', teamRole: 'chatter', creatorIds: [anna] },
      { email: 'basile@example.test', displayName: 'Basile', teamRole: 'chatter', creatorIds: [anna, ines] },
      { email: 'nora@example.test', displayName: 'Nora', teamRole: 'manager', creatorIds: [anna, ines] },
      { email: 'lou@example.test', displayName: 'Lou', teamRole: 'chatter', creatorIds: [ines] },
      { email: 'iris@example.test', displayName: 'Iris', teamRole: 'chatter', creatorIds: [anna] },
    ] as const;
    const added = [];
    for (const body of team) added.push(await addMember({ ...body, creatorIds: [...body.creatorIds] }));
    const [t, b, n, l, i] = added;
    if (t === undefined || b === undefined || n === undefined || l === undefined || i === undefined) {
      throw new Error('team not added');
    }
    ({ member: theo, cookie: theoCookie } = t);
    ({ member: basile, cookie: basileCookie } = b);
    ({ member: nora, cookie: noraCookie } = n);
    ({ member: lou, cookie: louCookie } = l);
    ({ member: iris, cookie: irisCookie } = i);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  describe('leaves', () => {
    let theoLeave: LeaveRequest;
    let basileLeave: LeaveRequest;
    let theoDay20: Shift;
    let irisDay8ToTheo: ShiftSwapRequest;

    it('lets a member ask their own leave from today on, and records a retry once', async () => {
      const body = {
        id: newId(LeaveRequestIdSchema),
        firstDay: parisDay(20),
        lastDay: parisDay(21),
        note: 'Mariage d’un cousin',
      };
      theoLeave = leaveOf(await call('POST', '/scheduling/leave-requests', theoCookie, body));
      expect(theoLeave).toMatchObject({
        memberId: theo.id,
        timeZone: 'Africa/Porto-Novo',
        startsAt: memberMidnight(parisDay(20)),
        endsAt: memberMidnight(parisDay(22)),
        note: 'Mariage d’un cousin',
        status: 'pending',
        decidedAt: null,
        cancelledAt: null,
        decisionNote: null,
      });
      const retry = await call('POST', '/scheduling/leave-requests', theoCookie, body);
      expect([retry.statusCode, LeaveRequestSchema.parse(retry.json())]).toEqual([200, theoLeave]);

      const changed = await call('POST', '/scheduling/leave-requests', theoCookie, { ...body, note: null });
      expect([changed.statusCode, codeOf(changed)]).toEqual([409, 'leave_request_conflict']);
      // The same id is Théo's request, which Basile does not read.
      const someoneElse = await call('POST', '/scheduling/leave-requests', basileCookie, body);
      expect([someoneElse.statusCode, codeOf(someoneElse)]).toEqual([409, 'leave_request_conflict']);

      const overlapping = await askLeave(theoCookie, 21, 23);
      expect([overlapping.statusCode, codeOf(overlapping), detailsOf(overlapping)]).toEqual([
        409,
        'leave_overlap_conflict',
        { leaveRequestId: theoLeave.id },
      ]);
      const past = await askLeave(theoCookie, -2);
      expect([past.statusCode, codeOf(past)]).toEqual([400, 'leave_date_invalid']);
      expect((await askLeave(theoCookie, 23, 22)).statusCode).toBe(400);
      expect((await askLeave(theoCookie, 23, 60)).statusCode).toBe(400);
      expect((await askLeave(creator, 23)).statusCode).toBe(403);
    });

    it('shows a member their own leaves, the agency every one with the names', async () => {
      basileLeave = leaveOf(await askLeave(basileCookie, 24));
      const read = async (cookie: string, from: Date, to: Date) => {
        const query = new URLSearchParams({ from: iso(from), to: iso(to) });
        return call('GET', `/scheduling/leave-requests?${query.toString()}`, cookie);
      };
      const from = parisInstant(parisDay(0), 0);
      const to = parisInstant(parisDay(40), 0);

      const theirs = LeaveRequestListSchema.parse((await read(theoCookie, from, to)).json());
      expect(theirs.leaveRequests.map((leave) => leave.id)).toEqual([theoLeave.id]);
      expect(theirs.members.map((member) => member.id)).toEqual([theo.id]);

      const all = LeaveRequestListSchema.parse((await read(noraCookie, from, to)).json());
      expect(all.leaveRequests.map((leave) => leave.id)).toEqual([theoLeave.id, basileLeave.id]);
      expect(all.members.map((member) => member.displayName).toSorted()).toEqual(['Basile', 'Théo']);

      const tooWide = await read(owner, from, new Date(from.getTime() + 367 * 24 * 60 * MINUTE));
      expect([tooWide.statusCode, codeOf(tooWide)]).toEqual([400, 'planning_range_invalid']);
    });

    it('lets the owner or an active manager decide, a manager never on their own leave', async () => {
      const noraLeave = leaveOf(await askLeave(noraCookie, 26));
      // A chatter decides nothing: not their own request, and someone else's they do not even read.
      const byChatter = await decide(theoCookie, theoLeave, 'approve');
      expect([byChatter.statusCode, codeOf(byChatter)]).toEqual([403, 'role_forbidden']);
      const unseen = await decide(theoCookie, basileLeave, 'approve');
      expect([unseen.statusCode, codeOf(unseen)]).toEqual([404, 'leave_request_not_found']);
      const own = await decide(noraCookie, noraLeave, 'approve');
      expect([own.statusCode, codeOf(own)]).toEqual([403, 'leave_own_decision_forbidden']);

      const refused = await decide(owner, noraLeave, 'refuse', 'Trop de monde absent ce jour-là');
      expect(refused.statusCode).toBe(200);
      expect(LeaveRequestSchema.parse(refused.json())).toMatchObject({
        status: 'refused',
        decisionNote: 'Trop de monde absent ce jour-là',
        cancelledAt: null,
      });
      expect(LeaveRequestSchema.parse(refused.json()).decidedAt).not.toBeNull();
      const again = await decide(owner, noraLeave, 'approve');
      expect([again.statusCode, codeOf(again)]).toEqual([409, 'leave_decided_conflict']);

      const approved = await decide(noraCookie, basileLeave, 'approve');
      expect([approved.statusCode, LeaveRequestSchema.parse(approved.json()).status]).toEqual([
        200,
        'approved',
      ]);
    });

    it('approves no leave while the member still has shifts then, and lapses the swaps it would break', async () => {
      theoDay20 = await place(theo, anna, annaMain, 20);
      const blocked = await decide(noraCookie, theoLeave, 'approve');
      expect([blocked.statusCode, codeOf(blocked), detailsOf(blocked)]).toEqual([
        409,
        'leave_shifts_conflict',
        { shiftIds: [theoDay20.id] },
      ]);

      // A shift given to Théo during the leave, one that would come back to him then, one that would not.
      const irisDay21 = await place(iris, anna, annaSecond, 21);
      const theoDay6 = await place(theo, anna, annaMain, 6);
      const irisDay8 = await place(iris, anna, annaSecond, 8);
      const given = swapOf(await propose(irisCookie, irisDay21, theo));
      const exchanged = swapOf(await propose(theoCookie, theoDay6, iris, irisDay21));
      irisDay8ToTheo = swapOf(await propose(irisCookie, irisDay8, theo));

      const handed = await call('PATCH', `/scheduling/shifts/${theoDay20.id}`, owner, {
        memberId: basile.id,
      });
      expect(handed.statusCode).toBe(200);
      const approved = await decide(noraCookie, theoLeave, 'approve');
      expect([approved.statusCode, LeaveRequestSchema.parse(approved.json()).status]).toEqual([
        200,
        'approved',
      ]);
      expect(await statusOf(given)).toBe('lapsed');
      expect(await statusOf(exchanged)).toBe('lapsed');
      expect(await statusOf(irisDay8ToTheo)).toBe('proposed');

      // On leave, Théo asks no shift back for those days.
      const onLeave = await propose(theoCookie, theoDay6, iris, irisDay21);
      expect([onLeave.statusCode, codeOf(onLeave)]).toEqual([409, 'member_on_leave_conflict']);
    });

    it('gives nobody a shift by a swap during their approved leave', async () => {
      const irisDay24 = await place(iris, anna, annaSecond, 24);
      // Iris never reads Basile's leave: the proposal is recorded, the acceptance refused.
      const toBasile = swapOf(await propose(irisCookie, irisDay24, basile));
      const accepted = await answer(basileCookie, toBasile, 'accept');
      expect([accepted.statusCode, codeOf(accepted), detailsOf(accepted)]).toEqual([
        409,
        'member_on_leave_conflict',
        { leaveRequestId: basileLeave.id },
      ]);
      expect(await statusOf(toBasile)).toBe('proposed');
      expect(await holderOf(irisDay24)).toBe(iris.id);
    });

    it('lets a member withdraw their pending request, the agency cancel an approved leave', async () => {
      const later = leaveOf(await askLeave(theoCookie, 28));
      const notTheirs = await call('DELETE', `/scheduling/leave-requests/${later.id}`, noraCookie);
      expect([notTheirs.statusCode, codeOf(notTheirs)]).toEqual([403, 'role_forbidden']);
      expect((await call('DELETE', `/scheduling/leave-requests/${later.id}`, theoCookie)).statusCode).toBe(
        204,
      );

      const byMember = await call('DELETE', `/scheduling/leave-requests/${theoLeave.id}`, theoCookie);
      expect([byMember.statusCode, codeOf(byMember)]).toEqual([409, 'leave_decided_conflict']);
      expect(
        (await call('DELETE', `/scheduling/leave-requests/${theoLeave.id}`, noraCookie)).statusCode,
      ).toBe(204);
      const twice = await call('DELETE', `/scheduling/leave-requests/${theoLeave.id}`, noraCookie);
      expect([twice.statusCode, codeOf(twice)]).toEqual([409, 'leave_decided_conflict']);

      const query = new URLSearchParams({
        from: iso(parisInstant(parisDay(0), 0)),
        to: iso(parisInstant(parisDay(40), 0)),
      });
      const listed = LeaveRequestListSchema.parse(
        (await call('GET', `/scheduling/leave-requests?${query.toString()}`, theoCookie)).json(),
      );
      // The withdrawn request is gone from the list; the cancelled leave stays, with its approval.
      expect(listed.leaveRequests.map((leave) => [leave.id, leave.status])).toEqual([
        [theoLeave.id, 'cancelled'],
      ]);
      expect(listed.leaveRequests[0]?.decidedAt).not.toBeNull();
      expect(listed.leaveRequests[0]?.cancelledAt).not.toBeNull();
      // Cancelled before it started, it covers nothing: Théo can be planned on those days again.
      await place(theo, anna, annaSecond, 20, 840, 960);
    });

    it('lapses a proposal whose shift changed since, rather than move what was not asked', async () => {
      const moved = await call('PATCH', `/scheduling/shifts/${irisDay8ToTheo.shiftId}`, owner, {
        startsAt: iso(parisInstant(parisDay(8), 630)),
      });
      expect(moved.statusCode).toBe(200);
      const accepted = await answer(theoCookie, irisDay8ToTheo, 'accept');
      expect([accepted.statusCode, codeOf(accepted)]).toEqual([409, 'shift_swap_lapsed_conflict']);
      expect(await statusOf(irisDay8ToTheo)).toBe('lapsed');
    });
  });

  describe('swaps', () => {
    let theoA: Shift;
    let basileA: Shift;
    let basileI: Shift;
    let noraA: Shift;
    let theoB: Shift;
    let toBasile: ShiftSwapRequest;

    it('lets a member propose a shift of theirs to a colleague, once', async () => {
      theoA = await place(theo, anna, annaMain, 3);
      basileA = await place(basile, anna, annaSecond, 3);
      basileI = await place(basile, ines, inesMain, 4);
      noraA = await place(nora, anna, annaMain, 4, 840, 960);
      const theoD4 = await place(theo, anna, annaSecond, 4, 840, 960);
      // Basile's own shift falls at the same hours: he can only take Théo's in exchange for it.
      const body = {
        id: newId(ShiftSwapRequestIdSchema),
        shiftId: theoA.id,
        targetMemberId: basile.id,
        targetShiftId: basileA.id,
        message: 'On échange ?',
      };
      toBasile = swapOf(await call('POST', '/scheduling/swap-requests', theoCookie, body));
      expect(toBasile).toMatchObject({
        requesterId: theo.id,
        shiftId: theoA.id,
        creatorId: anna,
        shiftStartsAt: theoA.startsAt,
        shiftEndsAt: theoA.endsAt,
        targetMemberId: basile.id,
        targetShiftId: basileA.id,
        targetCreatorId: anna,
        targetShiftStartsAt: basileA.startsAt,
        targetShiftEndsAt: basileA.endsAt,
        message: 'On échange ?',
        status: 'proposed',
        resolvedAt: null,
        revertedAt: null,
        withdrawnByAgency: false,
      });
      const retry = await call('POST', '/scheduling/swap-requests', theoCookie, body);
      expect([retry.statusCode, ShiftSwapRequestSchema.parse(retry.json())]).toEqual([200, toBasile]);
      const changed = await call('POST', '/scheduling/swap-requests', theoCookie, { ...body, message: null });
      expect([changed.statusCode, codeOf(changed)]).toEqual([409, 'shift_swap_conflict']);
      const twice = await propose(theoCookie, theoA, basile, basileA);
      expect([twice.statusCode, codeOf(twice), detailsOf(twice)]).toEqual([
        409,
        'shift_swap_open_conflict',
        { shiftSwapRequestId: toBasile.id },
      ]);

      // Nobody would end up on two shifts at once. Basile's shift in the way is not Théo's: it is never named.
      const busy = await propose(theoCookie, theoA, basile);
      expect([busy.statusCode, codeOf(busy), detailsOf(busy)]).toEqual([409, 'shift_member_conflict', {}]);
      // Nora's shift would come back to Théo while he is on another one, his own: that one is named.
      const mine = await propose(theoCookie, theoA, nora, noraA);
      expect([mine.statusCode, codeOf(mine), detailsOf(mine)]).toEqual([
        409,
        'shift_member_conflict',
        { shiftId: theoD4.id },
      ]);

      const expectations: [LightMyRequestResponse, number, string][] = [
        [await propose(theoCookie, theoA, theo), 400, 'shift_swap_self_invalid'],
        // Lou does not work on Anna; Théo does not work on Inès, whose shift would come back to him.
        [await propose(theoCookie, theoA, lou), 409, 'member_creator_conflict'],
        [await propose(theoCookie, theoA, basile, basileI), 409, 'member_creator_conflict'],
        [await propose(theoCookie, basileA, iris), 404, 'shift_not_found'],
        [await propose(theoCookie, theoA, basile, noraA), 404, 'shift_not_found'],
      ];
      for (const [response, status, code] of expectations)
        expect([response.statusCode, codeOf(response)]).toEqual([status, code]);
      const underWay = await call('POST', '/scheduling/shifts', owner, {
        memberId: theo.id,
        creatorId: anna,
        platformAccountId: annaSecond,
        startsAt: iso(new Date(Math.floor(Date.now() / MINUTE) * MINUTE - 60 * MINUTE)),
        endsAt: iso(new Date(Math.floor(Date.now() / MINUTE) * MINUTE + 120 * MINUTE)),
      });
      expect(underWay.statusCode).toBe(201);
      const started = await propose(theoCookie, ShiftSchema.parse(underWay.json()), basile);
      expect([started.statusCode, codeOf(started)]).toEqual([409, 'shift_started_conflict']);
      expect((await propose(creator, theoA, basile)).statusCode).toBe(403);
    });

    it('names the colleagues who could take a shift, by name and colour only, never one on leave', async () => {
      // Jade joins after the shift: never listed, and a proposal to her is refused.
      const { member: jade } = await addMember({
        email: 'jade@example.test',
        displayName: 'Jade',
        teamRole: 'chatter',
        creatorIds: [anna],
        joinedOn: parisDay(10),
      });
      const early = await propose(theoCookie, theoA, jade);
      expect([early.statusCode, codeOf(early)]).toEqual([409, 'member_not_joined_conflict']);
      const away = leaveOf(await askLeave(irisCookie, 3));
      expect((await decide(owner, away, 'approve')).statusCode).toBe(200);
      // Nora is on Inès at those hours, a creator Théo does not work on.
      const noraI = await place(nora, ines, inesMain, 3);

      const read = async () => {
        const response = await call('GET', `/scheduling/swap-candidates?shiftId=${theoA.id}`, theoCookie);
        expect(response.statusCode).toBe(200);
        return { response, found: SwapCandidatesSchema.parse(response.json()) };
      };
      const { response, found } = await read();
      // Lou does not work on Anna, Iris is on leave that day, Jade has not joined, Théo is the one asking.
      expect(found.candidates.map((candidate) => [candidate.member.displayName, candidate.freeThen])).toEqual(
        [
          ['Basile', false],
          ['Nora', false],
        ],
      );
      const basileShifts = found.candidates[0]?.shifts.map((shift) => shift.id) ?? [];
      // What could come back to Théo: Basile's shifts on Anna, never the one on Inès.
      expect(basileShifts).toContain(basileA.id);
      expect(basileShifts).not.toContain(basileI.id);
      // Nora's shift in the way is said by `freeThen` alone, never shown.
      const noraShifts = found.candidates[1]?.shifts.map((shift) => shift.id) ?? [];
      expect(noraShifts).toContain(noraA.id);
      expect(noraShifts).not.toContain(noraI.id);
      expect((await call('DELETE', `/scheduling/shifts/${noraI.id}`, owner)).statusCode).toBe(204);
      expect((await read()).found.candidates.map((candidate) => candidate.freeThen)).toEqual([false, true]);
      expect(found.accounts.every((account) => account.creatorId === anna)).toBe(true);
      const raw = z
        .object({ candidates: z.array(z.object({ member: z.record(z.string(), z.unknown()) })) })
        .parse(response.json());
      for (const candidate of raw.candidates) {
        expect(Object.keys(candidate.member).toSorted()).toEqual(['color', 'displayName', 'id']);
      }

      const notTheirs = await call('GET', `/scheduling/swap-candidates?shiftId=${theoA.id}`, basileCookie);
      expect([notTheirs.statusCode, codeOf(notTheirs)]).toEqual([404, 'shift_not_found']);
    });

    it('lists the swaps a member makes or receives, every one for the agency', async () => {
      const response = await call('GET', '/scheduling/swap-requests', basileCookie);
      expect(response.statusCode).toBe(200);
      const theirs = ShiftSwapListSchema.parse(response.json());
      expect(theirs.swapRequests.map((swap) => swap.id)).toContain(toBasile.id);
      expect(
        theirs.swapRequests.every(
          (swap) => swap.requesterId === basile.id || swap.targetMemberId === basile.id,
        ),
      ).toBe(true);
      // The shift offered to Basile is readable while the swap is proposed, with its account and Théo's name.
      expect(theirs.shifts.map((shift) => shift.id)).toContain(theoA.id);
      expect(theirs.accounts.map((account) => account.id)).toContain(annaMain);
      expect(theirs.members.map((member) => member.displayName)).toContain('Théo');
      for (const member of MemberKeysSchema.parse(response.json()).members) {
        expect(Object.keys(member).toSorted()).toEqual(['color', 'displayName', 'id']);
      }

      expect(await swaps(louCookie)).toEqual({ swapRequests: [], shifts: [], accounts: [], members: [] });
      expect((await swaps(owner)).swapRequests.map((swap) => swap.id)).toContain(toBasile.id);
      expect((await call('GET', '/scheduling/swap-requests', creator)).statusCode).toBe(403);
    });

    it('lets only the colleague asked answer', async () => {
      for (const cookie of [theoCookie, noraCookie]) {
        const notAsked = await answer(cookie, toBasile, 'accept');
        expect([notAsked.statusCode, codeOf(notAsked)]).toEqual([403, 'role_forbidden']);
      }
      const notTheirs = await call('DELETE', `/scheduling/swap-requests/${toBasile.id}`, basileCookie);
      expect([notTheirs.statusCode, codeOf(notTheirs)]).toEqual([403, 'role_forbidden']);
      expect(await statusOf(toBasile)).toBe('proposed');
      expect(await holderOf(theoA)).toBe(theo.id);
    });

    it('refuses an acceptance that would put the colleague on two shifts, naming their own', async () => {
      const theoC = await place(theo, anna, annaMain, 11);
      const offered = swapOf(await propose(theoCookie, theoC, basile));
      // Placed after the proposal: the acceptance sees it under Basile's lock.
      const basileD11 = await place(basile, ines, inesMain, 11);
      const busy = await answer(basileCookie, offered, 'accept');
      expect([busy.statusCode, codeOf(busy), detailsOf(busy)]).toEqual([
        409,
        'shift_member_conflict',
        { shiftId: basileD11.id },
      ]);
      expect(await statusOf(offered)).toBe('proposed');
      expect(await holderOf(theoC)).toBe(theo.id);
    });

    it('refuses an acceptance that would put the requester on two shifts, without naming their shift', async () => {
      const theoD18 = await place(theo, anna, annaMain, 18);
      const irisD19 = await place(iris, anna, annaSecond, 19);
      const exchange = swapOf(await propose(theoCookie, theoD18, iris, irisD19));
      // Placed after the proposal, on Théo, at the hours of the shift that would come back to him.
      await place(theo, anna, annaMain, 19);
      const busy = await answer(irisCookie, exchange, 'accept');
      expect([busy.statusCode, codeOf(busy), detailsOf(busy)]).toEqual([409, 'shift_member_conflict', {}]);
      expect(await statusOf(exchange)).toBe('proposed');
      expect(await holderOf(theoD18)).toBe(theo.id);
      expect(await holderOf(irisD19)).toBe(iris.id);
    });

    it('gives the requester of an exchange no shift during their leave, without saying the leave', async () => {
      const theoD12 = await place(theo, anna, annaMain, 12);
      const irisD13 = await place(iris, anna, annaSecond, 13);
      const exchange = swapOf(await propose(theoCookie, theoD12, iris, irisD13));
      // Written straight in the table, as if the approval had not lapsed the proposal.
      await test.admin.db.insert(schema.leaveRequests).values({
        id: newId(LeaveRequestIdSchema),
        memberId: theo.id,
        firstDay: parisDay(13),
        lastDay: parisDay(13),
        timeZone: 'Africa/Porto-Novo',
        startsAt: new Date(memberMidnight(parisDay(13))),
        endsAt: new Date(memberMidnight(parisDay(14))),
        status: 'approved',
        decidedAt: new Date(),
        decidedBy: nora.userId,
        createdBy: theo.userId,
      });
      const refused = await answer(irisCookie, exchange, 'accept');
      expect([refused.statusCode, codeOf(refused), detailsOf(refused)]).toEqual([
        409,
        'member_on_leave_conflict',
        {},
      ]);
      expect(await statusOf(exchange)).toBe('proposed');
      expect([await holderOf(theoD12), await holderOf(irisD13)]).toEqual([theo.id, iris.id]);
    });

    it('moves the shift on acceptance, and the other proposals on it lapse just after', async () => {
      const toNora = swapOf(await propose(theoCookie, theoA, nora));
      const accepted = await answer(noraCookie, toNora, 'accept');
      expect(accepted.statusCode).toBe(200);
      const swap = ShiftSwapRequestSchema.parse(accepted.json());
      expect(swap.status).toBe('accepted');
      expect(swap.resolvedAt).not.toBeNull();
      expect(await holderOf(theoA)).toBe(nora.id);
      const again = await answer(noraCookie, toNora, 'decline');
      expect([again.statusCode, codeOf(again)]).toEqual([409, 'shift_swap_answered_conflict']);

      const queued = await test.admin.db.execute(
        sql`select 1 from graphile_worker.jobs where task_identifier = 'scheduling.lapse_swaps'`,
      );
      expect(queued.rows).toHaveLength(1);
      expect(await statusOf(toBasile)).toBe('proposed');
      expect(await app.modules.scheduling.jobs.lapseSwaps()).toBeGreaterThanOrEqual(1);
      expect(await statusOf(toBasile)).toBe('lapsed');
      expect(await app.modules.scheduling.jobs.lapseSwaps()).toBe(0);

      // Théo still reads the shift he gave while the swap is accepted, now Nora's.
      const theirs = await swaps(theoCookie);
      expect(theirs.shifts.find((shift) => shift.id === theoA.id)?.memberId).toBe(nora.id);
    });

    it('exchanges two shifts at the same hours, and two shifts across creators', async () => {
      // Basile's shift and the one Nora now holds start and end together: neither is ever on two at once.
      const sameHours = swapOf(await propose(basileCookie, basileA, nora, theoA));
      expect(sameHours).toMatchObject({ targetCreatorId: anna, targetShiftStartsAt: theoA.startsAt });
      expect((await answer(noraCookie, sameHours, 'accept')).statusCode).toBe(200);
      expect([await holderOf(basileA), await holderOf(theoA)]).toEqual([nora.id, basile.id]);

      const across = swapOf(await propose(basileCookie, basileI, nora, noraA));
      expect(across).toMatchObject({ creatorId: ines, targetCreatorId: anna });
      expect((await answer(noraCookie, across, 'accept')).statusCode).toBe(200);
      expect([await holderOf(basileI), await holderOf(noraA)]).toEqual([nora.id, basile.id]);
    });

    it('lets the requester or the agency withdraw a proposal, the agency revert an acceptance', async () => {
      theoB = await place(theo, anna, annaMain, 9);
      const declined = swapOf(await propose(theoCookie, theoB, basile));
      const no = await answer(basileCookie, declined, 'decline');
      expect(no.statusCode).toBe(200);
      expect(ShiftSwapRequestSchema.parse(no.json())).toMatchObject({ status: 'declined', revertedAt: null });
      expect(ShiftSwapRequestSchema.parse(no.json()).resolvedAt).not.toBeNull();
      const gone = await call('DELETE', `/scheduling/swap-requests/${declined.id}`, theoCookie);
      expect([gone.statusCode, codeOf(gone)]).toEqual([409, 'shift_swap_answered_conflict']);

      // Théo reads who withdrew each proposal: himself, or the agency, never by name.
      const withdrawn = async (swap: ShiftSwapRequest) =>
        (await swaps(theoCookie)).swapRequests
          .filter((one) => one.id === swap.id)
          .map((one) => [one.status, one.withdrawnByAgency]);
      const first = swapOf(await propose(theoCookie, theoB, basile));
      expect((await call('DELETE', `/scheduling/swap-requests/${first.id}`, theoCookie)).statusCode).toBe(
        204,
      );
      expect(await withdrawn(first)).toEqual([['withdrawn', false]]);
      const second = swapOf(await propose(theoCookie, theoB, basile));
      expect((await call('DELETE', `/scheduling/swap-requests/${second.id}`, noraCookie)).statusCode).toBe(
        204,
      );
      expect(await withdrawn(second)).toEqual([['withdrawn', true]]);

      const third = swapOf(await propose(theoCookie, theoB, basile));
      expect((await answer(basileCookie, third, 'accept')).statusCode).toBe(200);
      const byRequester = await call('DELETE', `/scheduling/swap-requests/${third.id}`, theoCookie);
      expect([byRequester.statusCode, codeOf(byRequester)]).toEqual([409, 'shift_swap_answered_conflict']);
      expect((await call('DELETE', `/scheduling/swap-requests/${third.id}`, owner)).statusCode).toBe(204);
      expect(await holderOf(theoB)).toBe(theo.id);
      const reverted = (await swaps(owner)).swapRequests.find((swap) => swap.id === third.id);
      expect(reverted?.status).toBe('reverted');
      expect(reverted?.revertedAt).not.toBeNull();
      expect(reverted?.resolvedAt).not.toBeNull();
      const twice = await call('DELETE', `/scheduling/swap-requests/${third.id}`, owner);
      expect([twice.statusCode, codeOf(twice)]).toEqual([409, 'shift_swap_answered_conflict']);

      // Once the shift changed hands again, the swap no longer goes back.
      const fourth = swapOf(await propose(theoCookie, theoB, basile));
      expect((await answer(basileCookie, fourth, 'accept')).statusCode).toBe(200);
      const handed = await call('PATCH', `/scheduling/shifts/${theoB.id}`, owner, { memberId: nora.id });
      expect(handed.statusCode).toBe(200);
      const late = await call('DELETE', `/scheduling/swap-requests/${fourth.id}`, noraCookie);
      expect([late.statusCode, codeOf(late)]).toEqual([409, 'shift_swap_revert_conflict']);
      expect(await statusOf(fourth)).toBe('accepted');
    });

    it('lapses a proposal whose shift was cancelled, by the job', async () => {
      const irisDay10 = await place(iris, anna, annaSecond, 10);
      const toTheo = swapOf(await propose(irisCookie, irisDay10, theo));
      expect((await call('DELETE', `/scheduling/shifts/${irisDay10.id}`, owner)).statusCode).toBe(204);
      expect(await app.modules.scheduling.jobs.lapseSwaps()).toBe(1);
      expect(await statusOf(toTheo)).toBe('lapsed');
      const late = await answer(theoCookie, toTheo, 'accept');
      expect([late.statusCode, codeOf(late)]).toEqual([409, 'shift_swap_answered_conflict']);
    });
  });

  describe('the member’s lock (ADR 0031)', () => {
    /** Holds Théo's lock while `requests` start one after the other, each queued behind the previous, then lets go. */
    const queuedBehindTheo = async (
      requests: readonly (() => ReturnType<typeof call>)[],
    ): Promise<LightMyRequestResponse[]> => {
      const started = await test.admin.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling.member:${theo.id}`}, 0))`,
        );
        const running: Promise<LightMyRequestResponse>[] = [];
        for (const request of requests) {
          // `inject` sends nothing until something waits on it.
          running.push(Promise.resolve(request()));
          await untilWaiting(running.length);
        }
        return running;
      });
      return Promise.all(started);
    };

    it('approves a leave first and refuses the acceptance it beat', async () => {
      const basileDay15 = await place(basile, anna, annaMain, 15);
      const leave = leaveOf(await askLeave(theoCookie, 15));
      const swap = swapOf(await propose(basileCookie, basileDay15, theo));
      const [approval, acceptance] = await queuedBehindTheo([
        () => decide(noraCookie, leave, 'approve'),
        () => answer(theoCookie, swap, 'accept'),
      ]);
      expect(approval?.statusCode).toBe(200);
      expect([acceptance?.statusCode, acceptance && codeOf(acceptance)]).toEqual([
        409,
        'shift_swap_answered_conflict',
      ]);
      expect(await statusOf(swap)).toBe('lapsed');
      expect(await holderOf(basileDay15)).toBe(basile.id);
    });

    it('accepts a swap first and refuses the approval it beat', async () => {
      const basileDay16 = await place(basile, anna, annaMain, 16);
      const leave = leaveOf(await askLeave(theoCookie, 16));
      const swap = swapOf(await propose(basileCookie, basileDay16, theo));
      const [acceptance, approval] = await queuedBehindTheo([
        () => answer(theoCookie, swap, 'accept'),
        () => decide(noraCookie, leave, 'approve'),
      ]);
      expect(acceptance?.statusCode).toBe(200);
      expect([approval?.statusCode, approval && codeOf(approval), approval && detailsOf(approval)]).toEqual([
        409,
        'leave_shifts_conflict',
        { shiftIds: [basileDay16.id] },
      ]);
      expect(await holderOf(basileDay16)).toBe(theo.id);
    });
  });

  it('audits every leave and swap, without a name', async () => {
    const rows = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.entity, ['leave_request', 'shift_swap']));
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      'leave_request.create',
      'leave_request.approve',
      'leave_request.refuse',
      'leave_request.withdraw',
      'leave_request.cancel',
      'shift_swap.propose',
      'shift_swap.accept',
      'shift_swap.decline',
      'shift_swap.withdraw',
      'shift_swap.revert',
    ]) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(rows)).not.toMatch(/Théo|Basile|Nora|Iris|Lou|Anna|Inès/u);
  });
});
