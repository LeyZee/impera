import {
  ApiErrorSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CreatorContentSchema,
  CreatorIdSchema,
  newId,
  ScriptDropSchema,
  ScriptStructureIdSchema,
  ScriptStructureSchema,
  type CreateScriptStructureBody,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createDrizzleRetentionStore } from '../modules/content-drops/infra/db/retention-store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

/** Invented segments: never a real structure of the agency in the repository (SC-01). */
const structure = (): CreateScriptStructureBody => ({
  id: newId(ScriptStructureIdSchema),
  name: 'Soirée inventée',
  moment: 'night',
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
      mediaSlots: [
        { kind: 'image', optional: false, hint: null },
        { kind: 'video', optional: true, hint: null, minSeconds: 5, maxSeconds: 20 },
      ],
      variants: [],
    },
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
      variants: [
        { letter: 'A', hint: 'Lumière tamisée' },
        { letter: 'B', hint: 'Plein jour' },
      ],
    },
  ],
});

/**
 * Her script filled slot by slot (SC-02 lot b, ADR 0056 § 4): begun empty from her request, each slot's file
 * declared as she chooses it, a file replaced keeping its place, « Envoyer le script » refused while a slot she may
 * not leave out is empty; a replaced file's medium leaves her library like a withdrawn drop's. Invented data only
 * (ADR 0010).
 */
describe('/v1/creator-space/content/script-drops', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let requestId: string;
  let versionId: string;
  const dropId = newId(ContentDropIdSchema);
  const cookies: Record<'nora' | 'ines' | 'owner', string> = { nora: '', ines: '', owner: '' };
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });
  const base = '/v1/creator-space/content/script-drops';
  const photo = (bytes = 2 * MB) => ({ id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes });
  const fill = (slotKey: string, file: object, who: keyof typeof cookies = 'nora') =>
    call('PUT', `${base}/${dropId}/slots/${slotKey}`, who, file);
  const codeOf = (body: string) => ApiErrorSchema.parse(JSON.parse(body)).error;

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return signIn(server, email, PASSWORD);
  }

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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    cookies.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    cookies.ines = await account('ines@example.test', { role: 'creator', creatorIds: [ines] });

    const created = await call('POST', '/v1/script-structures', 'owner', structure());
    expect(created.statusCode, created.body).toBe(201);
    const library = ScriptStructureSchema.parse(created.json());
    const asked = await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', {
      id: newId(ContentRequestIdSchema),
      category: 'script',
      dueOn: '2026-11-12',
      reason: 'Ton prochain script : Soirée inventée',
      structureId: library.id,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const request = ContentRequestSchema.parse(asked.json());
    requestId = request.id;
    // Asked by hand, it shoots the version frozen then.
    expect(request.structureVersionId).toBe(library.current.id);
    versionId = library.current.id;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('begins her script empty from her request, its frozen version beside it; replayed, the same drop', async () => {
    const other = await call('POST', base, 'ines', { id: newId(ContentDropIdSchema), requestId });
    expect(other.statusCode).toBe(422);
    expect(codeOf(other.body).code).toBe('content_drop_request_unprocessable');

    const started = await call('POST', base, 'nora', { id: dropId, requestId });
    expect(started.statusCode, started.body).toBe(200);
    const script = ScriptDropSchema.parse(started.json());
    expect(script).toMatchObject({
      name: 'Soirée inventée',
      drop: { id: dropId, state: 'filling', files: [] },
    });
    expect(script.segments.map((segment) => segment.key)).toEqual(['salon', 'chambre']);
    const replayed = await call('POST', base, 'nora', { id: dropId, requestId });
    expect(ScriptDropSchema.parse(replayed.json()).drop.id).toBe(dropId);
    // One drop per request: a second id is refused.
    const second = await call('POST', base, 'nora', { id: newId(ContentDropIdSchema), requestId });
    expect(codeOf(second.body).code).toBe('content_drop_request_unprocessable');
    // Hers alone.
    expect((await call('GET', `${base}/${dropId}`, 'ines')).statusCode).toBe(404);
    expect((await call('GET', `${base}/${dropId}`, 'owner')).statusCode).toBe(403);
    // Her content shows it, being filled, and the request answered by it.
    const content = CreatorContentSchema.parse(
      (await call('GET', '/v1/creator-space/content', 'nora')).json(),
    );
    expect(content.drops.find((drop) => drop.id === dropId)?.state).toBe('filling');
    expect(content.requests.find((one) => one.id === requestId)?.dropId).toBe(dropId);
  });

  it('fills a slot with a file of its kind, refuses another kind and a slot the script does not have', async () => {
    const wrong = await fill('salon::0', {
      id: newId(ContentDropFileIdSchema),
      mime: 'video/mp4',
      bytes: 20 * MB,
    });
    expect(wrong.statusCode).toBe(422);
    expect(codeOf(wrong.body)).toMatchObject({
      code: 'content_drop_format_unprocessable',
      message: 'Cet emplacement attend une photo',
    });
    const unknown = await fill('salon:B:0', photo());
    expect([unknown.statusCode, codeOf(unknown.body).code]).toEqual([404, 'content_drop_slot_not_found']);
    expect((await fill('salon::0', photo(), 'ines')).statusCode).toBe(404);

    const first = photo();
    const filled = await fill('salon::0', first);
    expect(filled.statusCode, filled.body).toBe(200);
    expect(ContentDropSchema.parse(filled.json()).files).toMatchObject([
      { id: first.id, position: 0, state: 'awaiting', slotKey: 'salon::0' },
    ]);
    // Her phone replaying the same choice: the drop as it is.
    expect(ContentDropSchema.parse((await fill('salon::0', first)).json()).files).toHaveLength(1);
    // A video slot keeps its lengths on the file, checked once it is cleaned.
    const clip = { id: newId(ContentDropFileIdSchema), mime: 'video/mp4', bytes: 30 * MB };
    expect((await fill('salon::1', clip)).statusCode).toBe(200);
    const [row] = await test.admin.db
      .select({ min: schema.contentDropFiles.minSeconds, max: schema.contentDropFiles.maxSeconds })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, clip.id));
    expect(row).toEqual({ min: 5, max: 20 });
  });

  it('refuses « Envoyer le script » while a slot she may not leave out is empty, naming each', async () => {
    const refused = await call('POST', `${base}/${dropId}/submit`, 'nora');
    expect(refused.statusCode).toBe(422);
    expect(codeOf(refused.body)).toMatchObject({
      code: 'content_drop_slots_unprocessable',
      details: { slotKeys: ['chambre:A:0', 'chambre:B:0'] },
    });
  });

  it('replaces a slot’s file at its place, the one before kept out of her script', async () => {
    const before = await test.admin.db
      .select({ id: schema.contentDropFiles.id })
      .from(schema.contentDropFiles)
      .where(
        and(eq(schema.contentDropFiles.dropId, dropId), eq(schema.contentDropFiles.slotKey, 'salon::0')),
      );
    const next = photo(3 * MB);
    const replaced = await fill('salon::0', next);
    expect(replaced.statusCode, replaced.body).toBe(200);
    const files = ContentDropSchema.parse(replaced.json()).files;
    expect(files.filter((file) => file.slotKey === 'salon::0')).toMatchObject([{ id: next.id, position: 0 }]);
    const [old] = await test.admin.db
      .select({ replacedAt: schema.contentDropFiles.replacedAt })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, before[0]?.id ?? ''));
    expect(old?.replacedAt).not.toBeNull();
    // Its bytes no longer go up.
    const upload = await call(
      'POST',
      `/v1/creator-space/drops/${dropId}/files/${before[0]?.id ?? ''}/upload`,
      'nora',
    );
    expect([upload.statusCode, codeOf(upload.body).code]).toEqual([404, 'content_drop_file_not_found']);
  });

  it('sends her script once every slot she may not leave out is filled; replayed, the same; then no slot more', async () => {
    expect((await fill('chambre:A:0', photo())).statusCode).toBe(200);
    expect((await fill('chambre:B:0', photo())).statusCode).toBe(200);
    const sent = await call('POST', `${base}/${dropId}/submit`, 'nora');
    expect(sent.statusCode, sent.body).toBe(200);
    const drop = ContentDropSchema.parse(sent.json());
    expect(drop.state).toBe('uploading');
    expect(drop.files.map((file) => [file.slotKey, file.position])).toEqual([
      ['salon::0', 0],
      ['salon::1', 1],
      ['chambre:A:0', 2],
      ['chambre:B:0', 3],
    ]);
    expect(
      ContentDropSchema.parse((await call('POST', `${base}/${dropId}/submit`, 'nora')).json()).state,
    ).toBe('uploading');
    const late = await fill('chambre:B:0', photo());
    expect([late.statusCode, codeOf(late.body).code]).toEqual([409, 'content_drop_file_settled_conflict']);
    expect((await call('GET', `${base}/${dropId}`, 'nora')).statusCode).toBe(200);
  });

  it('erases a replaced file’s original like a withdrawn drop’s, never a live one', async () => {
    const files = await test.admin.db
      .select({ id: schema.contentDropFiles.id, replacedAt: schema.contentDropFiles.replacedAt })
      .from(schema.contentDropFiles)
      .where(
        and(eq(schema.contentDropFiles.dropId, dropId), eq(schema.contentDropFiles.slotKey, 'salon::0')),
      );
    const media: Record<'gone' | 'live', string> = { gone: '', live: '' };
    for (const file of files) {
      const which = file.replacedAt === null ? 'live' : 'gone';
      const [medium] = await test.admin.db
        .insert(schema.mediaAssets)
        .values({
          id: crypto.randomUUID(),
          creatorId: nora,
          kind: 'image',
          origin: 'creator',
          storageKey: `creators/${nora}/${which}.jpg`,
          mime: 'image/jpeg',
          bytes: MB,
          sha256: (which === 'gone' ? 'a' : 'b').repeat(64),
          expiresAt: new Date('2027-11-01T00:00:00Z'),
        })
        .returning({ id: schema.mediaAssets.id });
      media[which] = medium?.id ?? '';
      await test.admin.db
        .update(schema.contentDropFiles)
        .set({ state: 'kept', mediaAssetId: medium?.id ?? null })
        .where(eq(schema.contentDropFiles.id, file.id));
    }
    const due = await createDrizzleRetentionStore(test.admin.db).dueOriginals(
      new Date('2026-11-06T12:00:00Z'),
    );
    expect(due.filter((one) => one.creatorId === nora).map((one) => [one.mediaAssetId, one.reason])).toEqual([
      [media.gone, 'withdrawn'],
    ]);
    // The library's version she shoots stays frozen.
    const [version] = await test.admin.db
      .select({ frozen: sql<boolean>`${schema.scriptStructureVersions.frozenAt} is not null` })
      .from(schema.scriptStructureVersions)
      .where(eq(schema.scriptStructureVersions.id, versionId));
    expect(version?.frozen).toBe(true);
  });
});
