import {
  ContractorDocumentIdSchema,
  DraftIdSchema,
  newId,
  PayPeriodSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberSchema,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';
import { activateDemoPersona } from './support/persona';
import { MethodSchema, namesOf, routesOf, type Route } from './support/routes';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/**
 * Every route of the API, asked by the people of creator A with the ids of creator B (audit des tests d'isolation,
 * 06/11): none answers 2xx, no answer carries B's data, and none of B's rows changes. The routes are read from the
 * server itself, so a route added tomorrow is swept too, and a path parameter this file does not know fails it until
 * it is said below what it names. Invented data only (ADR 0010).
 */

const PASSWORD = 'staple battery horse';
const PERIOD = PayPeriodSchema.parse('2026-11-01');

/**
 * A valid body where the minimal one would stop at the schema: these routes check the creator in the handler, after
 * validation, so only a valid body proves it.
 */
const bodiesFor = (
  ids: Readonly<Record<Seeded, string>>,
): Readonly<Record<string, Record<string, unknown>>> => ({
  'POST /v1/conversations/:id/mode': { mode: 'auto' },
  'PUT /v1/fans/:id/flags': { flag: 'doNotContact', set: true, reason: 'Raison inventée pour le test' },
  'PATCH /v1/scheduling/shift-reports/:shiftReportId': { version: 1, amountMinor: 1 },
  'POST /v1/scheduling/shift-reports/:shiftReportId/reject': { version: 1, note: 'Note inventée' },
  'PATCH /v1/scheduling/shifts/:shiftId': { memberId: ids.member },
  'POST /v1/team/members/:memberId/notes': { body: 'Note inventée' },
  'PUT /v1/scheduling/shifts/:shiftId/feedback': {
    id: newId(ShiftFeedbackIdSchema),
    nothingToReport: true,
    comment: null,
    incident: null,
    signals: [],
  },
  'PUT /v1/payroll/contractors/:memberId/profile': {
    legalName: 'Nom inventé',
    address: '1 rue Inventée, 75000 Paris',
    taxId: null,
    businessId: null,
    vatNumber: null,
    individualEntrepreneur: false,
    legalForm: null,
    shareCapitalMinor: null,
    rcsCity: null,
    email: 'facturation@nirvana.test',
  },
});

/**
 * Routes whose request is not a JSON body under `?creatorId=`: their own query, and the body they take as it is. The
 * creator check runs after them, so only such a request proves it.
 */
const REQUESTS: Readonly<
  Record<string, { readonly query: string; readonly contentType?: string; readonly payload?: Buffer }>
> = {
  // A PDF's first bytes: the route reads what a file is on them, and refuses the member before it keeps anything.
  'POST /v1/payroll/contractors/:memberId/documents': {
    query: `id=${newId(ContractorDocumentIdSchema)}&kind=urssaf_vigilance&issuedOn=2026-10-01`,
    contentType: 'application/octet-stream',
    payload: Buffer.from('%PDF-1.4\n%inventé\n'),
  },
  // Its query is strict: `?creatorId=` alone would stop it at the schema (relecture Équipe de #591).
  'GET /v1/payroll/shifts/:shiftId/estimate': { query: 'amountMinor=12300' },
};

/**
 * What an active manager of A reaches of B, and only that: the whole team, its reports and its pay (ADR 0023, « le
 * manager voit en plus toute l'équipe, la validation des rapports et des paies »), never B's fans, conversations nor
 * persona, nor her planning, which is that of the managers who have her on their list (Charles, 06/11). Exact: a route
 * of B's content he would reach tomorrow fails the test.
 */
const AGENCY_SCOPE: readonly string[] = [
  'manager of A: GET /v1/scheduling/shifts/:shiftId/report → 200',
  'manager of A: GET /v1/scheduling/shifts/:shiftId/report → 200 shows Béa, bea-inventee',
  'manager of A: GET /v1/scheduling/shifts/:shiftId/feedback → 200',
  'manager of A: GET /v1/team/members → 200 shows Bérénice',
  'manager of A: GET /v1/team/members/:memberId → 200',
  'manager of A: GET /v1/team/members/:memberId → 200 shows Bérénice',
  'manager of A: GET /v1/team/members/:memberId/commission → 200',
  'manager of A: GET /v1/team/members/:memberId/role → 200',
  'manager of A: GET /v1/team/members/:memberId/notes → 200',
  'manager of A: POST /v1/team/members/:memberId/notes → 201',
  'manager of A: GET /v1/team/pay-rules → 200 shows Béa, bea-inventee',
  // The commission a report would earn (reco 19): the same reach as the report and the commission above.
  'manager of A: GET /v1/payroll/shifts/:shiftId/estimate → 200',
];

/** B's tables the manager changes through those routes: none, her planning included (Charles, 06/11). */
const AGENCY_WRITES: readonly string[] = [];

/** What B's seeded ids stand for, by the parameter that names them in a path. */
type Seeded =
  | 'creator'
  | 'conversation'
  | 'fan'
  | 'draft'
  | 'version'
  | 'member'
  | 'shift'
  | 'report'
  | 'user'
  | 'template';

/**
 * Path parameters that name no creator's row: the person's own (a session, a passkey), the agency's settings (a
 * platform, a provider, a pay period, a template), or a token. A route whose parameters are all here is not swept.
 */
const NOT_TENANT: Readonly<Record<string, string>> = {
  sessionId: 'the person’s own session',
  passkeyId: 'the person’s own passkey',
  code: 'a system alert code',
  groupId: 'the person’s own alert group',
  platform: 'a platform name, agency settings',
  provider: 'a provider name, agency settings',
  platformModelId: 'a platform model, owner settings of the sales register',
  platformChatterId: 'a platform chatter, owner settings of the sales register',
  period: 'a pay period, agency-wide',
  regimeId: 'a billing regime, agency settings',
  bonusId: 'a bonus, agency pay',
  penaltyId: 'a penalty, agency pay',
  textId: 'a contract text, agency-wide',
  sha256: 'a logo of the agency',
  file: 'a calendar feed token, read without a session',
};

/**
 * Routes with a parameter this file does not seed, and no `:creatorId` to prove the guard: what B's row would be is
 * left to the module's own tests, each named here so the list cannot grow unseen.
 */
const RESIDUAL: Readonly<Record<string, string>> = {
  'POST /v1/alerts/triggers/:id/seen': 'a trigger of the person’s own alerts',
  'DELETE /v1/scheduling/settings/versions/:id': 'an agency planning version',
  'DELETE /v1/scheduling/swap-requests/:shiftSwapRequestId': 'swap requests: leaves-swaps tests',
  'POST /v1/scheduling/swap-requests/:shiftSwapRequestId/answer': 'swap requests: leaves-swaps tests',
  'DELETE /v1/scheduling/leave-requests/:leaveRequestId': 'leave requests: leaves-swaps tests',
  'POST /v1/scheduling/leave-requests/:leaveRequestId/decision': 'leave requests: leaves-swaps tests',
  'GET /v1/script-structures/:structureId': 'the agency’s script library',
  'PUT /v1/script-structures/:structureId': 'the agency’s script library',
  'DELETE /v1/script-structures/:structureId': 'the agency’s script library',
  'GET /v1/script-structures/:structureId/cards/:segmentKey': 'the agency’s script library',
  'DELETE /v1/trends/extension-links/:id': 'the person’s own extension link',
  'POST /v1/creator-space/content-requests/:id/refuse': 'creator space: content-drops tests',
  'GET /v1/creator-space/content/script-drops/:dropId': 'creator space: script drops tests',
  'PUT /v1/creator-space/content/script-drops/:dropId/slots/:slotKey': 'creator space: script drops tests',
  'POST /v1/creator-space/content/script-drops/:dropId/submit': 'creator space: script drops tests',
  'GET /v1/creator-space/content/script-drops/:dropId/cards/:segmentKey': 'creator space: script drops tests',
  'POST /v1/creator-space/suggestions/:id/accept': 'creator space: agenda tests',
  'POST /v1/creator-space/suggestions/:id/decline': 'creator space: agenda tests',
  'DELETE /v1/creator-space/availabilities/:id': 'creator space: agenda tests',
  'PATCH /v1/creator-space/tasks/:id': 'creator space: creator-tasks tests',
  'DELETE /v1/creator-space/tasks/:id': 'creator space: creator-tasks tests',
  'DELETE /v1/creator-space/tasks/:id/ticks/:day': 'creator space: creator-tasks tests',
  'DELETE /v1/creator-space/drops/:id': 'creator space: content-drops tests',
  'POST /v1/creator-space/drops/:id/files/:fileId/upload': 'creator space: content-drop uploads tests',
  'POST /v1/creator-space/drops/:id/files/:fileId/complete': 'creator space: content-drop uploads tests',
  'GET /v1/payroll/contractors/:memberId/documents/:documentId/file':
    'contractor documents: contractor tests',
  'POST /v1/payroll/contractors/:memberId/documents/:documentId/review':
    'contractor documents: contractor tests',
  'POST /v1/payroll/statements/:statementId/validate': 'statements: payroll tests',
  'POST /v1/payroll/statements/:statementId/pay': 'statements: payroll tests',
  'GET /v1/payroll/invoices/:invoiceId/pdf': 'invoices: invoicing tests',
  'POST /v1/payroll/invoices/:invoiceId/accept': 'invoices: invoicing tests',
  'GET /v1/payroll/invoices/:invoiceId/acceptance': 'invoices: invoicing tests',
  'POST /v1/payroll/invoices/:invoiceId/contest': 'invoices: invoicing tests',
  'POST /v1/payroll/invoices/:invoiceId/contest/refuse': 'invoices: invoicing tests',
  'POST /v1/payroll/invoices/:invoiceId/contest/uphold': 'invoices: invoicing tests',
};

/**
 * Answers 2xx with B's ids today, known and owned elsewhere: each says why and who corrects it. The list must stay
 * exact, so the day the route is corrected this test fails until its line is removed.
 */
const KNOWN_REACHED: Readonly<Record<string, string>> = {};

/** What B's id a parameter takes in this path, if B has one seeded for it. */
function seededFor(path: string, name: string): Seeded | undefined {
  if (name === 'creatorId') return 'creator';
  if (name === 'id' && path.startsWith('/v1/creators/:') && path.split('/').length >= 4) {
    const segments = path.split('/');
    if (segments[3]?.includes(':id') === true && segments[3].includes(':creatorId')) return 'creator';
    if (segments.length === 4) return 'creator';
  }
  if (name === 'id' && /^\/v1\/(creator-space\/)?conversations\/:id/u.test(path)) return 'conversation';
  if (name === 'id' && path.startsWith('/v1/fans/:id')) return 'fan';
  const byName: Readonly<Record<string, Seeded>> = {
    draftId: 'draft',
    versionId: 'version',
    memberId: 'member',
    shiftId: 'shift',
    shiftReportId: 'report',
    userId: 'user',
    templateId: 'template',
  };
  return byName[name];
}

/** Filler for a parameter beside B's creator: any value, the creator's guard answers first. */
function filler(name: string): string {
  if (name === 'day') return '2026-11-06';
  if (name === 'slotKey' || name === 'segmentKey') return 'a';
  return '00000000-0000-4000-8000-000000000000';
}

type Plan =
  | { readonly kind: 'swept'; readonly url: string }
  | { readonly kind: 'not_tenant' }
  | { readonly kind: 'residual' }
  | { readonly kind: 'unknown'; readonly name: string };

/** How a route is asked with B's ids, or why it is not. */
function planOf(route: Route, ids: Readonly<Record<Seeded, string>>): Plan {
  const segments = route.path.split('/');
  const params = segments.flatMap((segment) => namesOf(segment));
  if (params.length === 0) return { kind: 'not_tenant' };
  const hasCreator = params.some((name) => seededFor(route.path, name) === 'creator');
  const filled: string[] = [];
  let touchesB = false;
  for (const segment of segments) {
    const names = namesOf(segment);
    if (names.length === 0) {
      filled.push(segment);
      continue;
    }
    const seeded = names.map((name) => seededFor(route.path, name)).find((s) => s !== undefined);
    if (seeded !== undefined) {
      touchesB = true;
      filled.push(ids[seeded]);
      continue;
    }
    const name = names[0] ?? '';
    if (name in NOT_TENANT) {
      filled.push(filler(name));
      continue;
    }
    if (`${route.method} ${route.path}` in RESIDUAL) return { kind: 'residual' };
    if (!hasCreator) return { kind: 'unknown', name };
    filled.push(filler(name));
  }
  if (!touchesB) return { kind: 'not_tenant' };
  return { kind: 'swept', url: filled.join('/') };
}

describe('no route lets the people of one creator reach another one (audit des tests d’isolation, 06/11)', () => {
  let team: PayrollTeam;
  let ids: Record<Seeded, string>;
  let markers: string[];
  let people: { readonly role: string; readonly cookie: string }[];
  let onShift: { readonly member: TeamMember; readonly cookie: string };

  /** B's rows as the owner reads them: every table with a `creator_id`, her chatter and her account. */
  async function fingerprintOfB(): Promise<Record<string, string>> {
    const tables = z.array(z.object({ name: z.string() })).parse(
      (
        await team.test.admin.db.execute(sql`
            select c.table_name as name from information_schema.columns c
              join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'creator_id' and t.table_type = 'BASE TABLE'
             order by 1`)
      ).rows,
    );
    const prints: Record<string, string> = {};
    for (const { name } of tables) {
      const result = await team.test.admin.db.execute(
        sql`select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as hash
              from ${sql.identifier(name)} t where t.creator_id = ${ids.creator}`,
      );
      prints[name] = z.object({ hash: z.string() }).parse(result.rows[0]).hash;
    }
    for (const [name, query] of [
      ['team_members', sql`select md5(t::text) as hash from team_members t where t.id = ${ids.member}`],
      ['user', sql`select md5(t::text) as hash from "user" t where t.id = ${ids.user}`],
    ] as const) {
      prints[name] = z
        .object({ hash: z.string() })
        .parse((await team.test.admin.db.execute(query)).rows[0]).hash;
    }
    return prints;
  }

  /** A team member of the given creators only, signed in when asked. */
  async function member(
    email: string,
    displayName: string,
    creatorIds: readonly string[],
    teamRole: 'chatter' | 'manager' = 'chatter',
  ): Promise<{ readonly member: TeamMember; readonly cookie: string }> {
    const response = await team.call('POST', '/team/members', team.owner, {
      email,
      displayName,
      teamRole,
      creatorIds,
      firstName: displayName,
      lastName: 'Inventé',
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: '2025-01-01',
      commission: { rateBps: 2_000 },
      teamShareBps: null,
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = TeamMemberSchema.parse(response.json());
    const context = await team.app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: created.userId,
      providerId: 'credential',
      accountId: created.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member: created, cookie: await signIn(team.server, email, PASSWORD) };
  }

  /** An account of the given role over the given creators, signed in. */
  async function account(email: string, role: 'operator' | 'creator', creatorIds: readonly string[]) {
    const { userId } = await createOwner(team.app.auth, team.app.db.db, {
      email,
      name: 'Inventé',
      password: PASSWORD,
    });
    await team.test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: [...creatorIds] })
      .where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(team.server, email, PASSWORD) };
  }

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    const { app, anna, bea, beas } = team;
    await activateDemoPersona(app, anna);
    await activateDemoPersona(app, bea);
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId: bea,
      platformAccountId: beas,
      platformConversationId: 'c-fan-de-bea',
      platformFanId: 'f-fan-de-bea',
      fanDisplayName: 'FanDeBea',
      message: {
        ref: { platform: 'reveal', id: 'm-fan-de-bea' },
        conversationRef: { platform: 'reveal', id: 'c-fan-de-bea' },
        direction: 'inbound',
        text: 'Message inventé pour Béa',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'seed',
    });
    const admin = team.test.admin.db;
    const [fan] = await admin
      .select({ id: schema.fans.id })
      .from(schema.fans)
      .where(eq(schema.fans.creatorId, bea));
    const [version] = await admin
      .select({ id: schema.personaVersions.id })
      .from(schema.personaVersions)
      .where(eq(schema.personaVersions.creatorId, bea));
    if (fan === undefined || version === undefined) throw new Error('B was not seeded');
    const draft = newId(DraftIdSchema);
    await admin.insert(schema.drafts).values({
      id: draft,
      creatorId: bea,
      conversationId,
      personaVersionId: version.id,
      idempotencyKey: 'draft-bea',
    });
    const chatterOfB = (await member('berenice@example.test', 'Bérénice', [bea])).member;
    const report = await team.report(chatterOfB, PERIOD, 12_300, { account: beas });
    const [shift] = await admin
      .select({ id: schema.shiftReports.shiftId })
      .from(schema.shiftReports)
      .where(eq(schema.shiftReports.id, report));
    if (shift === undefined) throw new Error('B’s shift was not seeded');
    const accountOfB = await account('bea-compte@example.test', 'creator', [bea]);
    const template = newId(ShiftTemplateIdSchema);
    await admin.insert(schema.shiftTemplates).values({
      id: template,
      creatorId: bea,
      platformAccountId: beas,
      memberId: chatterOfB.id,
      weekday: 1,
      startMinute: 600,
      endMinute: 720,
      validFrom: '2026-11-02',
      createdBy: team.ownerId,
    });
    ids = {
      creator: bea,
      conversation: conversationId,
      fan: fan.id,
      draft,
      version: version.id,
      member: chatterOfB.id,
      shift: shift.id,
      report,
      user: accountOfB.userId,
      template,
    };
    onShift = await member('ambre@example.test', 'Ambre', [anna]);
    // Whole minutes, as the planning writes them (`shifts_whole_minutes_check`).
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await admin.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: anna,
      platformAccountId: team.annas,
      memberId: onShift.member.id,
      startsAt: new Date(now - 3_600_000),
      endsAt: new Date(now + 3 * 3_600_000),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    markers = ['Béa', 'FanDeBea', 'Bérénice', 'bea-inventee', 'Message inventé pour Béa'];
    people = [
      {
        role: 'operator of A',
        cookie: (await account('operateur-a@example.test', 'operator', [anna])).cookie,
      },
      {
        role: 'creator account of A',
        cookie: (await account('anna-compte@example.test', 'creator', [anna])).cookie,
      },
      { role: 'chatter of A', cookie: (await member('aurore@example.test', 'Aurore', [anna])).cookie },
      // On shift now (ADR 0025, EQ-13): her window opens A's whole list to her, never anything of B.
      { role: 'chatter of A on shift', cookie: onShift.cookie },
      {
        role: 'manager of A',
        cookie: (await member('maeva@example.test', 'Maéva', [anna], 'manager')).cookie,
      },
    ];
  });

  afterAll(async () => {
    await team.close();
  });

  it('knows what every path parameter of the server names', () => {
    const routes = routesOf(team.server.printRoutes({ commonPrefix: false }));
    expect(routes.length).toBeGreaterThan(200);
    const unknown = routes
      .map((route) => ({ route, plan: planOf(route, ids) }))
      .flatMap(({ route, plan }) =>
        plan.kind === 'unknown' ? [`${route.method} ${route.path}: ${plan.name}`] : [],
      );
    expect(unknown).toEqual([]);
    const residual = routes
      .filter((route) => planOf(route, ids).kind === 'residual')
      .map((route) => `${route.method} ${route.path}`);
    expect(residual.sort()).toEqual(Object.keys(RESIDUAL).sort());
  });

  it('lets the same valid requests through on A’s own rows: the refusals above are about B, never the request', async () => {
    const bodies = bodiesFor(ids);
    const own = (path: string) => path.replace(':memberId', onShift.member.id);
    const profile = 'PUT /v1/payroll/contractors/:memberId/profile';
    const document = 'POST /v1/payroll/contractors/:memberId/documents';
    const upload = REQUESTS[document];
    const details = bodies[profile];
    if (upload?.payload === undefined || details === undefined)
      throw new Error('the profile has its body and the document its bytes');
    const answers = [
      await team.server.inject({
        method: 'PUT',
        url: own(profile.slice(4)),
        headers: { cookie: team.owner, origin: DASHBOARD_ORIGIN },
        payload: details,
      }),
      await team.server.inject({
        method: 'POST',
        url: `${own(document.slice(5))}?${upload.query}`,
        headers: { cookie: team.owner, origin: DASHBOARD_ORIGIN, 'content-type': 'application/octet-stream' },
        payload: upload.payload,
      }),
    ];
    expect(
      answers.map((answer) => [answer.statusCode >= 200 && answer.statusCode < 300, answer.body]),
    ).toEqual(answers.map((answer) => [true, answer.body]));
  });

  it('answers none of A’s people with B’s ids, shows them nothing of B, and changes none of B’s rows', async () => {
    const routes = routesOf(team.server.printRoutes({ commonPrefix: false }));
    const before = await fingerprintOfB();
    let beforeManager = before;
    const reached: string[] = [];
    const shown: string[] = [];
    const agency: string[] = [];
    // A valid body or request that stops at the schema proves nothing: it fails the test until it is valid again.
    const invalid: string[] = [];
    const bodies = bodiesFor(ids);
    let swept = 0;
    let asked = 0;
    for (const person of people) {
      if (person.role === 'manager of A') beforeManager = await fingerprintOfB();
      for (const route of routes) {
        const plan = planOf(route, ids);
        const withParams = route.path.includes(':');
        if (plan.kind !== 'swept' && (withParams || route.method !== 'GET' || route.path.includes('*')))
          continue;
        asked += 1;
        const special = REQUESTS[`${route.method} ${route.path}`];
        const url = `${plan.kind === 'swept' ? plan.url : route.path}?${special?.query ?? `creatorId=${ids.creator}`}`;
        const writes = route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH';
        const response = await team.server.inject({
          method: MethodSchema.parse(route.method),
          url,
          headers: {
            cookie: person.cookie,
            origin: DASHBOARD_ORIGIN,
            ...(special?.contentType !== undefined && { 'content-type': special.contentType }),
          },
          // One address per request: the limiter counts by address, and a 429 would hide what the route answers.
          remoteAddress: `10.0.${String(Math.floor(asked / 250))}.${String(asked % 250)}`,
          ...(writes && {
            payload: special?.payload ??
              bodies[`${route.method} ${route.path}`] ?? { creatorId: ids.creator },
          }),
        });
        const where = `${person.role}: ${route.method} ${route.path} → ${String(response.statusCode)}`;
        const key = `${route.method} ${route.path}`;
        if (response.statusCode === 400 && (key in bodies || key in REQUESTS)) invalid.push(where);
        const leaked = markers.filter((marker) => response.body.includes(marker));
        const sees = (finding: string) =>
          (person.role === 'manager of A' ? agency : finding.includes(' shows ') ? shown : reached).push(
            finding,
          );
        if (plan.kind === 'swept') {
          swept += 1;
          if (response.statusCode >= 200 && response.statusCode < 300) sees(where);
        }
        if (leaked.length > 0) sees(`${where} shows ${leaked.join(', ')}`);
      }
    }
    expect(swept).toBeGreaterThan(100);
    const after = await fingerprintOfB();
    expect({
      invalid,
      reached,
      shown,
      agency,
      changed: beforeManager,
      changedByManager: Object.keys(after).filter((table) => after[table] !== beforeManager[table]),
    }).toEqual({
      invalid: [],
      reached: Object.keys(KNOWN_REACHED),
      shown: [],
      agency: AGENCY_SCOPE,
      changed: before,
      changedByManager: AGENCY_WRITES,
    });
  });
});
