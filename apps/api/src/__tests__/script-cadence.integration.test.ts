import {
  newId,
  ScriptCadenceSchema,
  ScriptStructureIdSchema,
  ScriptStructureSchema,
  TeamMemberIdSchema,
  type CreateScriptStructureBody,
  type CreatorId,
  type ScriptStage,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented accounts and creators (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const UNKNOWN = '0199f2a0-0000-7000-8000-00000000dead';

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/** Invented stages: never a real structure of the agency in the repository (SC-01). */
const stage = (key: string, name: string): ScriptStage => ({
  kind: 'stage',
  key,
  name,
  intention: 'Elle se dévoile un peu plus',
  access: 'paid',
  mood: null,
  outfit: null,
  place: null,
  mediaSlots: [{ kind: 'image', optional: false, hint: null }],
  variants: [],
});

const structure = (name: string): CreateScriptStructureBody => ({
  id: newId(ScriptStructureIdSchema),
  name,
  moment: 'night',
  color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' },
  reservedCreatorId: null,
  segments: [stage('salon', 'Salon')],
});

describe('her script cadence (SC-02, ADR 0056 § 2)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;
  let manager: Record<string, string>;
  let lina: CreatorId;
  let sasha: CreatorId;

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
    lina = (await app.modules.persona.creators.create({ displayName: 'Lina', timezone: 'Europe/Paris' })).id;
    sasha = (await app.modules.persona.creators.create({ displayName: 'Sasha', timezone: 'Europe/Paris' }))
      .id;
    // Lina has the demo persona (her disgusts: « Insultes », « Humiliation »); Sasha has none.
    await activateDemoPersona(app, lina);
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, MANAGER);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [lina, sasha] })
      .where(eq(schema.user.id, userId));
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole: 'manager',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Membre manager',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    manager = { cookie: await signIn(server, MANAGER.email, MANAGER.password), origin: DASHBOARD_ORIGIN };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const cadence = async (headers: Record<string, string>, creatorId: string) => {
    const response = await server.inject({
      method: 'GET',
      url: `/v1/creators/${creatorId}/script-cadence`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    return ScriptCadenceSchema.parse(response.json());
  };
  const setDays = (headers: Record<string, string>, creatorId: string, days: number) =>
    server.inject({
      method: 'PUT',
      url: `/v1/creators/${creatorId}/script-cadence`,
      headers,
      payload: { days },
    });
  const create = async (body: CreateScriptStructureBody) => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/script-structures',
      headers: owner,
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    return ScriptStructureSchema.parse(response.json());
  };
  const setQueue = async (creatorId: string, structureIds: readonly string[]) => {
    const response = await server.inject({
      method: 'PUT',
      url: `/v1/creators/${creatorId}/script-queue`,
      headers: owner,
      payload: { structureIds },
    });
    expect(response.statusCode).toBe(200);
  };
  const queued = async (creatorId: string) =>
    (
      await test.admin.db
        .select({ structureId: schema.scriptStructureQueue.structureId })
        .from(schema.scriptStructureQueue)
        .where(eq(schema.scriptStructureQueue.creatorId, creatorId))
        .orderBy(schema.scriptStructureQueue.position)
    ).map((row) => row.structureId);
  const requests = (creatorId: string) =>
    test.admin.db
      .select()
      .from(schema.contentRequests)
      .where(
        and(eq(schema.contentRequests.creatorId, creatorId), eq(schema.contentRequests.origin, 'cadence')),
      )
      .orderBy(schema.contentRequests.dueOn);
  const run = (at: string) => app.modules.scripts.jobs.askScripts(new Date(at));

  it('reads 14 days before anything is set; the owner alone sets it, for a creator who exists', async () => {
    expect(await cadence(manager, sasha)).toEqual({
      creatorId: sasha,
      days: 14,
      lastDueOn: null,
      outcome: null,
      skipped: [],
      checkedAt: null,
    });
    expect((await setDays(manager, sasha, 10)).statusCode).toBe(403);
    expect((await setDays(owner, sasha, 0)).statusCode).toBe(400);
    expect((await setDays(owner, sasha, 91)).statusCode).toBe(400);
    const unknown = await setDays(owner, UNKNOWN, 10);
    expect([unknown.statusCode, ErrorBodySchema.parse(unknown.json()).error.code]).toEqual([
      404,
      'script_cadence_creator_not_found',
    ]);
    expect((await setDays(owner, sasha, 21)).statusCode).toBe(200);
    expect((await cadence(manager, sasha)).days).toBe(21);
  });

  it('asks nothing of a creator without an active persona, and says so', async () => {
    const kept = await create(structure('Sans persona'));
    await setQueue(sasha, [kept.id]);
    await run('2026-11-05T10:00:00Z');
    expect(await requests(sasha)).toEqual([]);
    expect(await queued(sasha)).toEqual([kept.id]);
    expect((await cadence(owner, sasha)).outcome).toBe('no_persona');
  });

  it('asks the first structure that touches none of her limits, frozen, once; then the last one again when her queue is empty', async () => {
    const touching = await create(structure('Salon, première'));
    const fine = await create(structure('Chambre'));
    await setQueue(lina, [touching.id, fine.id]);
    // Changed after it was queued: a stage now touches what disgusts her. The cadence reads it again.
    const saved = await server.inject({
      method: 'PUT',
      url: `/v1/script-structures/${touching.id}`,
      headers: owner,
      payload: {
        ...structure('Salon, première'),
        id: undefined,
        segments: [stage('salon', 'Humiliation douce')],
        basedOnVersion: 1,
      },
    });
    expect(saved.statusCode).toBe(200);

    expect(await run('2026-11-05T10:00:00Z')).toEqual({ asked: 1, warned: 1, failed: 0 });
    const [asked, ...more] = await requests(lina);
    expect(more).toEqual([]);
    expect(asked).toMatchObject({
      category: 'script',
      dueOn: '2026-11-12',
      structureId: fine.id,
      structureVersionId: fine.current.id,
      reason: 'Ton prochain script : Chambre',
      state: 'open',
      createdBy: null,
    });
    const [version] = await test.admin.db
      .select({ frozenAt: schema.scriptStructureVersions.frozenAt })
      .from(schema.scriptStructureVersions)
      .where(eq(schema.scriptStructureVersions.id, fine.current.id));
    expect(version?.frozenAt).not.toBeNull();
    expect(await queued(lina)).toEqual([touching.id]);
    const seen = await cadence(manager, lina);
    expect(seen).toMatchObject({ outcome: 'asked', lastDueOn: '2026-11-12' });
    expect(seen.skipped.map((skip) => skip.structureId)).toEqual([touching.id]);

    // Replayed, the same hour or the next: nothing more.
    await run('2026-11-05T10:00:00Z');
    await run('2026-11-05T11:00:00Z');
    expect(await requests(lina)).toHaveLength(1);
    expect(await queued(lina)).toEqual([touching.id]);

    // Her next one is due 14 days after, asked a week before: not yet on the 18th.
    await run('2026-11-18T10:00:00Z');
    expect(await requests(lina)).toHaveLength(1);
    expect((await cadence(owner, lina)).outcome).toBe('asked');
    // On the 19th, only a touching structure left: nothing asked, the agency warned.
    await run('2026-11-19T10:00:00Z');
    expect(await requests(lina)).toHaveLength(1);
    expect((await cadence(owner, lina)).outcome).toBe('blocked');

    // Her queue emptied: the last structure is asked again, the agency warned.
    await setQueue(lina, []);
    await run('2026-11-19T11:00:00Z');
    const all = await requests(lina);
    expect(all.map((row) => [row.dueOn, row.structureId])).toEqual([
      ['2026-11-12', fine.id],
      ['2026-11-26', fine.id],
    ]);
    expect((await cadence(owner, lina)).outcome).toBe('reused');
  });

  it('asks nothing of an archived creator (ADR 0071 § 2)', async () => {
    const mila = (
      await app.modules.persona.creators.create({ displayName: 'Mila', timezone: 'Europe/Paris' })
    ).id;
    await activateDemoPersona(app, mila);
    const kept = await create(structure('Archivée'));
    await setQueue(mila, [kept.id]);
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date('2026-11-04T10:00:00Z') })
      .where(eq(schema.creators.id, mila));
    await run('2026-11-20T10:00:00Z');
    expect(await requests(mila)).toEqual([]);
    expect(await queued(mila)).toEqual([kept.id]);
    const [row] = await test.admin.db
      .select()
      .from(schema.scriptCadences)
      .where(eq(schema.scriptCadences.creatorId, mila));
    expect(row).toBeUndefined();
  });
});
