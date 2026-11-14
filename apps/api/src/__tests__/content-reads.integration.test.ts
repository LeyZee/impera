import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CreatorIdSchema,
  newId,
  ScriptStructureIdSchema,
  ScriptStructureSchema,
  TeamMemberIdSchema,
  type CreateScriptStructureBody,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createContentDropsModule, type ContentDropsModule } from '../modules/content-drops';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const DUE_ON = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

/** Invented segments: never a real structure of the agency in the repository (SC-01). */
const structure = (): CreateScriptStructureBody => ({
  id: newId(ScriptStructureIdSchema),
  name: 'Soirée inventée',
  moment: 'both',
  color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' },
  reservedCreatorId: null,
  segments: [
    {
      kind: 'stage',
      key: 'salon',
      name: 'Salon',
      intention: 'Elle se dévoile un peu',
      access: 'free',
      mood: null,
      outfit: null,
      place: null,
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
      variants: [],
    },
    { kind: 'bridge', key: 'pont', from: 'salon', to: 'chambre', teaser: 'La suite arrive', mediaSlots: [] },
    {
      kind: 'stage',
      key: 'chambre',
      name: 'Chambre',
      intention: 'Elle se dévoile plus',
      access: 'paid',
      mood: null,
      outfit: null,
      place: null,
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
      variants: [],
    },
  ],
});

/**
 * The agency's reads of her content by the modules' `index.ts` (ADR 0026 § 1), what the MCP server lists (ADR 0105
 * § 4): bounded by her id, the reader checked, a page at a time, never a medium. Invented data only (ADR 0010).
 */
describe('reads of her drops and scripts, for the MCP server', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let drops: ContentDropsModule;
  let nora: CreatorId;
  let ines: CreatorId;
  const ids: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };
  let ownerCookie = '';
  let noraCookie = '';
  let scriptDropId = '';
  let structureId = '';
  const feedDrops: string[] = [];
  let inesDrop = '';

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });
  const photo = () => ({ id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes: 2 * MB });
  const video = () => ({ id: newId(ContentDropFileIdSchema), mime: 'video/mp4', bytes: 40 * MB });
  const owner = () => ({ userId: ids.owner, role: 'owner' as const });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return userId;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const { scripts } = app.modules;
    drops = createContentDropsModule({
      db: app.db.db,
      adminDb: app.adminDb.db,
      bucket: null,
      requireRole: app.requireRole,
      scriptVersions: {
        frozen: (versionId) => scripts.frozenVersion(versionId),
        card: (versionId, key, variant, moment) => scripts.frozenCard(versionId, key, variant, moment),
        folderCard: (versionId, key, variant, moment) =>
          scripts.frozenFolderCard(versionId, key, variant, moment),
        freeze: (id, userId) => scripts.freezeForRequest(id, userId),
      },
    });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    ids.owner = (
      await createOwner(app.auth, app.db.db, {
        email: 'owner@example.test',
        name: 'Owner',
        password: PASSWORD,
      })
    ).userId;
    ownerCookie = await signIn(server, 'owner@example.test', PASSWORD);
    for (const teamRole of ['manager', 'chatter'] as const) {
      ids[teamRole] = await account(`${teamRole}@example.test`, {
        role: 'operator',
        creatorIds: [nora, ines],
      });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: ids[teamRole],
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    ids.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    noraCookie = await signIn(server, 'nora@example.test', PASSWORD);

    // Three drops of hers by the agency, one of Inès, and her script begun from its request.
    for (const sentence of ['Séance au salon', 'Séance au jardin', 'Séance au balcon']) {
      const id = newId(ContentDropIdSchema);
      const dropped = await call('POST', `/v1/creators/${nora}/drops`, ownerCookie, {
        id,
        category: 'feed_shoot',
        sentence,
        files: [photo(), photo(), video()],
      });
      expect(dropped.statusCode, dropped.body).toBe(200);
      feedDrops.push(id);
    }
    inesDrop = newId(ContentDropIdSchema);
    const hers = await call('POST', `/v1/creators/${ines}/drops`, ownerCookie, {
      id: inesDrop,
      category: 'feed_shoot',
      files: [photo()],
    });
    expect(hers.statusCode, hers.body).toBe(200);
    const created = await call('POST', '/v1/script-structures', ownerCookie, structure());
    expect(created.statusCode, created.body).toBe(201);
    structureId = ScriptStructureSchema.parse(created.json()).id;
    const asked = await call('POST', `/v1/creators/${nora}/content-requests`, ownerCookie, {
      id: newId(ContentRequestIdSchema),
      category: 'script',
      dueOn: DUE_ON,
      reason: 'Ton prochain script : Soirée inventée',
      structureId,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    scriptDropId = newId(ContentDropIdSchema);
    const started = await call('POST', '/v1/creator-space/content/script-drops', noraCookie, {
      id: scriptDropId,
      requestId: ContentRequestSchema.parse(asked.json()).id,
    });
    expect(started.statusCode, started.body).toBe(200);
    const queued = await call('PUT', `/v1/creators/${nora}/script-queue`, ownerCookie, {
      structureIds: [structureId],
    });
    expect(queued.statusCode, queued.body).toBe(200);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lists her drops newest first, a page at a time, without a medium, and nothing of another creator', async () => {
    const first = await drops.reads.drops(nora, owner(), { after: null, limit: 2 });
    expect(first.drops.map((drop) => drop.id)).toEqual([scriptDropId, feedDrops[2]]);
    expect(first.next).toBe(feedDrops[2]);
    const second = await drops.reads.drops(nora, owner(), { after: first.next, limit: 2 });
    expect(second.drops.map((drop) => drop.id)).toEqual([feedDrops[1], feedDrops[0]]);
    expect(second.next).toBeNull();
    // What it is, never where its media lie.
    const { createdAt, ...digest } = second.drops[0] ?? { createdAt: null };
    expect(createdAt).toBeInstanceOf(Date);
    expect(digest).toEqual({
      id: feedDrops[1],
      category: 'feed_shoot',
      state: 'uploading',
      sentence: 'Séance au jardin',
      requestId: null,
      scriptNumber: null,
      files: { image: 2, video: 1, audio: 0 },
    });
    // A cursor of another creator, or no id at all, gives an empty page; 50 at most a page.
    expect(await drops.reads.drops(nora, owner(), { after: inesDrop })).toEqual({ drops: [], next: null });
    expect(await drops.reads.drops(nora, owner(), { after: 'pas-un-id' })).toEqual({ drops: [], next: null });
    expect((await drops.reads.drops(nora, owner(), { after: null, limit: 500 })).drops).toHaveLength(4);
    expect((await drops.reads.drops(ines, owner(), { after: null })).drops.map((drop) => drop.id)).toEqual([
      inesDrop,
    ]);
  });

  it('lists her scripts with their structure’s name and size, and gives their steps to her own id only', async () => {
    const scripts = await drops.reads.scripts(nora, owner());
    expect(scripts).toHaveLength(1);
    const { createdAt, moment, ...script } = scripts[0] ?? { createdAt: null, moment: null };
    // A « both » structure asked of her: her request fixed Jour or Nuit.
    expect([createdAt instanceof Date, moment === 'day' || moment === 'night']).toEqual([true, true]);
    expect(script).toEqual({
      dropId: scriptDropId,
      scriptNumber: null,
      name: 'Soirée inventée',
      stages: 2,
      bridges: 1,
      state: 'filling',
      dueOn: DUE_ON,
      exportedAt: null,
    });
    expect(await drops.reads.scripts(ines, owner())).toEqual([]);
    const steps = await drops.reads.scriptSteps(nora, owner(), scriptDropId);
    expect(steps?.segments.map((segment) => segment.key)).toEqual(['salon', 'pont', 'chambre']);
    // Hers only, a script only, an id only.
    expect(await drops.reads.scriptSteps(ines, owner(), scriptDropId)).toBeNull();
    expect(await drops.reads.scriptSteps(nora, owner(), feedDrops[0] ?? '')).toBeNull();
    expect(await drops.reads.scriptSteps(nora, owner(), 'pas-un-id')).toBeNull();
  });

  it('reads her queue by names and sizes, never a step’s text', async () => {
    expect(await app.modules.scripts.reads.queue(nora, owner())).toEqual([
      { structureId, name: 'Soirée inventée', moment: 'both', stages: 2, bridges: 1 },
    ]);
    expect(await app.modules.scripts.reads.queue(ines, owner())).toEqual([]);
  });

  it('lets the owner and an active manager read, never a chatter nor her own account', async () => {
    const manager = { userId: ids.manager, role: 'operator' as const };
    expect((await drops.reads.scripts(nora, manager)).map((entry) => entry.dropId)).toEqual([scriptDropId]);
    expect(await app.modules.scripts.reads.queue(nora, manager)).toHaveLength(1);
    const chatter = { userId: ids.chatter, role: 'operator' as const };
    await expect(drops.reads.drops(nora, chatter, { after: null })).rejects.toMatchObject({
      code: 'content_drop_forbidden',
    });
    await expect(drops.reads.scripts(nora, chatter)).rejects.toMatchObject({
      code: 'content_drop_forbidden',
    });
    expect(await app.modules.scripts.reads.queue(nora, chatter)).toBeNull();
    // Her account is refused before any read, whatever the base would show it.
    const her = { userId: ids.nora, role: 'creator' as const };
    await expect(drops.reads.drops(nora, her, { after: null })).rejects.toMatchObject({
      code: 'content_drop_forbidden',
    });
    await expect(drops.reads.scriptSteps(nora, her, scriptDropId)).rejects.toMatchObject({
      code: 'content_drop_forbidden',
    });
    expect(await app.modules.scripts.reads.queue(nora, her)).toBeNull();
  });
});
