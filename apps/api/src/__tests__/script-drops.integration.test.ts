import {
  ApiErrorSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CreatorContentSchema,
  CreatorIdSchema,
  JOB_PAYLOADS,
  MEDIA_VOCABULARY_VERSION,
  newId,
  ok,
  ScriptDropSchema,
  ScriptStructureIdSchema,
  ScriptStructureSchema,
  type CreateScriptStructureBody,
  type CreatorId,
  type DropMediaDescription,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway, ScriptSummaryInput } from '@impera/llm';
import { unzipSync } from 'fflate';
import { runOnce } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { DropStorage } from '../modules/content-drops';
import { createDrizzleRetentionStore } from '../modules/content-drops/infra/db/retention-store';
import { createDrizzleScriptSummaryStore } from '../modules/content-drops/infra/db/script-summary-store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** A day ahead of the server's real clock: a request is never asked for a day already past (recette MED-10). */
const DUE_ON = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const LATER_DUE_ON = new Date(Date.now() + 44 * 86_400_000).toISOString().slice(0, 10);

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

/** The kept media of the archive's test, by storage key: invented bytes, no object store started for them. */
const STORED = new Map<string, Uint8Array>();
const unexpected = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));
const storage: DropStorage = {
  openUpload: unexpected('openUpload'),
  startUpload: unexpected('startUpload'),
  storedParts: unexpected('storedParts'),
  partUrl: unexpected('partUrl'),
  completeUpload: unexpected('completeUpload'),
  sizeOf: unexpected('sizeOf'),
  remove: unexpected('remove'),
  download: unexpected('download'),
  upload: unexpected('upload'),
  read: (key) => {
    const bytes = STORED.get(key);
    return Promise.resolve(bytes === undefined ? null : toAsync(bytes));
  },
};
async function* toAsync(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield await Promise.resolve(bytes);
}

/** The brain that tells her sent script (ADR 0083 § 6), with a fixed answer that tells each step it is given. */
const told: ScriptSummaryInput[] = [];
const scriptBrain: Pick<LlmGateway, 'summarizeScript' | 'promptHashes'> = {
  promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1' },
  summarizeScript: (input) => {
    told.push(input);
    return Promise.resolve(
      ok({
        output: {
          shootingContext: 'Un soir inventé, du salon à la chambre.',
          steps: input.steps.map((step) => ({
            step: step.step,
            overview: `L’étape ${step.code}, inventée.`,
            summary: `Résumé de ${step.code}.`,
          })),
        },
        meta: {
          provider: 'xai',
          model: 'brain-test',
          isFallback: false,
          latencyMs: 1,
          promptHash: 'summary-v1',
        },
      }),
    );
  },
};

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
  let structureId: string;
  const dropId = newId(ContentDropIdSchema);
  const cookies: Record<'nora' | 'ines' | 'owner', string> = { nora: '', ines: '', owner: '' };
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    who: keyof typeof cookies,
    body?: object,
  ) =>
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
    app = await createApp(config, createLogger(config), { dropStorage: storage, scriptBrain });
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
      dueOn: DUE_ON,
      reason: 'Ton prochain script : Soirée inventée',
      structureId: library.id,
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const request = ContentRequestSchema.parse(asked.json());
    requestId = request.id;
    // Asked by hand, it shoots the version frozen then.
    expect(request.structureVersionId).toBe(library.current.id);
    versionId = library.current.id;
    structureId = library.id;
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

  it('draws her script’s cards from its frozen version, for her alone', async () => {
    const card = await call('GET', `${base}/${dropId}/cards/salon`, 'nora');
    expect(card.statusCode, card.body).toBe(200);
    expect(card.headers['content-type']).toContain('image/svg+xml');
    expect(card.headers['content-security-policy']).toBe("default-src 'none'");
    expect(card.body).toContain('Salon');
    expect((await call('GET', `${base}/${dropId}/cards/chambre?variant=B`, 'nora')).statusCode).toBe(200);
    const missing = await call('GET', `${base}/${dropId}/cards/cuisine`, 'nora');
    expect([missing.statusCode, codeOf(missing.body).code]).toEqual([404, 'content_drop_card_not_found']);
    expect((await call('GET', `${base}/${dropId}/cards/salon`, 'ines')).statusCode).toBe(404);
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
    // Her first script sent: number 1 (SC-03), kept when the tap is replayed.
    const numbered = await test.admin.db
      .select({ scriptNumber: schema.contentDrops.scriptNumber })
      .from(schema.contentDrops)
      .where(eq(schema.contentDrops.id, dropId));
    expect(numbered.map((row) => row.scriptNumber)).toEqual([1]);
    const late = await fill('chambre:B:0', photo());
    expect([late.statusCode, codeOf(late.body).code]).toEqual([409, 'content_drop_file_settled_conflict']);
    expect((await call('GET', `${base}/${dropId}`, 'nora')).statusCode).toBe(200);
  });

  it('numbers two scripts she sends at once 2 and 3, never the same twice (SC-03)', async () => {
    const drops = await Promise.all(
      [DUE_ON, LATER_DUE_ON].map(async (dueOn) => {
        const asked = await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', {
          id: newId(ContentRequestIdSchema),
          category: 'script',
          dueOn,
          reason: 'Un autre script inventé',
          structureId,
        });
        expect(asked.statusCode, asked.body).toBe(200);
        const id = newId(ContentDropIdSchema);
        const started = await call('POST', base, 'nora', {
          id,
          requestId: ContentRequestSchema.parse(asked.json()).id,
        });
        expect(started.statusCode, started.body).toBe(200);
        for (const slotKey of ['salon::0', 'chambre:A:0', 'chambre:B:0'])
          expect((await call('PUT', `${base}/${id}/slots/${slotKey}`, 'nora', photo())).statusCode).toBe(200);
        return id;
      }),
    );
    const sent = await Promise.all(drops.map((id) => call('POST', `${base}/${id}/submit`, 'nora')));
    expect(sent.map((one) => one.statusCode)).toEqual([200, 200]);
    const numbers = await test.admin.db
      .select({ scriptNumber: schema.contentDrops.scriptNumber })
      .from(schema.contentDrops)
      .where(eq(schema.contentDrops.creatorId, nora));
    expect(
      numbers
        .map((row) => row.scriptNumber)
        .filter((n) => n !== null)
        .toSorted((a, b) => a - b),
    ).toEqual([1, 2, 3]);
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

  it('fixes each script’s moment when it is asked: its structure’s, or for a « both » one the other than her last (« ok alternance »)', async () => {
    const [first] = await test.admin.db
      .select({ moment: schema.contentRequests.moment })
      .from(schema.contentRequests)
      .where(eq(schema.contentRequests.id, requestId));
    // A night structure is shot at night.
    expect(first?.moment).toBe('night');
    const both = {
      ...structure(),
      id: newId(ScriptStructureIdSchema),
      name: 'Journée inventée',
      moment: 'both' as const,
    };
    const created = await call('POST', '/v1/script-structures', 'owner', both);
    expect(created.statusCode, created.body).toBe(201);
    const ask = async () => {
      const asked = await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', {
        id: newId(ContentRequestIdSchema),
        category: 'script',
        dueOn: DUE_ON,
        reason: 'Un script de jour comme de nuit',
        structureId: both.id,
      });
      expect(asked.statusCode, asked.body).toBe(200);
      return ContentRequestSchema.parse(asked.json());
    };
    // Her last scripts were of night: this one is of day, the next of night again.
    const day = await ask();
    expect(day.moment).toBe('day');
    // Cancelled, it is not her last script.
    expect(
      (await call('DELETE', `/v1/creators/${nora}/content-requests/${day.id}`, 'owner')).statusCode,
    ).toBe(204);
    expect((await ask()).moment).toBe('day');
    const night = await ask();
    expect(night.moment).toBe('night');
    // Begun, her « both » script is drawn as the night its request fixed, never « Jour et nuit » (recette MED-05)…
    const begun = newId(ContentDropIdSchema);
    const started = await call('POST', base, 'nora', { id: begun, requestId: night.id });
    expect(started.statusCode, started.body).toBe(200);
    const segmentKey = ScriptDropSchema.parse(started.json()).segments[0]?.key ?? 'none';
    const card = await call('GET', `${base}/${begun}/cards/${segmentKey}`, 'nora');
    expect(card.statusCode, card.body).toBe(200);
    expect(card.body).toContain('>NUIT</text>');
    expect(card.body).not.toContain('JOUR ET NUIT');
    // …and the agency no longer cancels it under her (recette MED-07): she would go on shooting a request gone.
    const cancel = await call('DELETE', `/v1/creators/${nora}/content-requests/${night.id}`, 'owner');
    expect([cancel.statusCode, codeOf(cancel.body).code]).toEqual([409, 'content_request_closed_conflict']);
    // Withdrawn first, it is the agency's to cancel again.
    expect((await call('DELETE', `/v1/creator-space/drops/${begun}`, 'nora')).statusCode).toBe(204);
    expect(
      (await call('DELETE', `/v1/creators/${nora}/content-requests/${night.id}`, 'owner')).statusCode,
    ).toBe(204);
    // Another creator's turn is her own: Ines's first « both » script is of night.
    const hers = await call('POST', `/v1/creators/${ines}/content-requests`, 'owner', {
      id: newId(ContentRequestIdSchema),
      category: 'script',
      dueOn: DUE_ON,
      reason: 'Son premier script',
      structureId: both.id,
    });
    expect(ContentRequestSchema.parse(hers.json()).moment).toBe('night');
  });

  it('gives the agency her sent script as a ZIP in its order, once every file is settled (SC-03 c)', async () => {
    const url = `/v1/creators/${nora}/drops/${dropId}/script-export`;
    // Still being received: not yet.
    const early = await call('GET', url, 'owner');
    expect(early.statusCode, early.body).toBe(422);
    expect(codeOf(early.body)).toMatchObject({
      code: 'content_drop_export_unprocessable',
      details: { reason: 'not_ready' },
    });

    // The cleaning done: both series kept, the optional video refused, the drop ready.
    const files = await test.admin.db
      .select({ id: schema.contentDropFiles.id, slotKey: schema.contentDropFiles.slotKey })
      .from(schema.contentDropFiles)
      .where(
        and(eq(schema.contentDropFiles.dropId, dropId), sql`${schema.contentDropFiles.replacedAt} is null`),
      );
    for (const file of files) {
      if (file.slotKey === 'salon::1') {
        await test.admin.db
          .update(schema.contentDropFiles)
          .set({ state: 'refused', refusal: 'Cette vidéo est trop courte' })
          .where(eq(schema.contentDropFiles.id, file.id));
        continue;
      }
      if (file.slotKey === 'salon::0') continue;
      const key = `creators/${nora}/${file.slotKey ?? ''}.jpg`;
      const [medium] = await test.admin.db
        .insert(schema.mediaAssets)
        .values({
          id: crypto.randomUUID(),
          creatorId: nora,
          kind: 'image',
          origin: 'creator',
          storageKey: key,
          mime: 'image/jpeg',
          bytes: 10,
          sha256: (file.slotKey === 'chambre:A:0' ? 'c' : 'd').repeat(64),
          expiresAt: new Date('2027-11-01T00:00:00Z'),
        })
        .returning({ id: schema.mediaAssets.id });
      await test.admin.db
        .update(schema.contentDropFiles)
        .set({ state: 'kept', mediaAssetId: medium?.id ?? null })
        .where(eq(schema.contentDropFiles.id, file.id));
    }
    await test.admin.db
      .update(schema.contentDrops)
      .set({ state: 'ready' })
      .where(eq(schema.contentDrops.id, dropId));
    const encoder = new TextEncoder();
    STORED.set(`creators/${nora}/live.jpg`, encoder.encode('salon-photo'));
    STORED.set(`creators/${nora}/chambre:A:0.jpg`, encoder.encode('serie-A'));
    STORED.set(`creators/${nora}/chambre:B:0.jpg`, encoder.encode('serie-B'));

    const exported = await call('GET', url, 'owner');
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="S001-nuit-soiree-inventee.zip"',
    );
    expect(exported.headers['cache-control']).toBe('no-store');
    const archive = unzipSync(new Uint8Array(exported.rawPayload));
    const folder = 'S001-nuit-soiree-inventee';
    expect(Object.keys(archive)).toEqual(
      [
        '00-fiche.txt',
        '01-E1-00-carton.png',
        '01-E1-01-photo.jpg',
        '02-E2A-00-carton.png',
        '02-E2A-01-photo.jpg',
        '02-E2B-00-carton.png',
        '02-E2B-01-photo.jpg',
      ].map((name) => `${folder}/${name}`),
    );
    const text = (name: string) => new TextDecoder().decode(archive[`${folder}/${name}`]);
    expect(text('01-E1-01-photo.jpg')).toBe('salon-photo');
    expect(text('02-E2B-01-photo.jpg')).toBe('serie-B');
    expect(text('00-fiche.txt')).toContain('02 · E2 — Chambre (PAYANT)');
    // A real PNG, drawn from the frozen version.
    expect([...(archive[`${folder}/01-E1-00-carton.png`] ?? []).slice(0, 4)]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);

    // The agency's alone, and under her creator only.
    expect((await call('GET', url, 'nora')).statusCode).toBe(403);
    const elsewhere = await call('GET', `/v1/creators/${ines}/drops/${dropId}/script-export`, 'owner');
    expect([elsewhere.statusCode, codeOf(elsewhere.body).code]).toEqual([404, 'content_drop_not_found']);

    // An original already erased: refused whole, never an archive with a hole.
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ erasedAt: new Date('2026-11-06T12:00:00Z') })
      .where(eq(schema.mediaAssets.storageKey, `creators/${nora}/chambre:A:0.jpg`));
    const erased = await call('GET', url, 'owner');
    expect(codeOf(erased.body)).toMatchObject({
      code: 'content_drop_export_unprocessable',
      details: { reason: 'original_erased' },
    });
  });

  it('confirms her script copied into Reveal once, by the team: her originals of it go 30 days later (SC-03 c)', async () => {
    // Given back for this test: the archive's own refused an erased original.
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ erasedAt: null })
      .where(eq(schema.mediaAssets.storageKey, `creators/${nora}/chambre:A:0.jpg`));
    const url = `/v1/creators/${nora}/drops/${dropId}/script-export/confirm`;
    expect((await call('POST', url, 'nora')).statusCode).toBe(403);
    const before = Date.now();
    const confirmed = await call('POST', url, 'owner');
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const drop = ContentDropSchema.parse(confirmed.json());
    expect(drop.scriptNumber).toBe(1);
    expect(drop.exportedAt).not.toBeNull();
    const media = await test.admin.db
      .select({ key: schema.mediaAssets.storageKey, expiresAt: schema.mediaAssets.expiresAt })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.creatorId, nora));
    const until = (key: string) =>
      media.find((one) => one.key === `creators/${nora}/${key}`)?.expiresAt?.getTime();
    const day = 24 * 3600 * 1000;
    for (const key of ['live.jpg', 'chambre:A:0.jpg', 'chambre:B:0.jpg']) {
      expect(until(key)).toBeGreaterThanOrEqual(before + 30 * day - 1000);
      expect(until(key)).toBeLessThanOrEqual(Date.now() + 30 * day + 1000);
    }
    // The replaced file's original keeps its own date.
    expect(until('gone.jpg')).toBe(new Date('2027-11-01T00:00:00Z').getTime());
    // Replayed: the same confirmation, never moved.
    const again = ContentDropSchema.parse((await call('POST', url, 'owner')).json());
    expect(again.exportedAt).toBe(drop.exportedAt);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, dropId),
          eq(schema.auditLog.action, 'content_drop.export_confirmed'),
        ),
      );
    expect(audit).toHaveLength(1);
    // Confirmed once: never taken back nor moved, even by hand in the base.
    const moved = await test.admin.db
      .execute(sql`update content_drops set exported_at = now() where id = ${dropId}`)
      .then(
        () => null,
        (error: unknown) => error,
      );
    const cause = moved instanceof Error && moved.cause instanceof Error ? moved.cause.message : '';
    expect(cause).toContain('confirmed once, by the team');
    // Copied into Reveal, it is out: neither she nor the team withdraws it, its request never reopens (recette MED-08).
    const hers = await call('DELETE', `/v1/creator-space/drops/${dropId}`, 'nora');
    expect([hers.statusCode, codeOf(hers.body).code]).toEqual([409, 'content_drop_settled_conflict']);
    const team = await call('DELETE', `/v1/creators/${nora}/drops/${dropId}`, 'owner');
    expect([team.statusCode, codeOf(team.body).code]).toEqual([409, 'content_drop_settled_conflict']);
  });

  it('tells her sent script step by step once each of its media is described, never twice (ADR 0083 § 6)', async () => {
    // Enqueued when she sent it, under its key.
    const queued = await test.admin.db.execute(sql`
      select j.payload from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
       where t.identifier = 'content_drops.summarize_script' and j.key = ${`content_drops.summarize_script:${dropId}`}`);
    expect(
      z.array(z.object({ payload: JOB_PAYLOADS['content_drops.summarize_script'] })).parse(queued.rows),
    ).toMatchObject([{ payload: { creatorId: nora, dropId } }]);
    const summarize = () =>
      runOnce({
        pgPool: test.admin.pool,
        taskList: { 'content_drops.summarize_script': app.tasks['content_drops.summarize_script'] },
      });
    const again = () =>
      test.admin.db.execute(sql`select public.enqueue_job(
        task => 'content_drops.summarize_script',
        payload => ${JSON.stringify({ creatorId: nora, dropId, correlationId: 'test' })}::jsonb
      )`);
    const summaries = () =>
      test.admin.db
        .select({
          content: schema.scriptDropSummaries.content,
          model: schema.scriptDropSummaries.model,
          reviewReasons: schema.scriptDropSummaries.reviewReasons,
        })
        .from(schema.scriptDropSummaries)
        .where(eq(schema.scriptDropSummaries.dropId, dropId));
    const kept = await test.admin.db
      .select({
        slotKey: schema.contentDropFiles.slotKey,
        mediaAssetId: schema.contentDropFiles.mediaAssetId,
      })
      .from(schema.contentDropFiles)
      .where(
        and(
          eq(schema.contentDropFiles.dropId, dropId),
          eq(schema.contentDropFiles.state, 'kept'),
          sql`${schema.contentDropFiles.replacedAt} is null`,
        ),
      )
      .orderBy(schema.contentDropFiles.position);
    const media = kept.map((file) => file.mediaAssetId ?? '');
    expect(kept.map((file) => file.slotKey)).toEqual(['salon::0', 'chambre:A:0', 'chambre:B:0']);
    const describe = (mediaAssetId: string) => {
      const content: DropMediaDescription = {
        vocabularyVersion: MEDIA_VOCABULARY_VERSION,
        kind: 'image',
        detailed: `Photo inventée ${mediaAssetId.slice(0, 4)} : une silhouette près d’une fenêtre.`,
        factualDescription: 'Une silhouette près d’une fenêtre.',
        durationS: null,
        segments: [],
        intensity: 'soft',
        anatomyVisible: [],
        castMode: 'solo',
        mood: [],
        setting: null,
        audio: null,
        textVisible: null,
        quality: 'good',
        confidenceLow: false,
        notVisible: false,
        flags: [],
      };
      return test.admin.db.insert(schema.mediaDescriptions).values({
        id: crypto.randomUUID(),
        creatorId: nora,
        mediaAssetId,
        vocabularyVersion: content.vocabularyVersion,
        content,
        model: 'vision-test',
        promptHash: 'drop-v1',
        author: 'sense',
      });
    };

    // Her switch off (§ 9): the brain is never called.
    await summarize();
    expect(told).toEqual([]);

    // On, a media not described yet: it waits.
    await test.admin.db
      .update(schema.creators)
      .set({ settings: { describeDrops: true } })
      .where(eq(schema.creators.id, nora));
    for (const id of media.slice(0, 2)) await describe(id);
    await again();
    await summarize();
    expect(told).toEqual([]);

    // The last one described: the job asked for this script alone, which is told and kept.
    await describe(media[2] ?? '');
    expect(await createDrizzleScriptSummaryStore(test.admin.db).enqueueFor(media[2] ?? '', 'test')).toBe(1);
    await summarize();
    expect(told).toHaveLength(1);
    expect(told[0]?.scriptName).toBe('Soirée inventée');
    expect(told[0]?.moment).toBe('night');
    expect(told[0]?.trace).toEqual({ creatorId: nora });
    // The refused video is left out of its step.
    expect(told[0]?.steps.map((step) => [step.step, step.code, step.media.length])).toEqual([
      ['salon:', 'E1', 1],
      ['chambre:A', 'E2A', 1],
      ['chambre:B', 'E2B', 1],
    ]);
    expect(told[0]?.steps[1]?.card).toBe('Elle se dévoile plus. Série A : Lumière tamisée.');
    expect(told[0]?.steps[0]?.media[0]?.description).toContain('Photo inventée');
    expect(await summaries()).toEqual([
      {
        content: {
          shootingContext: 'Un soir inventé, du salon à la chambre.',
          steps: ['E1', 'E2A', 'E2B'].map((code, index) => ({
            step: told[0]?.steps[index]?.step,
            overview: `L’étape ${code}, inventée.`,
            summary: `Résumé de ${code}.`,
          })),
        },
        model: 'brain-test',
        reviewReasons: [],
      },
    ]);

    // Replayed: nothing called, nothing written twice.
    await again();
    await summarize();
    expect(told).toHaveLength(1);
    expect(await summaries()).toHaveLength(1);

    // Written by a job alone: the application's role cannot.
    const written = await test.app.db
      .execute(
        sql`insert into script_drop_summaries (id, creator_id, drop_id, media_hash, content, model, prompt_hash)
        values (gen_random_uuid(), ${nora}, ${dropId}, ${'0'.repeat(64)}, '{}'::jsonb, 'x', 'y')`,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(written).toBeInstanceOf(Error);
  });

  it('lets the owner alone turn her switch; turned on, what waits for a description is enqueued again (ADR 0083 § 2, § 9)', async () => {
    const url = `/v1/creators/${nora}/drop-descriptions`;
    const queued = async (task: string) => {
      const rows = await test.admin.db.execute(sql`
        select j.key from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
         where t.identifier = ${task} and j.locked_at is null`);
      return z
        .array(z.object({ key: z.string().nullable() }))
        .parse(rows.rows)
        .map((row) => row.key ?? '')
        .sort();
    };
    // The hourly run, for every creator whose switch is on.
    const hourly = () =>
      test.admin.db.execute(
        sql`select public.enqueue_job(task => 'content_drops.describe_backlog', payload => '{}'::jsonb)`,
      );
    const backlog = () =>
      runOnce({
        pgPool: test.admin.pool,
        taskList: { 'content_drops.describe_backlog': app.tasks['content_drops.describe_backlog'] },
      });

    // Hers to read nowhere, the owner's alone.
    expect((await call('GET', url, 'nora')).statusCode).toBe(403);
    expect((await call('PUT', url, 'nora', { on: false })).statusCode).toBe(403);
    expect((await call('GET', url, 'owner')).json()).toEqual({ on: true });
    const missing = await call('GET', `/v1/creators/${newId(CreatorIdSchema)}/drop-descriptions`, 'owner');
    expect([missing.statusCode, codeOf(missing.body).code]).toEqual([404, 'creator_not_found']);

    // Off, then on again: audited each time; on, her backlog is asked at once.
    expect((await call('PUT', url, 'owner', { on: false })).json()).toEqual({ on: false });
    expect(await queued('content_drops.describe_backlog')).toEqual([]);
    expect((await call('PUT', url, 'owner', { on: true })).json()).toEqual({ on: true });
    expect((await call('PUT', url, 'owner', { on: true })).json()).toEqual({ on: true });
    expect(await queued('content_drops.describe_backlog')).toEqual([
      `content_drops.describe_backlog:${nora}`,
    ]);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, nora))
      .orderBy(schema.auditLog.createdAt);
    expect(audit.map((row) => row.action)).toEqual([
      'creator.describe_drops_off',
      'creator.describe_drops_on',
    ]);

    // Her media were described with another prompt than the gateway's of now: each one is asked again, once. Her
    // script told with the brain's prompt of now, after its last description, is left alone; the two others, never
    // told, are asked.
    await backlog();
    const media = await test.admin.db
      .select({ id: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(
        and(
          eq(schema.contentDropFiles.dropId, dropId),
          eq(schema.contentDropFiles.state, 'kept'),
          sql`${schema.contentDropFiles.replacedAt} is null`,
        ),
      );
    expect(await queued('content_drops.describe_file')).toEqual(
      media.map((one) => `content_drops.describe_file:${one.id ?? ''}`).sort(),
    );
    const scripts = await queued('content_drops.summarize_script');
    expect(scripts).toHaveLength(2);
    expect(scripts).not.toContain(`content_drops.summarize_script:${dropId}`);

    // A human's correction, newer than the synthesis: her script is told again; that medium is never described again.
    const corrected = media[0]?.id ?? '';
    const [latest] = await test.admin.db
      .select({ content: schema.mediaDescriptions.content })
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.mediaAssetId, corrected))
      .limit(1);
    await test.admin.db.execute(sql`delete from graphile_worker._private_jobs`);
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: crypto.randomUUID(),
      creatorId: nora,
      mediaAssetId: corrected,
      vocabularyVersion: MEDIA_VOCABULARY_VERSION,
      content: latest?.content ?? {},
      model: 'human',
      promptHash: 'human',
      author: 'human',
    });
    await hourly();
    await backlog();
    expect(await queued('content_drops.summarize_script')).toContain(
      `content_drops.summarize_script:${dropId}`,
    );
    expect(await queued('content_drops.describe_file')).not.toContain(
      `content_drops.describe_file:${corrected}`,
    );
  });
});
