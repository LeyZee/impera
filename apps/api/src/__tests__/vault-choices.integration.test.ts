import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  vaultDescribeJobKey,
  VaultChoicesViewSchema,
  VaultDescribeAnswerSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

type Who = 'owner' | 'manager' | 'outsider' | 'chatter' | 'nora';

/**
 * The vault by choice (ADR 0145 § 5, amendment of 17/11) through the real routes, tables and RLS: nothing of her vault
 * is in the CRM before the owner ticks it, by folder or by media; nothing is described before she confirmed the count
 * and the cost shown; a manager of her list reads, never ticks nor asks. Invented data only (ADR 0010).
 */
describe('her vault, imported and described by choice', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let noraAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  const ids: Record<Who, string> = { owner: '', manager: '', outsider: '', chatter: '', nora: '' };
  const cookies = new Map<Who, string>();

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return userId;
  }

  async function call(method: 'GET' | 'PUT' | 'POST', path: string, who: Who, payload?: object) {
    let cookie = cookies.get(who);
    if (cookie === undefined) {
      cookie = await signIn(server, `${who}@example.test`, PASSWORD);
      cookies.set(who, cookie);
    }
    return server.inject({
      method,
      url: `/v1/creators/${nora}/vault${path}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });
  }

  const view = async (who: Who = 'owner') => {
    const answer = await call('GET', '/choices', who);
    expect(answer.statusCode, answer.body).toBe(200);
    return VaultChoicesViewSchema.parse(answer.json());
  };
  const imported = async () =>
    Object.fromEntries((await view()).media.map((media) => [media.platformMediaId, media.imported]));
  const describeAsk = (
    platformMediaIds: string[],
    confirm: object | null,
    key: string = crypto.randomUUID(),
  ) =>
    call('POST', '/describe', 'owner', {
      platformAccountId: noraAccount,
      platformMediaIds,
      confirm,
      idempotencyKey: key,
    });
  const queued = async () =>
    z.array(z.object({ key: z.string() })).parse(
      (
        await test.admin.db.execute(sql`
            select j.key from graphile_worker._private_jobs j
              join graphile_worker._private_tasks t on t.id = j.task_id
             where t.identifier = 'media.describe_vault' and j.key = ${vaultDescribeJobKey(noraAccount)}`)
      ).rows,
    );

  async function ref(
    accountId: PlatformAccountId,
    creatorId: CreatorId,
    mediaId: string,
    kind: 'image' | 'video' | 'audio',
    folder: string | null,
  ) {
    await test.admin.db.execute(sql`
      insert into media_platform_refs
        (id, creator_id, platform, platform_account_id, platform_media_id, kind, folder_ref, folder_name,
         folder_position, platform_created_at, last_synced_at)
      values (gen_random_uuid(), ${creatorId}, 'reveal', ${accountId}, ${mediaId}, ${kind}, ${folder},
              ${folder === null ? null : `Dossier ${folder}`}, 0, '2026-11-01T10:00:00.000Z', now())`);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    const logger = createLogger(config);
    app = await createApp(config, logger, { composer: fixedComposer });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    noraAccount = newId(PlatformAccountIdSchema);
    inesAccount = newId(PlatformAccountIdSchema);
    for (const [id, label, accountId] of [
      [nora, 'Nora', noraAccount],
      [ines, 'Ines', inesAccount],
    ] as const) {
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accountId,
        creatorId: id,
        platform: 'reveal',
        handle: `compte_${label.toLowerCase()}`,
        sessionState: 'none',
      });
    }
    ids.owner = (
      await createOwner(app.auth, app.db.db, {
        email: 'owner@example.test',
        name: 'Owner',
        password: PASSWORD,
      })
    ).userId;
    for (const [who, teamRole, list] of [
      ['manager', 'manager', [nora]],
      ['outsider', 'manager', [ines]],
      ['chatter', 'chatter', [nora]],
    ] as const) {
      ids[who] = await account(`${who}@example.test`, { role: 'operator', creatorIds: [...list] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: ids[who],
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    ids.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    // Her invented vault: two folders and the root; a voice note is never described.
    await ref(noraAccount, nora, 'a1', 'image', 'folder_a');
    await ref(noraAccount, nora, 'a2', 'video', 'folder_a');
    await ref(noraAccount, nora, 'a3', 'audio', 'folder_a');
    await ref(noraAccount, nora, 'b1', 'image', 'folder_b');
    await ref(noraAccount, nora, 'r1', 'image', null);
    await ref(inesAccount, ines, 'i1', 'image', 'folder_i');
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('imports nothing before a gesture, read by the owner and a manager of her list only', async () => {
    expect(await imported()).toEqual({ a1: false, a2: false, a3: false, b1: false, r1: false });
    const owner = await view();
    expect(owner.folders).toEqual([]);
    expect(owner.media.every((media) => media.description === 'none' && media.excerpt === null)).toBe(true);
    // Only hers: Inès's vault is not in Nora's answer.
    expect(owner.media.map((media) => media.platformAccountId)).not.toContain(inesAccount);
    expect((await view('manager')).media).toEqual(owner.media);
    for (const who of ['outsider', 'chatter', 'nora'] as const)
      expect((await call('GET', '/choices', who)).statusCode, who).toBe(403);
  });

  it('lets the owner alone tick a folder whole or a media alone, a folder’s change clearing its media’s ticks', async () => {
    const change = (who: Who, body: object) =>
      call('PUT', '/choices', who, { platformAccountId: noraAccount, folders: [], media: [], ...body });

    expect((await change('owner', { folders: [{ folderRef: 'folder_a', imported: true }] })).statusCode).toBe(
      200,
    );
    expect(await imported()).toEqual({ a1: true, a2: true, a3: true, b1: false, r1: false });
    // A media unticked in a ticked folder, and one ticked alone at the root.
    const set = await change('owner', {
      media: [
        { platformMediaId: 'a2', imported: false },
        { platformMediaId: 'r1', imported: true },
        // Not in her vault: writes nothing.
        { platformMediaId: 'inconnu', imported: true },
      ],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(await imported()).toEqual({ a1: true, a2: false, a3: true, b1: false, r1: true });
    // The folder ticked again whole: a2 follows it.
    await change('owner', { folders: [{ folderRef: 'folder_a', imported: true }] });
    expect(await imported()).toMatchObject({ a2: true });
    expect((await view()).folders).toEqual([
      { platformAccountId: noraAccount, folderRef: 'folder_a', imported: true },
    ]);
    const count = await test.admin.db
      .select({ id: schema.vaultImportChoices.id })
      .from(schema.vaultImportChoices)
      .where(eq(schema.vaultImportChoices.creatorId, nora));
    expect(count).toHaveLength(2);

    // Never a manager, even of her list; never another creator's account; an empty change stops at the schema.
    expect(
      (await change('manager', { folders: [{ folderRef: 'folder_b', imported: true }] })).statusCode,
    ).toBe(403);
    const other = await call('PUT', '/choices', 'owner', {
      platformAccountId: inesAccount,
      folders: [{ folderRef: 'folder_i', imported: true }],
      media: [],
    });
    expect(other.statusCode).toBe(404);
    expect((await change('owner', {})).statusCode).toBe(400);
    expect(await imported()).toEqual({ a1: true, a2: true, a3: true, b1: false, r1: true });
  });

  it('describes nothing before the count and the cost are confirmed, each media once, under one key', async () => {
    const estimate = await describeAsk(['a1', 'a2', 'a3', 'b1', 'a1', 'inconnu'], null);
    expect(estimate.statusCode, estimate.body).toBe(200);
    const shown = VaultDescribeAnswerSchema.parse(estimate.json());
    expect(shown).toMatchObject({
      status: 'estimate',
      count: 2,
      photos: 1,
      videos: 1,
      alreadyDescribed: 0,
      alreadyAsked: 0,
      notImported: 1,
      notDescribable: 2,
      costCents: 2,
    });
    if (shown.status !== 'estimate') throw new Error('estimate');
    expect(shown.capLeftCents).toBeGreaterThan(0);
    expect(await queued()).toEqual([]);

    // A confirmation of another count asks nothing: the new estimate comes back.
    const moved = await describeAsk(['a1', 'a2'], { count: 1, costCents: 1 });
    expect(VaultDescribeAnswerSchema.parse(moved.json())).toMatchObject({ status: 'estimate', count: 2 });
    expect(await queued()).toEqual([]);

    const key = crypto.randomUUID();
    const asked = await describeAsk(['a1', 'a2'], { count: 2, costCents: 2 }, key);
    expect(VaultDescribeAnswerSchema.parse(asked.json())).toEqual({ status: 'asked', count: 2 });
    expect(await queued()).toEqual([{ key: vaultDescribeJobKey(noraAccount) }]);
    // The same gesture again answers what it asked; asked again under a new key, nothing is counted twice.
    expect((await describeAsk(['a1', 'a2'], { count: 2, costCents: 2 }, key)).json()).toEqual({
      status: 'asked',
      count: 2,
    });
    expect(VaultDescribeAnswerSchema.parse((await describeAsk(['a1', 'a2'], null)).json())).toMatchObject({
      status: 'estimate',
      count: 0,
      alreadyAsked: 2,
      costCents: 0,
    });
    expect(
      Object.fromEntries((await view()).media.map((media) => [media.platformMediaId, media.description])),
    ).toMatchObject({ a1: 'asked', a2: 'asked', b1: 'none' });

    // Never a manager, nor another creator's account.
    const manager = await call('POST', '/describe', 'manager', {
      platformAccountId: noraAccount,
      platformMediaIds: ['b1'],
      confirm: null,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(manager.statusCode).toBe(403);
    const other = await call('POST', '/describe', 'owner', {
      platformAccountId: inesAccount,
      platformMediaIds: ['i1'],
      confirm: null,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(other.statusCode).toBe(404);
    const requests = await test.admin.db.select().from(schema.vaultDescribeRequests);
    expect(requests.map((row) => row.platformMediaId).sort()).toEqual(['a1', 'a2']);
    expect(requests.every((row) => row.askedBy === ids.owner && row.askedKey === key)).toBe(true);
  });

  it('says a media described, with the beginning of its description, and counts it no more', async () => {
    const asset = newId(MediaAssetIdSchema);
    await test.admin.db.insert(schema.mediaAssets).values({
      id: asset,
      creatorId: nora,
      kind: 'image',
      origin: 'vault',
      storageKey: '',
      mime: 'image/jpeg',
      bytes: 1000,
      sha256: asset,
      erasedAt: new Date(),
    });
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: newId(z.uuid()),
      creatorId: nora,
      mediaAssetId: asset,
      vocabularyVersion: '1',
      content: { detailed: 'Une photo inventée dans un salon inventé, lumière douce.' },
      model: 'test',
      promptHash: 'test',
    });
    await test.admin.db.execute(
      sql`update media_platform_refs set media_asset_id = ${asset} where platform_account_id = ${noraAccount} and platform_media_id = 'b1'`,
    );
    const b1 = (await view()).media.find((media) => media.platformMediaId === 'b1');
    expect(b1).toMatchObject({
      description: 'described',
      excerpt: 'Une photo inventée dans un salon inventé, lumière douce.',
    });
    expect(VaultDescribeAnswerSchema.parse((await describeAsk(['b1'], null)).json())).toMatchObject({
      count: 0,
      alreadyDescribed: 1,
    });

    // Validated from its sheet (REV-02), once: a second click is no error, an id no longer its latest is refused.
    expect(b1?.validated).toBe(false);
    const descriptionId = b1?.descriptionId;
    if (descriptionId == null) throw new Error('b1 has its description');
    const review = { kind: 'validate', platformAccountId: noraAccount, descriptionId };
    const validated = await call('POST', '/media/b1/description', 'owner', review);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(
      VaultChoicesViewSchema.parse(validated.json()).media.find((media) => media.platformMediaId === 'b1'),
    ).toMatchObject({ validated: true, descriptionId });
    expect((await call('POST', '/media/b1/description', 'owner', review)).statusCode).toBe(200);
    const stale = await call('POST', '/media/b1/description', 'owner', {
      ...review,
      descriptionId: crypto.randomUUID(),
    });
    expect(stale.statusCode).toBe(409);
    const trail = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(sql`action = 'media_description.validated'`);
    expect(trail).toHaveLength(1);
  });
});
