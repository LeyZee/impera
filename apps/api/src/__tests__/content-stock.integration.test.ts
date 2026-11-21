import { randomUUID } from 'node:crypto';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentStockSchema,
  CreatorIdSchema,
  DropDescriptionsReviewSchema,
  MEDIA_VOCABULARY_VERSION,
  newId,
  TeamMemberIdSchema,
  type ContentDropFileId,
  type CreatorId,
  type DropCategory,
  type DropMediaDescription,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;

/** An invented description, as the vision writes it for a drop. */
const described = (intensity: DropMediaDescription['intensity']): DropMediaDescription => ({
  vocabularyVersion: MEDIA_VOCABULARY_VERSION,
  kind: 'image',
  detailed: 'Photo inventée : une silhouette assise près d’une fenêtre, lumière douce.',
  factualDescription: 'Une silhouette près d’une fenêtre.',
  durationS: null,
  segments: [],
  intensity,
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
});

/**
 * Coffre Impera (ADR 0163): her stock by use, read by the owner and a manager and by herself, and her own review of
 * her media's descriptions under her RLS. Invented data only (ADR 0010).
 */
describe('Coffre Impera: /v1/creators/:id/stock and /v1/creator-space/stock', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const users: Record<'nora' | 'ines' | 'owner', string> = { nora: '', ines: '', owner: '' };
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    chatter: '',
  };
  const call = (method: 'GET' | 'POST', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  /** A drop with its media kept, each with a description of the given intensity or none. */
  async function drop(
    creatorId: CreatorId,
    by: string,
    category: DropCategory,
    files: readonly (DropMediaDescription['intensity'] | null)[],
    over: Partial<typeof schema.contentDrops.$inferInsert> = {},
  ) {
    const dropId = newId(ContentDropIdSchema);
    await test.admin.db
      .insert(schema.contentDrops)
      .values({ id: dropId, creatorId, category, state: 'ready', createdBy: by, ...over });
    const fileIds: ContentDropFileId[] = [];
    const descriptionIds: (string | null)[] = [];
    for (const [position, intensity] of files.entries()) {
      const mediaAssetId = randomUUID();
      await test.admin.db.insert(schema.mediaAssets).values({
        id: mediaAssetId,
        creatorId,
        kind: 'image',
        origin: 'creator',
        storageKey: `creators/${creatorId}/${mediaAssetId}.jpg`,
        mime: 'image/jpeg',
        bytes: 1000,
        sha256: mediaAssetId.replace(/-/gu, '').padEnd(64, '0'),
      });
      const fileId = newId(ContentDropFileIdSchema);
      await test.admin.db.insert(schema.contentDropFiles).values({
        id: fileId,
        creatorId,
        dropId,
        position,
        kind: 'image',
        mime: 'image/jpeg',
        bytes: 1000,
        state: 'kept',
        mediaAssetId,
      });
      fileIds.push(fileId);
      if (intensity === null) {
        descriptionIds.push(null);
        continue;
      }
      const descriptionId = randomUUID();
      await test.admin.db.insert(schema.mediaDescriptions).values({
        id: descriptionId,
        creatorId,
        mediaAssetId,
        vocabularyVersion: MEDIA_VOCABULARY_VERSION,
        content: described(intensity),
        model: 'vision-test',
        promptHash: 'drop-v2',
        author: 'sense',
      });
      descriptionIds.push(descriptionId);
    }
    return { dropId, fileIds, descriptionIds };
  }

  let video: Awaited<ReturnType<typeof drop>>;
  let gift: Awaited<ReturnType<typeof drop>>;
  let hers: Awaited<ReturnType<typeof drop>>;

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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    const owner = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    users.owner = owner.userId;
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const teamRole of ['manager', 'chatter'] as const) {
      const member = await account(`${teamRole}@example.test`, {
        role: 'operator',
        creatorIds: [nora, ines],
      });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[teamRole] = member.cookie;
    }
    for (const [who, creatorId] of [
      ['nora', nora],
      ['ines', ines],
    ] as const) {
      const one = await account(`${who}@example.test`, { role: 'creator', creatorIds: [creatorId] });
      users[who] = one.userId;
      cookies[who] = one.cookie;
    }

    // Nora: two feed videos waiting, one described; a whale gift of two photos, one too explicit to be offered; a
    // boudoir session put out two days ago; a withdrawn drop, out of every count. Ines: one feed video of hers.
    video = await drop(nora, users.nora, 'feed_video', ['soft', null]);
    gift = await drop(nora, users.nora, 'whale_gift', ['soft', 'explicit']);
    await drop(nora, users.nora, 'feed_shoot', ['soft', 'soft', 'soft'], {
      state: 'published',
      exportedAt: new Date(Date.now() - 2 * DAY),
      exportedBy: users.owner,
    });
    await drop(nora, users.nora, 'feed_video', ['soft'], {
      state: 'withdrawn',
      withdrawnBy: users.nora,
      withdrawnAt: new Date(),
    });
    hers = await drop(ines, users.ines, 'feed_video', ['soft']);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const stockOf = async (url: string, who: keyof typeof cookies) => {
    const answer = await call('GET', url, who);
    expect(answer.statusCode, answer.body).toBe(200);
    return ContentStockSchema.parse(answer.json());
  };

  it('opens her stock to the owner and a manager, to herself at her door, to no chatter', async () => {
    expect((await call('GET', `/v1/creators/${nora}/stock`, 'chatter')).statusCode).toBe(403);
    expect((await call('GET', `/v1/creators/${nora}/stock`, 'nora')).statusCode).toBe(403);
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', '/v1/creator-space/stock', who)).statusCode).toBe(403);
    const team = await stockOf(`/v1/creators/${nora}/stock`, 'manager');
    const own = await stockOf('/v1/creator-space/stock', 'nora');
    expect(own.categories).toEqual(team.categories);
    expect(own.media.map((one) => one.fileId).sort()).toEqual(team.media.map((one) => one.fileId).sort());
  });

  it('counts what is alive by use, a too explicit gift apart, and never another creator’s media', async () => {
    const stock = await stockOf(`/v1/creators/${nora}/stock`, 'owner');
    const category = (name: DropCategory) => stock.categories.find((one) => one.category === name);
    expect(category('feed_video')).toMatchObject({ stockUnits: 2, target: 7, lacking: 5, status: 'low' });
    expect(category('feed_shoot')).toMatchObject({ stockUnits: 0, outUnits7: 1, status: 'empty' });
    expect(category('whale_gift')).toMatchObject({ mode: 'count', stockUnits: 1, lacking: 2 });
    // Seven media of hers: two videos, two gift photos, three of the session; the withdrawn one and Ines's are not.
    expect(stock.media).toHaveLength(7);
    expect(stock.media.some((one) => one.fileId === hers.fileIds[0])).toBe(false);
    const byFile = new Map(stock.media.map((one) => [one.fileId, one]));
    expect(video.fileIds.map((id) => byFile.get(id)?.description)).toEqual(['to_validate', 'pending']);
    expect(gift.fileIds.map((id) => byFile.get(id)?.notAGift)).toEqual([false, true]);
    expect(stock.media.filter((one) => one.standing === 'out')).toHaveLength(3);
    // Ines sees her own only.
    const theirs = await stockOf('/v1/creator-space/stock', 'ines');
    expect(theirs.media.map((one) => one.fileId)).toEqual(hers.fileIds);
  });

  it('lets her validate and correct the descriptions of her own media, stamped by her account', async () => {
    const url = `/v1/creator-space/drops/${video.dropId}/descriptions`;
    const review = async (method: 'GET' | 'POST', path: string, body?: object) => {
      const answer = await call(method, `${url}${path}`, 'nora', body);
      expect(answer.statusCode, answer.body).toBe(200);
      return DropDescriptionsReviewSchema.parse(answer.json());
    };
    let state = await review('GET', '');
    expect(state.media.map((one) => one.description?.validatedAt ?? null)).toEqual([null, null]);
    const [first] = video.descriptionIds;

    // « C'est bien ça »: validated in her name, once.
    state = await review('POST', '/validate', { descriptionIds: [first] });
    expect(state.media[0]?.description?.validatedAt).not.toBeNull();
    const [row] = await test.admin.db
      .select({ by: schema.mediaDescriptions.validatedBy })
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.id, first ?? ''));
    expect(row?.by).toBe(users.nora);

    // « Corriger »: a new human row, validated by her; the stock reads it as validated.
    state = await review('POST', '/correct', {
      descriptionId: first,
      detailed: 'Une silhouette inventée, debout cette fois, lumière du soir.',
    });
    expect(state.media[0]?.description).toMatchObject({
      author: 'human',
      detailed: 'Une silhouette inventée, debout cette fois, lumière du soir.',
    });
    const stock = await stockOf('/v1/creator-space/stock', 'nora');
    expect(stock.media.find((one) => one.fileId === video.fileIds[0])?.description).toBe('validated');
  });

  it('keeps another creator’s drops out of her review, and her review out of the agency’s door', async () => {
    const theirs = `/v1/creator-space/drops/${hers.dropId}/descriptions`;
    expect((await call('GET', theirs, 'nora')).statusCode).toBe(404);
    expect(
      (await call('POST', `${theirs}/validate`, 'nora', { descriptionIds: [hers.descriptionIds[0]] }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', `${theirs}/correct`, 'nora', {
          descriptionId: hers.descriptionIds[0],
          detailed: 'Une phrase inventée.',
        })
      ).statusCode,
    ).toBe(404);
    for (const served of ['thumbnail', 'media'])
      expect(
        (
          await call(
            'GET',
            `/v1/creator-space/drops/${hers.dropId}/files/${hers.fileIds[0] ?? ''}/${served}`,
            'nora',
          )
        ).statusCode,
      ).toBe(404);
    const [untouched] = await test.admin.db
      .select({ at: schema.mediaDescriptions.validatedAt })
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.id, hers.descriptionIds[0] ?? ''));
    expect(untouched?.at).toBeNull();
    for (const who of ['owner', 'manager'] as const)
      expect(
        (await call('GET', `/v1/creator-space/drops/${video.dropId}/descriptions`, who)).statusCode,
      ).toBe(403);
  });
});
