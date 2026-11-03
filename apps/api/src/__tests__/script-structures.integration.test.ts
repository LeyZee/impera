import {
  newId,
  ScriptQueueSchema,
  ScriptStructureIdSchema,
  ScriptStructureListSchema,
  ScriptStructureSchema,
  TeamMemberIdSchema,
  type CreateScriptStructureBody,
  type ScriptStage,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatter', password: 'battery staple horse' };

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), details: z.record(z.string(), z.unknown()) }),
});
const errorOf = (response: { readonly statusCode: number; json: () => unknown }) => [
  response.statusCode,
  ErrorBodySchema.parse(response.json()).error.code,
];

/** Invented stages: never a real structure of the agency in the repository (SC-01). */
const stage = (key: string, name: string): ScriptStage => ({
  kind: 'stage',
  key,
  name,
  intention: 'Elle se dévoile un peu plus',
  mood: 'Lumière tamisée',
  mediaSlots: [
    { kind: 'image', optional: false, hint: null },
    { kind: 'video', optional: false, hint: 'Face caméra', minSeconds: 60, maxSeconds: 120 },
  ],
  variants: [],
});

describe('script structures (SC-01, /v1/script-structures)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;
  let manager: Record<string, string>;
  let chatter: Record<string, string>;

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
    for (const [account, teamRole] of [
      [MANAGER, 'manager'],
      [CHATTER, 'chatter'],
    ] as const) {
      const { userId } = await createOwner(app.auth, app.db.db, account);
      await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    manager = { cookie: await signIn(server, MANAGER.email, MANAGER.password), origin: DASHBOARD_ORIGIN };
    chatter = { cookie: await signIn(server, CHATTER.email, CHATTER.password), origin: DASHBOARD_ORIGIN };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const body = (extra: Partial<CreateScriptStructureBody> = {}): CreateScriptStructureBody => ({
    id: newId(ScriptStructureIdSchema),
    name: 'Soirée au salon',
    moment: 'night',
    reservedCreatorId: null,
    segments: [
      stage('canape', 'Canapé'),
      { kind: 'bridge', key: 'canape-lit', from: 'canape', to: 'lit', teaser: 'On passe à côté ?' },
      stage('lit', 'Lit'),
    ],
    ...extra,
  });
  const post = (headers: Record<string, string>, payload: object) =>
    server.inject({ method: 'POST', url: '/v1/script-structures', headers, payload });
  const put = (id: string, payload: object) =>
    server.inject({ method: 'PUT', url: `/v1/script-structures/${id}`, headers: owner, payload });
  const setQueue = (creatorId: string, structureIds: readonly string[]) =>
    server.inject({
      method: 'PUT',
      url: `/v1/creators/${creatorId}/script-queue`,
      headers: owner,
      payload: { structureIds },
    });

  it('writes a structure under the client’s id, once, for the owner alone; the agency reads it', async () => {
    const first = body();
    expect((await server.inject({ method: 'GET', url: '/v1/script-structures' })).statusCode).toBe(401);
    expect((await post(manager, first)).statusCode).toBe(403);

    const created = await post(owner, first);
    expect(created.statusCode).toBe(201);
    const structure = ScriptStructureSchema.parse(created.json());
    expect(structure.current).toMatchObject({ version: 1, name: 'Soirée au salon', frozen: false });
    expect((await post(owner, first)).statusCode).toBe(200);
    expect(errorOf(await post(owner, { ...first, name: 'Autre' }))).toEqual([
      409,
      'script_structure_conflict',
    ]);

    const list = async (headers: Record<string, string>) =>
      ScriptStructureListSchema.parse(
        (await server.inject({ method: 'GET', url: '/v1/script-structures', headers })).json(),
      ).structures.map((s) => s.id);
    expect(await list(owner)).toContain(first.id);
    expect(await list(manager)).toContain(first.id);
    expect(await list(chatter)).toEqual([]);
  });

  it('refuses what breaks a rule of the structure, with the fault at its place', async () => {
    const broken = body({
      segments: [stage('a', 'Canapé'), { ...stage('b', 'Lit'), mediaSlots: [] }],
    });
    const response = await post(owner, broken);
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('aucun média à tourner');
  });

  it('changes a version in place until it is frozen, then writes the next one (rule 6)', async () => {
    const first = body();
    await post(owner, first);
    const renamed = await put(first.id, { ...first, id: undefined, name: 'Salon, bis', basedOnVersion: 1 });
    expect(ScriptStructureSchema.parse(renamed.json()).current).toMatchObject({
      version: 1,
      name: 'Salon, bis',
    });

    const frozen = await app.modules.scripts.structures.freeze(first.id, await ownerId());
    expect(frozen).toMatchObject({ version: 1, frozen: true });
    const next = await put(first.id, { ...first, id: undefined, name: 'Salon, ter', basedOnVersion: 1 });
    expect(ScriptStructureSchema.parse(next.json()).current).toMatchObject({
      version: 2,
      name: 'Salon, ter',
      frozen: false,
    });
    const [kept] = await test.admin.db
      .select({ name: schema.scriptStructureVersions.name })
      .from(schema.scriptStructureVersions)
      .where(eq(schema.scriptStructureVersions.id, frozen?.id ?? ''));
    expect(kept?.name).toBe('Salon, bis');
    expect(errorOf(await put(first.id, { ...first, id: undefined, basedOnVersion: 1 }))).toEqual([
      409,
      'script_structure_stale_conflict',
    ]);
  });

  it('keeps out of her queue a structure whose stage touches her limits, and names the stage', async () => {
    const nora = await app.modules.persona.creators.create({ displayName: 'Nora' });
    const fine = body();
    const harsh = body({ segments: [stage('dur', 'Humiliation douce')] });
    await post(owner, fine);
    await post(owner, harsh);

    // Without an active persona nothing is read, and the queue says so.
    const unchecked = ScriptQueueSchema.parse((await setQueue(nora.id, [harsh.id])).json());
    expect(unchecked.personaChecked).toBe(false);

    await activateDemoPersona(app, nora.id);
    const refused = await setQueue(nora.id, [fine.id, harsh.id]);
    expect(errorOf(refused)).toEqual([422, 'script_queue_disgust_unprocessable']);
    expect(ErrorBodySchema.parse(refused.json()).error.details).toEqual({
      refusals: [
        {
          structureId: harsh.id,
          blocks: [{ key: 'dur', stageName: 'Humiliation douce', term: 'Humiliation' }],
        },
      ],
    });

    // What was queued before her persona is shown blocked, never dropped behind her back.
    const view = ScriptQueueSchema.parse(
      (
        await server.inject({ method: 'GET', url: `/v1/creators/${nora.id}/script-queue`, headers: manager })
      ).json(),
    );
    expect(view.personaChecked).toBe(true);
    expect(view.entries.map((e) => [e.structureId, e.blocks.length])).toEqual([[harsh.id, 1]]);

    const queued = ScriptQueueSchema.parse((await setQueue(nora.id, [fine.id])).json());
    expect(queued.entries.map((e) => e.structureId)).toEqual([fine.id]);
  });

  it('asks a structure kept for a creator of her alone, and takes an archived one out of every queue', async () => {
    const iris = await app.modules.persona.creators.create({ displayName: 'Iris' });
    const lena = await app.modules.persona.creators.create({ displayName: 'Léna' });
    const kept = body({ reservedCreatorId: iris.id });
    await post(owner, kept);
    expect(errorOf(await setQueue(lena.id, [kept.id]))).toEqual([
      422,
      'script_queue_structure_unprocessable',
    ]);
    expect((await setQueue(iris.id, [kept.id])).statusCode).toBe(200);
    expect(
      errorOf(await put(kept.id, { ...kept, id: undefined, reservedCreatorId: lena.id, basedOnVersion: 1 })),
    ).toEqual([400, 'script_structure_creator_invalid']);

    const removed = await server.inject({
      method: 'DELETE',
      url: `/v1/script-structures/${kept.id}`,
      headers: owner,
    });
    expect(removed.statusCode).toBe(204);
    const view = ScriptQueueSchema.parse(
      (
        await server.inject({ method: 'GET', url: `/v1/creators/${iris.id}/script-queue`, headers: owner })
      ).json(),
    );
    expect(view.entries).toEqual([]);
    expect(errorOf(await setQueue(iris.id, [kept.id]))).toEqual([
      422,
      'script_queue_structure_unprocessable',
    ]);
    expect(
      (await server.inject({ method: 'GET', url: `/v1/script-structures/${kept.id}`, headers: owner }))
        .statusCode,
    ).toBe(404);
  });

  it('draws a card of the current version: SVG in the app, the same PNG twice for the folder', async () => {
    const structure = ScriptStructureSchema.parse((await post(owner, body())).json());
    const card = (headers: Record<string, string>, path: string) =>
      server.inject({ method: 'GET', url: `/v1/script-structures/${structure.id}/cards/${path}`, headers });

    const svg = await card(manager, 'canape');
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(svg.headers['content-security-policy']).toBe("default-src 'none'");
    // Nuit by the structure's moment, Jour when asked.
    expect(svg.body).toContain('>Canapé</text>');
    expect(svg.body).toContain('#060508');
    expect((await card(manager, 'canape?theme=day')).body).toContain('#f6f1f3');

    const png = await card(owner, 'canape-lit?format=folder');
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect((await card(owner, 'canape-lit?format=folder')).rawPayload.equals(png.rawPayload)).toBe(true);
    const thumbnail = await card(owner, 'lit?format=thumbnail');
    // The PNG's width, from its header: 320 for the chatters' thumbnail.
    expect(thumbnail.rawPayload.readUInt32BE(16)).toBe(320);

    expect(errorOf(await card(owner, 'absente'))).toEqual([404, 'script_card_not_found']);
    expect(errorOf(await card(owner, 'canape?variant=A'))).toEqual([404, 'script_card_not_found']);
    expect((await card(owner, 'canape?format=pdf')).statusCode).toBe(400);
    expect((await card(chatter, 'canape')).statusCode).toBe(404);
  });

  async function ownerId(): Promise<string> {
    const [row] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, OWNER.email));
    if (row === undefined) throw new Error('no owner');
    return row.id;
  }
});
