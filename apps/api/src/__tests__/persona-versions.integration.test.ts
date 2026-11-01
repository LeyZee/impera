import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ApiErrorSchema,
  newId,
  PersonaSampleReplyUnprocessableDetailsSchema,
  PersonaSchema,
  PersonaVersionIdSchema,
  type CreatorId,
  type Persona,
  type PersonaOverview,
  type PersonaVersionSummary,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { parse } from 'yaml';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };

/** The fictional demo persona of the repository (ADR 0010: never a real one in a test). */
const demo = (): Persona =>
  PersonaSchema.parse(
    parse(
      readFileSync(fileURLToPath(new URL('../../../../personas/demo/v0.1.0.yaml', import.meta.url)), 'utf8'),
    ),
  );

const withVersion = (persona: Persona, version: string): Persona => ({
  ...persona,
  meta: { ...persona.meta, version },
});

describe('persona versions (GET /v1/creators/:id/persona, POST …/persona/versions)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;
  let anna: CreatorId;
  let bea: CreatorId;

  const get = (creatorId: string, cookie: string) =>
    server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/persona`, headers: { cookie } });
  const post = (creatorId: string, cookie: string, payload: object) =>
    server.inject({
      method: 'POST',
      url: `/v1/creators/${creatorId}/persona/versions`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
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
    bea = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [anna] })
      .where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('stores versions that are never active, newest first, and audits each one', async () => {
    expect((await server.inject({ method: 'GET', url: `/v1/creators/${anna}/persona` })).statusCode).toBe(
      401,
    );
    expect((await get(anna, owner)).json()).toEqual({ creatorId: anna, latest: null, versions: [] });

    const first = await post(anna, owner, { persona: demo(), basedOn: null });
    expect(first.statusCode).toBe(201);
    const v1 = first.json<PersonaVersionSummary>();
    expect(v1).toMatchObject({ version: '0.1.0', isActive: false });

    const second = await post(anna, owner, {
      persona: withVersion(demo(), '0.1.1'),
      basedOn: v1.contentHash,
    });
    expect(second.statusCode).toBe(201);

    const overview = (await get(anna, owner)).json<PersonaOverview>();
    expect(overview.versions.map((v) => v.version)).toEqual(['0.1.1', '0.1.0']);
    expect(overview.latest?.summary.version).toBe('0.1.1');
    expect(overview.latest?.persona.details.first_name).toBe(demo().details.first_name);

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, v1.id));
    expect(audit).toEqual([{ action: 'persona_version.create' }]);
  });

  it('refuses a stale edit or a taken number with 409, and stores nothing', async () => {
    const { latest } = (await get(anna, owner)).json<PersonaOverview>();
    const stale = await post(anna, owner, { persona: withVersion(demo(), '0.2.0'), basedOn: null });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('persona_version_conflict');
    const taken = await post(anna, owner, {
      persona: withVersion(demo(), '0.1.0'),
      basedOn: latest?.summary.contentHash,
    });
    expect(taken.statusCode).toBe(409);
    expect((await get(anna, owner)).json<PersonaOverview>().versions).toHaveLength(2);
  });

  it('refuses a persona that fails the schema with 400', async () => {
    const minor = { ...demo(), details: { ...demo().details, date_of_birth: '2015-01-01' } };
    expect((await post(bea, owner, { persona: minor, basedOn: null })).statusCode).toBe(400);
  });

  it('refuses with 422 a version whose sample replies a hard guard would block, from the screen and the file (P5-01)', async () => {
    const taught = {
      ...demo(),
      sample_replies: [
        { situation: null, reply: 'Coucou toi' },
        { situation: 'Il propose de se voir', reply: 'On se fait un rdv samedi ? *sourit*' },
      ],
    };
    const refused = await post(bea, owner, { persona: taught, basedOn: null });
    expect(refused.statusCode).toBe(422);
    const { error } = ApiErrorSchema.parse(refused.json());
    expect(error.code).toBe('persona_sample_reply_unprocessable');
    const { faults } = PersonaSampleReplyUnprocessableDetailsSchema.parse(error.details);
    expect(faults).toContainEqual({ index: 1, code: 'stage_direction' });
    expect(faults).toContainEqual({ index: 1, code: 'platform_meeting_word' });
    expect(faults.every((fault) => fault.index === 1)).toBe(true);
    await expect(
      app.modules.persona.versions.load(bea, withVersion(taught, '0.9.0'), {
        sourcePath: 'a.yaml',
        activate: false,
      }),
    ).rejects.toThrow('réponse type');
    expect((await get(bea, owner)).json<PersonaOverview>().versions).toHaveLength(0);
  });

  it('lets a chatter read the persona of her creators only, and never change it', async () => {
    expect((await get(anna, operator)).statusCode).toBe(200);
    expect((await get(bea, operator)).statusCode).toBe(403);
    expect(
      (await post(anna, operator, { persona: withVersion(demo(), '0.3.0'), basedOn: null })).statusCode,
    ).toBe(403);
  });

  it('keeps each creator’s versions to herself', async () => {
    expect((await get(bea, owner)).json()).toEqual({ creatorId: bea, latest: null, versions: [] });
  });

  it('loads a file version once, activates one version at a time, and refuses a number with another content', async () => {
    const { versions } = app.modules.persona;
    const first = await versions.load(bea, withVersion(demo(), '1.0.0'), {
      sourcePath: 'a.yaml',
      activate: true,
    });
    expect(first).toMatchObject({
      created: true,
      activated: true,
      version: { version: '1.0.0', isActive: true },
    });
    const again = await versions.load(bea, withVersion(demo(), '1.0.0'), {
      sourcePath: 'a.yaml',
      activate: true,
    });
    expect(again).toMatchObject({ created: false, activated: false, version: { isActive: true } });

    const next = withVersion(demo(), '1.0.1');
    await versions.load(bea, next, { sourcePath: 'b.yaml', activate: false });
    const { versions: listed } = (await get(bea, owner)).json<PersonaOverview>();
    expect(listed.map((v) => [v.version, v.isActive])).toEqual([
      ['1.0.1', false],
      ['1.0.0', true],
    ]);
    await versions.load(bea, next, { sourcePath: 'b.yaml', activate: true });
    const after = (await get(bea, owner)).json<PersonaOverview>().versions;
    expect(after.filter((v) => v.isActive).map((v) => v.version)).toEqual(['1.0.1']);

    const changed = { ...next, additional_info: 'Autre texte' };
    await expect(
      versions.load(bea, changed, { sourcePath: 'c.yaml', activate: false }),
    ).rejects.toMatchObject({
      code: 'persona_version_conflict',
    });
    const actions = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'persona_version.activate'));
    expect(actions).toHaveLength(2);
  });

  it('activates a version from the dashboard, for her owner and herself only, audited with who did it', async () => {
    const activate = (creatorId: string, versionId: string, cookie: string, expectedActive: string | null) =>
      server.inject({
        method: 'POST',
        url: `/v1/creators/${creatorId}/persona/versions/${versionId}/activate`,
        headers: { cookie, origin: DASHBOARD_ORIGIN },
        payload: { expectedActive },
      });
    const [newest, older] = (await get(anna, owner)).json<PersonaOverview>().versions;
    if (newest === undefined || older === undefined) throw new Error('two versions expected');

    expect((await activate(anna, older.id, operator, null)).statusCode).toBe(403);
    expect((await activate(bea, older.id, owner, null)).statusCode).toBe(404);

    const first = await activate(anna, older.id, owner, null);
    expect(first.statusCode).toBe(200);
    expect(first.json<PersonaVersionSummary>()).toMatchObject({ id: older.id, isActive: true });
    const second = await activate(anna, newest.id, owner, older.id);
    expect(second.json<PersonaVersionSummary>()).toMatchObject({ id: newest.id, isActive: true });
    expect((await activate(anna, newest.id, owner, newest.id)).statusCode).toBe(200);

    // A tab left open still believes `older` is active, or that none is: it cannot undo the activation made since.
    for (const stale of [older.id, null]) {
      const refused = await activate(anna, older.id, owner, stale);
      expect(refused.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(refused.json()).error.code).toBe('persona_version_conflict');
    }
    const withoutPrecondition = await server.inject({
      method: 'POST',
      url: `/v1/creators/${anna}/persona/versions/${older.id}/activate`,
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {},
    });
    expect(withoutPrecondition.statusCode).toBe(400);

    const after = (await get(anna, owner)).json<PersonaOverview>().versions;
    expect(after.filter((v) => v.isActive).map((v) => v.id)).toEqual([newest.id]);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, newest.id));
    const activations = audit.filter((row) => row.action === 'persona_version.activate');
    expect(activations).toHaveLength(1);
    expect(activations[0]?.userId).not.toBeNull();
  });

  it('checks a stored version again before activating it: one saved before a guard changed stays inactive (P5-01)', async () => {
    const before = (await get(anna, owner)).json<PersonaOverview>().versions;
    const active = before.find((v) => v.isActive);
    if (active === undefined) throw new Error('an active version expected');
    // Stored as it would have been before the guard that now blocks it: straight in the base, past every check.
    const id = newId(PersonaVersionIdSchema);
    const taught = {
      ...withVersion(demo(), '0.8.0'),
      sample_replies: [{ situation: 'Il propose de se voir', reply: 'On se fait un rdv samedi ?' }],
    };
    await test.admin.db.insert(schema.personaVersions).values({
      id,
      creatorId: anna,
      version: '0.8.0',
      sourcePath: 'dashboard',
      content: taught,
      contentHash: createHash('sha256').update('stored before the guard').digest('hex'),
      createdBy: 'cli',
    });

    const refused = await server.inject({
      method: 'POST',
      url: `/v1/creators/${anna}/persona/versions/${id}/activate`,
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { expectedActive: active.id },
    });
    expect(refused.statusCode).toBe(422);
    expect(ApiErrorSchema.parse(refused.json()).error.code).toBe('persona_sample_reply_unprocessable');
    const after = (await get(anna, owner)).json<PersonaOverview>().versions;
    expect(after.filter((v) => v.isActive).map((v) => v.id)).toEqual([active.id]);
  });

  it('lets the owner add a creator, and nobody else', async () => {
    const create = (cookie: string, payload: object) =>
      server.inject({
        method: 'POST',
        url: '/v1/creators',
        headers: { cookie, origin: DASHBOARD_ORIGIN },
        payload,
      });
    expect((await create(operator, { displayName: 'Cleo' })).statusCode).toBe(403);
    expect((await create(owner, { displayName: 'Cleo', timezone: 'Mars/Olympus' })).statusCode).toBe(400);
    const created = await create(owner, { displayName: 'Cleo' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ displayName: 'Cleo', timezone: 'Europe/Paris' });
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, created.json<{ id: string }>().id));
    expect(audit.map((row) => [row.action, row.userId !== null])).toEqual([['creator.create', true]]);
    const list = await server.inject({ method: 'GET', url: '/v1/creators', headers: { cookie: owner } });
    expect(list.json<{ creators: { displayName: string }[] }>().creators.map((c) => c.displayName)).toContain(
      'Cleo',
    );
  });
});
