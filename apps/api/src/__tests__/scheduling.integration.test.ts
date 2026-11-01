import {
  ApiErrorSchema,
  LeaveRequestIdSchema,
  MyShiftsSchema,
  newId,
  OnDutyListSchema,
  PlanningSchema,
  PlatformAccountIdSchema,
  SchedulingSettingsSchema,
  ShiftSchema,
  ShiftTemplateIdSchema,
  ShiftTemplateListSchema,
  ShiftTemplateSchema,
  TeamMemberSchema,
  type CreatorId,
  type PlatformAccountId,
  type Shift,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { iso, PARIS, parisDay, parisInstant, weekdayOf } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Now, on the minute, moved by `minutes`. */
const minutesFromNow = (minutes: number): Date =>
  new Date(Math.floor(Date.now() / MINUTE) * MINUTE + minutes * MINUTE);

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;
const detailsOf = (response: LightMyRequestResponse) => ApiErrorSchema.parse(response.json()).error.details;

describe('Équipe › Planning (/v1/scheduling, EQ-02)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  let theo: TeamMember;
  let basile: TeamMember;
  let nora: TeamMember;
  let theoCookie: string;
  let basileCookie: string;
  let noraCookie: string;
  let theoTomorrow: Shift;
  let basileUnderWay: Shift;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) =>
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
    timeZone?: string;
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

  const planning = async (cookie: string, from: Date, to: Date, creatorId?: string) => {
    const query = new URLSearchParams({ from: iso(from), to: iso(to), ...(creatorId && { creatorId }) });
    const response = await call('GET', `/scheduling/planning?${query.toString()}`, cookie);
    expect(response.statusCode).toBe(200);
    return PlanningSchema.parse(response.json());
  };

  const shiftBody = (
    memberId: string,
    creatorId: string,
    accountId: string,
    startsAt: Date,
    endsAt: Date,
  ) => ({
    memberId,
    creatorId,
    platformAccountId: accountId,
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
  });

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
    annaAccount = newId(PlatformAccountIdSchema);
    inesAccount = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaAccount, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: inesAccount, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    ({ member: theo, cookie: theoCookie } = await addMember({
      email: 'theo@example.test',
      displayName: 'Théo',
      teamRole: 'chatter',
      creatorIds: [anna],
    }));
    ({ member: basile, cookie: basileCookie } = await addMember({
      email: 'basile@example.test',
      displayName: 'Basile',
      teamRole: 'chatter',
      creatorIds: [anna, ines],
    }));
    ({ member: nora, cookie: noraCookie } = await addMember({
      email: 'nora@example.test',
      displayName: 'Nora',
      teamRole: 'manager',
      creatorIds: [anna, ines],
    }));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives every member the settings, Imperium’s grid until the owner saves theirs', async () => {
    const defaults = { timeZone: PARIS, slotStartMinute: 0, slotLengthMinutes: 360, accessMarginMinutes: 15 };
    const read = await call('GET', '/scheduling/settings', theoCookie);
    expect(read.statusCode).toBe(200);
    expect(SchedulingSettingsSchema.parse(read.json())).toEqual(defaults);

    expect((await call('PUT', '/scheduling/settings', noraCookie, defaults)).statusCode).toBe(403);
    const saved = await call('PUT', '/scheduling/settings', owner, { ...defaults, accessMarginMinutes: 20 });
    expect(saved.statusCode).toBe(200);
    const again = SchedulingSettingsSchema.parse(
      (await call('GET', '/scheduling/settings', basileCookie)).json(),
    );
    expect(again.accessMarginMinutes).toBe(20);
    await call('PUT', '/scheduling/settings', owner, defaults);
  });

  it('never lets a creator into the planning', async () => {
    expect((await call('GET', '/scheduling/settings', creator)).statusCode).toBe(403);
  });

  it('lets the owner and an active manager plan a shift, never a chatter', async () => {
    const tomorrow = parisDay(1);
    const startsAt = parisInstant(tomorrow, 18 * 60);
    const byChatter = await call(
      'POST',
      '/scheduling/shifts',
      theoCookie,
      shiftBody(theo.id, anna, annaAccount, startsAt, new Date(startsAt.getTime() + 6 * HOUR)),
    );
    expect(byChatter.statusCode).toBe(403);
    expect(codeOf(byChatter)).toBe('role_forbidden');

    const byManager = await call(
      'POST',
      '/scheduling/shifts',
      noraCookie,
      shiftBody(theo.id, anna, annaAccount, startsAt, new Date(startsAt.getTime() + 6 * HOUR)),
    );
    expect(byManager.statusCode).toBe(201);
    theoTomorrow = ShiftSchema.parse(byManager.json());
    expect(theoTomorrow).toMatchObject({ memberId: theo.id, templateId: null, stoppedAt: null });
  });

  it('refuses a creator, an account, a member and times that do not fit', async () => {
    const startsAt = parisInstant(parisDay(2), 6 * 60);
    const endsAt = new Date(startsAt.getTime() + 6 * HOUR);
    const expectations: [object, number, string][] = [
      [
        shiftBody(theo.id, '0199f2a0-0000-7000-8000-0000000000c9', annaAccount, startsAt, endsAt),
        404,
        'creator_not_found',
      ],
      [shiftBody(theo.id, anna, inesAccount, startsAt, endsAt), 404, 'platform_account_not_found'],
      [shiftBody(theo.id, ines, inesAccount, startsAt, endsAt), 409, 'member_creator_conflict'],
      [
        shiftBody('0199f2a0-0000-7000-8000-0000000000e9', anna, annaAccount, startsAt, endsAt),
        404,
        'member_not_found',
      ],
      [
        shiftBody(theo.id, anna, annaAccount, minutesFromNow(-120), minutesFromNow(-60)),
        409,
        'shift_ended_conflict',
      ],
      [
        shiftBody(theo.id, anna, annaAccount, startsAt, new Date(endsAt.getTime() + 30_000)),
        400,
        'shift_range_invalid',
      ],
      [
        shiftBody(theo.id, anna, annaAccount, startsAt, new Date(startsAt.getTime() + 25 * HOUR)),
        400,
        'shift_range_invalid',
      ],
    ];
    for (const [body, status, code] of expectations) {
      const response = await call('POST', '/scheduling/shifts', owner, body);
      expect([response.statusCode, codeOf(response)]).toEqual([status, code]);
    }
  });

  it('keeps an account off two members and a member off two shifts, naming the shift in the way', async () => {
    const startsAt = new Date(theoTomorrow.startsAt);
    const sameAccount = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(
        basile.id,
        anna,
        annaAccount,
        new Date(startsAt.getTime() + 2 * HOUR),
        new Date(startsAt.getTime() + 8 * HOUR),
      ),
    );
    expect([sameAccount.statusCode, codeOf(sameAccount)]).toEqual([409, 'shift_account_conflict']);
    expect(detailsOf(sameAccount)).toEqual({ shiftId: theoTomorrow.id });

    // Basile on Inès, then on Anna at the same time: the member is busy, on another creator.
    const onInes = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(basile.id, ines, inesAccount, new Date(startsAt.getTime() - 6 * HOUR), startsAt),
    );
    expect(onInes.statusCode).toBe(201);
    const busy = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(basile.id, anna, annaAccount, new Date(startsAt.getTime() - 3 * HOUR), startsAt),
    );
    expect([busy.statusCode, codeOf(busy)]).toEqual([409, 'shift_member_conflict']);
    expect(detailsOf(busy)).toEqual({ shiftId: ShiftSchema.parse(onInes.json()).id });

    // End to end: Théo's shift ends when the next one starts on his account.
    const following = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(
        basile.id,
        anna,
        annaAccount,
        new Date(theoTomorrow.endsAt),
        new Date(new Date(theoTomorrow.endsAt).getTime() + HOUR),
      ),
    );
    expect(following.statusCode).toBe(201);
  });

  it('shows a planner every shift and account, and a chatter their own shifts, accounts and name only', async () => {
    const from = parisInstant(parisDay(0), 0);
    const to = parisInstant(parisDay(3), 0);
    const all = await planning(owner, from, to);
    expect(new Set(all.shifts.map((shift) => shift.memberId))).toEqual(new Set([theo.id, basile.id]));
    expect(all.accounts.map((account) => account.creatorName).toSorted()).toEqual(['Anna', 'Inès']);
    expect(all.members.map((member) => member.displayName).toSorted()).toEqual(['Basile', 'Théo']);
    expect(all.conflicts).toEqual([]);

    const onlyInes = await planning(noraCookie, from, to, ines);
    expect(onlyInes.shifts.every((shift) => shift.creatorId === ines)).toBe(true);
    expect(onlyInes.accounts.map((account) => account.id)).toEqual([inesAccount]);

    const mine = await planning(theoCookie, from, to);
    expect(mine.shifts.map((shift) => shift.id)).toEqual([theoTomorrow.id]);
    expect(mine.members).toEqual([{ id: theo.id, displayName: 'Théo', color: null }]);
    expect(mine.accounts).toEqual([
      { id: annaAccount, creatorId: anna, creatorName: 'Anna', platform: 'reveal', handle: 'anna-invente' },
    ]);

    const tooLong = await call(
      'GET',
      `/scheduling/planning?${new URLSearchParams({ from: iso(from), to: iso(new Date(from.getTime() + 43 * 24 * HOUR)) }).toString()}`,
      owner,
    );
    expect([tooLong.statusCode, codeOf(tooLong)]).toEqual([400, 'planning_range_invalid']);
  });

  it('moves a shift before it starts, and cancels it once', async () => {
    const later = new Date(new Date(theoTomorrow.startsAt).getTime() - HOUR);
    const moved = await call('PATCH', `/scheduling/shifts/${theoTomorrow.id}`, owner, {
      startsAt: iso(later),
    });
    expect(moved.statusCode).toBe(200);
    expect(ShiftSchema.parse(moved.json()).startsAt).toBe(later.toISOString());

    const off = await call('PATCH', `/scheduling/shifts/${theoTomorrow.id}`, owner, { memberId: basile.id });
    expect([off.statusCode, codeOf(off)]).toEqual([409, 'shift_member_conflict']);

    expect((await call('DELETE', `/scheduling/shifts/${theoTomorrow.id}`, theoCookie)).statusCode).toBe(403);
    expect((await call('DELETE', `/scheduling/shifts/${theoTomorrow.id}`, owner)).statusCode).toBe(204);
    const twice = await call('DELETE', `/scheduling/shifts/${theoTomorrow.id}`, owner);
    expect([twice.statusCode, codeOf(twice)]).toEqual([404, 'shift_not_found']);
    const mine = await planning(theoCookie, parisInstant(parisDay(0), 0), parisInstant(parisDay(3), 0));
    expect(mine.shifts).toEqual([]);
  });

  it('a shift under way keeps its member and start, ends earlier, then stops; Aujourd’hui follows it', async () => {
    const created = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(basile.id, ines, inesAccount, minutesFromNow(-60), minutesFromNow(180)),
    );
    expect(created.statusCode).toBe(201);
    basileUnderWay = ShiftSchema.parse(created.json());

    const today = MyShiftsSchema.parse((await call('GET', '/scheduling/my-shifts', basileCookie)).json());
    expect(today.current).toMatchObject({
      id: basileUnderWay.id,
      creatorName: 'Inès',
      platform: 'reveal',
      handle: 'ines-inventee',
      accessStartsAt: new Date(new Date(basileUnderWay.startsAt).getTime() - 15 * MINUTE).toISOString(),
      accessEndsAt: new Date(new Date(basileUnderWay.endsAt).getTime() + 15 * MINUTE).toISOString(),
    });
    expect(today.next?.memberId).toBe(basile.id);
    const onDuty = OnDutyListSchema.parse((await call('GET', '/scheduling/on-duty', noraCookie)).json());
    expect(onDuty.onDuty.map((row) => [row.shiftId, row.member.displayName])).toEqual([
      [basileUnderWay.id, 'Basile'],
    ]);
    expect((await call('GET', '/scheduling/on-duty', basileCookie)).statusCode).toBe(403);
    expect(await app.modules.scheduling.onShift(ines, new Date())).toEqual([
      {
        memberId: basile.id,
        platformAccountId: inesAccount,
        shiftId: basileUnderWay.id,
        endsAt: new Date(basileUnderWay.endsAt),
      },
    ]);
    expect(await app.modules.scheduling.onShift(ines, minutesFromNow(-61))).toEqual([]);

    const url = `/scheduling/shifts/${basileUnderWay.id}`;
    const otherMember = await call('PATCH', url, owner, { memberId: nora.id });
    expect([otherMember.statusCode, codeOf(otherMember)]).toEqual([409, 'shift_started_conflict']);
    const longer = await call('PATCH', url, owner, { endsAt: iso(minutesFromNow(240)) });
    expect([longer.statusCode, codeOf(longer)]).toEqual([409, 'shift_started_conflict']);

    const shorter = await call('PATCH', url, owner, { endsAt: iso(minutesFromNow(120)) });
    expect(shorter.statusCode).toBe(200);
    const stopped = ShiftSchema.parse(
      (await call('PATCH', url, owner, { endsAt: iso(minutesFromNow(-30)) })).json(),
    );
    expect(stopped.stoppedAt).not.toBeNull();
    expect(new Date(stopped.endsAt).getTime()).toBe(
      Math.floor(Date.parse(stopped.stoppedAt ?? '') / MINUTE) * MINUTE,
    );

    // Stopped, its window closed with it: not current, and never `ended`.
    const after = MyShiftsSchema.parse((await call('GET', '/scheduling/my-shifts', basileCookie)).json());
    expect(after.current).toBeNull();
    expect(after.ended).toBeNull();
    const ended = await call('PATCH', url, owner, { endsAt: iso(minutesFromNow(-10)) });
    expect([ended.statusCode, codeOf(ended)]).toEqual([409, 'shift_ended_conflict']);
  });

  it('a template makes its shifts four weeks ahead, once, and shows the occurrence kept out', async () => {
    const day = parisDay(1);
    const weekday = weekdayOf(day);
    // Basile already holds Anna's account the second week, at the template's hours.
    const blocking = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(
        basile.id,
        anna,
        annaAccount,
        parisInstant(parisDay(8), 7 * 60),
        parisInstant(parisDay(8), 9 * 60),
      ),
    );
    expect(blocking.statusCode).toBe(201);
    const template = {
      creatorId: anna,
      platformAccountId: annaAccount,
      memberId: theo.id,
      weekday,
      startMinute: 360,
      endMinute: 720,
    };

    const yesterday = await call('POST', '/scheduling/shift-templates', owner, {
      ...template,
      validFrom: parisDay(-1),
    });
    expect([yesterday.statusCode, codeOf(yesterday)]).toEqual([400, 'shift_template_date_invalid']);
    const created = await call('POST', '/scheduling/shift-templates', noraCookie, {
      ...template,
      validFrom: parisDay(0),
    });
    expect(created.statusCode).toBe(201);
    const made = ShiftTemplateSchema.parse(created.json());

    const from = parisInstant(parisDay(0), 0);
    const to = parisInstant(parisDay(28), 0);
    const read = await planning(owner, from, to, anna);
    const fromTemplate = read.shifts.filter((shift) => shift.templateId === made.id);
    expect(fromTemplate.map((shift) => shift.startsAt)).toEqual(
      [1, 15, 22].map((days) => parisInstant(parisDay(days), 360).toISOString()),
    );
    expect(read.conflicts).toEqual([
      {
        templateId: made.id,
        startsAt: parisInstant(parisDay(8), 360).toISOString(),
        endsAt: parisInstant(parisDay(8), 720).toISOString(),
        reason: 'account_taken',
        shiftId: ShiftSchema.parse(blocking.json()).id,
      },
    ]);
    expect((await planning(theoCookie, from, to)).conflicts).toEqual([]);

    // The job makes nothing twice; a shift moved by hand stays its occurrence.
    const warned: object[] = [];
    const jobLogger = { warn: (object: object) => warned.push(object) };
    const first = fromTemplate[0];
    if (first === undefined) throw new Error('no shift from the template');
    const moved = await call('PATCH', `/scheduling/shifts/${first.id}`, owner, {
      startsAt: iso(new Date(new Date(first.startsAt).getTime() + HOUR)),
    });
    expect(moved.statusCode).toBe(200);
    expect(await app.modules.scheduling.jobs.makeShifts(jobLogger)).toBe(0);

    const templates = ShiftTemplateListSchema.parse(
      (await call('GET', '/scheduling/shift-templates', owner)).json(),
    );
    expect(templates.templates.map((one) => one.id)).toEqual([made.id]);
    expect((await call('GET', '/scheduling/shift-templates', theoCookie)).statusCode).toBe(403);

    // Ended today: its shifts not yet started go with it, and it is not ended twice.
    expect((await call('DELETE', `/scheduling/shift-templates/${made.id}`, owner)).statusCode).toBe(204);
    const afterEnd = await planning(owner, from, to, anna);
    expect(afterEnd.shifts.filter((shift) => shift.templateId === made.id)).toEqual([]);
    expect(afterEnd.conflicts).toEqual([]);
    const twice = await call('DELETE', `/scheduling/shift-templates/${made.id}`, owner);
    expect([twice.statusCode, codeOf(twice)]).toEqual([404, 'shift_template_not_found']);
    expect(await app.modules.scheduling.jobs.makeShifts(jobLogger)).toBe(0);
    expect(warned).toEqual([]);
  });

  it('the job makes what a template is owed, one template at a time, and waits for one being ended', async () => {
    const warned: object[] = [];
    const jobLogger = { warn: (object: object) => warned.push(object) };
    const owed = newId(ShiftTemplateIdSchema);
    const ending = newId(ShiftTemplateIdSchema);
    const templateOn = (id: string, day: number) => ({
      id,
      creatorId: ines,
      platformAccountId: inesAccount,
      memberId: basile.id,
      weekday: weekdayOf(parisDay(day)),
      startMinute: 1410,
      endMinute: 1430,
      validFrom: parisDay(0),
      createdBy: nora.userId,
    });
    // Written straight in the table: two templates whose shifts were never made.
    await test.admin.db.insert(schema.shiftTemplates).values([templateOn(owed, 3), templateOn(ending, 4)]);
    const someoneWaitsOnALock = async () =>
      (
        await test.admin.db.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock'`,
        )
      ).rows[0]?.waiting !== 0;

    // Ended as `endTemplate` ends it, locked, while the job runs: the job waits for it, then reads it ended.
    const { job } = await test.admin.db.transaction(async (tx) => {
      const byId = eq(schema.shiftTemplates.id, ending);
      await tx.select({ id: schema.shiftTemplates.id }).from(schema.shiftTemplates).where(byId).for('update');
      await tx
        .update(schema.shiftTemplates)
        .set({ validUntil: parisDay(5) })
        .where(byId);
      const running = app.modules.scheduling.jobs.makeShifts(jobLogger);
      for (let tries = 0; !(await someoneWaitsOnALock()); tries += 1) {
        if (tries > 250) throw new Error('the job never waited for the template being ended');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { job: running };
    });
    expect(await job).toBe(5);

    const read = await planning(owner, parisInstant(parisDay(0), 0), parisInstant(parisDay(28), 0), ines);
    const startsOf = (templateId: string) =>
      read.shifts.filter((shift) => shift.templateId === templateId).map((shift) => shift.startsAt);
    expect(startsOf(owed)).toEqual(
      [3, 10, 17, 24].map((day) => parisInstant(parisDay(day), 1410).toISOString()),
    );
    expect(startsOf(ending)).toEqual([parisInstant(parisDay(4), 1410).toISOString()]);
    expect(await app.modules.scheduling.jobs.makeShifts(jobLogger)).toBe(0);
    expect(warned).toEqual([]);
  });

  it('writes who planned what in the audit trail, never a name', async () => {
    const rows = await test.admin.db
      .select({
        action: schema.auditLog.action,
        entity: schema.auditLog.entity,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'shift_template'));
    expect(rows.map((row) => row.action).toSorted()).toEqual(['shift_template.create', 'shift_template.end']);
    expect(JSON.stringify(rows)).not.toMatch(/Théo|Basile|Anna/u);
  });

  it('puts no shift on a member during their approved leave, under the member’s lock (ADR 0031)', async () => {
    const { member: lou } = await addMember({
      email: 'lou@example.test',
      displayName: 'Lou',
      teamRole: 'chatter',
      creatorIds: [ines],
    });
    // Written straight in the table, as the leave routes will: approved by the active manager.
    const approvedLeave = async (db: typeof test.admin.db, day: number) => {
      const id = newId(LeaveRequestIdSchema);
      await db.insert(schema.leaveRequests).values({
        id,
        memberId: lou.id,
        firstDay: parisDay(day),
        lastDay: parisDay(day),
        timeZone: PARIS,
        startsAt: parisInstant(parisDay(day), 0),
        endsAt: parisInstant(parisDay(day + 1), 0),
        status: 'approved',
        decidedAt: new Date(),
        decidedBy: nora.userId,
        createdBy: lou.userId,
      });
      return id;
    };
    const louOn = (day: number) =>
      shiftBody(
        lou.id,
        ines,
        inesAccount,
        parisInstant(parisDay(day), 600),
        parisInstant(parisDay(day), 720),
      );
    const away = await approvedLeave(test.admin.db, 12);
    const twelfth = {
      startsAt: parisInstant(parisDay(12), 600).toISOString(),
      endsAt: parisInstant(parisDay(12), 720).toISOString(),
    };

    const onLeave = await call('POST', '/scheduling/shifts', owner, louOn(12));
    expect([onLeave.statusCode, codeOf(onLeave), detailsOf(onLeave)]).toEqual([
      409,
      'member_on_leave_conflict',
      { leaveRequestId: away },
    ]);
    const before = await call('POST', '/scheduling/shifts', noraCookie, louOn(11));
    expect(before.statusCode).toBe(201);
    const moved = await call('PATCH', `/scheduling/shifts/${ShiftSchema.parse(before.json()).id}`, owner, {
      startsAt: louOn(12).startsAt,
      endsAt: louOn(12).endsAt,
    });
    expect([moved.statusCode, codeOf(moved)]).toEqual([409, 'member_on_leave_conflict']);

    // A template makes nothing during the leave, and the planning shows that occurrence as a shift to fill.
    const created = await call('POST', '/scheduling/shift-templates', owner, {
      creatorId: ines,
      platformAccountId: inesAccount,
      memberId: lou.id,
      weekday: weekdayOf(parisDay(12)),
      startMinute: 600,
      endMinute: 720,
      validFrom: parisDay(0),
    });
    expect(created.statusCode).toBe(201);
    const template = ShiftTemplateSchema.parse(created.json());
    const from = parisInstant(parisDay(0), 0);
    const to = parisInstant(parisDay(28), 0);
    const louShifts = async () =>
      (await planning(owner, from, to, ines)).shifts
        .filter((shift) => shift.templateId === template.id)
        .map((shift) => shift.startsAt);
    const toFill = async () =>
      (await planning(owner, from, to, ines)).conflicts.filter(
        (conflict) => conflict.templateId === template.id,
      );
    expect(await louShifts()).toEqual(
      [5, 19, 26].map((day) => parisInstant(parisDay(day), 600).toISOString()),
    );
    expect(await toFill()).toEqual([
      {
        templateId: template.id,
        ...twelfth,
        reason: 'member_on_leave',
        leaveRequestId: away,
      },
    ]);
    const jobLogger = { warn: () => undefined };
    expect(await app.modules.scheduling.jobs.makeShifts(jobLogger)).toBe(0);

    // Cancelled before it started, the leave covers nothing: the job makes the occurrence.
    await test.admin.db
      .update(schema.leaveRequests)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: nora.userId })
      .where(eq(schema.leaveRequests.id, away));
    expect(await app.modules.scheduling.jobs.makeShifts(jobLogger)).toBe(1);
    expect(await louShifts()).toContain(twelfth.startsAt);
    expect(await toFill()).toEqual([]);

    // A leave approved while a shift is being placed: the shift waits for the member's lock, then sees the leave.
    const someoneWaitsOnTheMember = async () => (await lockWaits(test.admin.db)) !== 0;
    const { placing, approved } = await test.admin.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling.member:${lou.id}`}, 0))`,
      );
      // `inject` sends nothing until something waits on it.
      const placing = Promise.resolve(call('POST', '/scheduling/shifts', owner, louOn(13)));
      for (let tries = 0; !(await someoneWaitsOnTheMember()); tries += 1) {
        if (tries > 250) throw new Error('the shift never waited for the member’s lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { placing, approved: await approvedLeave(tx, 13) };
    });
    const late = await placing;
    expect([late.statusCode, codeOf(late), detailsOf(late)]).toEqual([
      409,
      'member_on_leave_conflict',
      { leaveRequestId: approved },
    ]);
  });

  it('places no shift before a member joins, nor a template that would start before', async () => {
    const { member: zoe } = await addMember({
      email: 'zoe@example.test',
      displayName: 'Zoé',
      teamRole: 'chatter',
      creatorIds: [ines],
      joinedOn: parisDay(10),
    });
    // An account of her own: the other tests' shifts stay out of the way.
    const zoeAccount = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: zoeAccount, creatorId: ines, platform: 'reveal', handle: 'ines-seconde' });
    const at = (days: number) => parisInstant(parisDay(days), 10 * 60);
    const early = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(zoe.id, ines, zoeAccount, at(3), new Date(at(3).getTime() + 4 * HOUR)),
    );
    expect([early.statusCode, codeOf(early), detailsOf(early)]).toEqual([
      409,
      'member_not_joined_conflict',
      { joinedOn: parisDay(10) },
    ]);

    const onTime = await call(
      'POST',
      '/scheduling/shifts',
      owner,
      shiftBody(zoe.id, ines, zoeAccount, at(11), new Date(at(11).getTime() + 4 * HOUR)),
    );
    expect(onTime.statusCode).toBe(201);
    const placedShift = ShiftSchema.parse(onTime.json());
    const movedEarlier = await call('PATCH', `/scheduling/shifts/${placedShift.id}`, owner, {
      startsAt: iso(at(4)),
      endsAt: iso(new Date(at(4).getTime() + 4 * HOUR)),
    });
    expect([movedEarlier.statusCode, codeOf(movedEarlier)]).toEqual([409, 'member_not_joined_conflict']);
    const toBasile = await call('PATCH', `/scheduling/shifts/${placedShift.id}`, owner, {
      memberId: basile.id,
    });
    expect(toBasile.statusCode).toBe(200);
    const backToZoeEarlier = await call('PATCH', `/scheduling/shifts/${placedShift.id}`, owner, {
      memberId: zoe.id,
      startsAt: iso(at(5)),
      endsAt: iso(new Date(at(5).getTime() + 4 * HOUR)),
    });
    expect([backToZoeEarlier.statusCode, codeOf(backToZoeEarlier)]).toEqual([
      409,
      'member_not_joined_conflict',
    ]);
    expect((await call('DELETE', `/scheduling/shifts/${placedShift.id}`, owner)).statusCode).toBe(204);

    const template = await call('POST', '/scheduling/shift-templates', owner, {
      memberId: zoe.id,
      creatorId: ines,
      platformAccountId: zoeAccount,
      weekday: 1,
      startMinute: 600,
      endMinute: 840,
      validFrom: parisDay(0),
    });
    expect([template.statusCode, codeOf(template)]).toEqual([409, 'member_not_joined_conflict']);
  });

  it('reads the day a member joins in the agency’s zone, where the shift’s report is paid', async () => {
    // Mia lives in Madagascar (UTC+3): 23:30 in Paris on the eve of her first day is already that day for her, but
    // its report would fall in the Paris fortnight before, where she has no rate.
    const { member: mia } = await addMember({
      email: 'mia@example.test',
      displayName: 'Mia',
      teamRole: 'chatter',
      creatorIds: [ines],
      joinedOn: parisDay(12),
      timeZone: 'Indian/Antananarivo',
    });
    const miaAccount = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: miaAccount, creatorId: ines, platform: 'reveal', handle: 'ines-troisieme' });
    const place = (startsAt: Date) =>
      call(
        'POST',
        '/scheduling/shifts',
        owner,
        shiftBody(mia.id, ines, miaAccount, startsAt, new Date(startsAt.getTime() + 2 * HOUR)),
      );
    const eve = await place(parisInstant(parisDay(11), 23 * 60 + 30));
    expect([eve.statusCode, codeOf(eve)]).toEqual([409, 'member_not_joined_conflict']);
    expect((await place(parisInstant(parisDay(12), 30))).statusCode).toBe(201);
  });
});
