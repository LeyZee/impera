import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  DomainError,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors } from '../modules/connectors';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const PASSWORD = 'correct horse battery';

/**
 * The vault's sync (fiche vault-sync, ADR 0099 § 2 to 4) on FakeReveal's invented vault, through the real connector and
 * the real tables: folders and media mirrored in the platform's order, a second sync writing only the account's sync time, a media removed
 * kept, a media moved changing folder, an archived creator not read, and her rows out of another tenant's reach.
 */
describe('vault sync on FakeReveal (fiche vault-sync)', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let logger: ReturnType<typeof createLogger>;
  let now: Date;
  const users = new Map<'owner' | 'manager' | 'outsider' | 'chatter', string>();
  const user = (key: Parameters<typeof users.get>[0]): string => {
    const id = users.get(key);
    if (id === undefined) throw new Error(`no ${key}`);
    return id;
  };
  const codeOf = async (promise: Promise<unknown>): Promise<string | null> =>
    promise.then(
      () => null,
      (error: unknown) => (error instanceof DomainError ? error.code : 'not a domain error'),
    );

  const sync = () =>
    app.modules.connectors.jobs.vaultSync(
      { creatorId, platformAccountId: accountId, correlationId: 'test' },
      logger,
    );
  const view = () => app.modules.connectors.vault.view(creatorId, user('owner'));
  const folderOf = async (folderRef: string | null) =>
    (await view()).folders.find((folder) => folder.folderRef === folderRef);
  const syncTimes = async () =>
    z
      .array(z.object({ id: z.string(), t: z.string() }))
      .parse(
        (
          await test.admin.db.execute(
            sql`select platform_media_id as id, last_synced_at::text as t from media_platform_refs order by 1`,
          )
        ).rows,
      );

  async function person(key: 'manager' | 'outsider' | 'chatter', creators: readonly CreatorId[]) {
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: `${key}@example.test`,
      name: key,
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [...creators] })
      .where(eq(schema.user.id, userId));
    users.set(key, userId);
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole: key === 'chatter' ? 'chatter' : 'manager',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: key,
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: '2026-10-01',
    });
  }

  beforeAll(async () => {
    fake = createFakeReveal();
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    logger = createLogger(config);
    now = new Date(fake.state().now);
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorsClock: () => now,
      connectorRegistry: {
        reveal: revealApiConnectors({ fetch: fake.fetch, baseUrl: 'https://reveal.test' }),
      },
    });
    creatorId = newId(CreatorIdSchema);
    const otherCreator = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: otherCreator, nameKey: 'lea', displayName: 'Léa', timezone: 'Europe/Paris' },
    ]);
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'creatrice_test',
      sessionState: 'none',
    });
    await app.modules.connectors.sessions.store({
      platformAccountId: accountId,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
    const { userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    users.set('owner', ownerId);
    await person('manager', [creatorId]);
    await person('outsider', [otherCreator]);
    await person('chatter', [creatorId]);

    // The first folder over two pages (Reveal's pages are of 10): nine newer uploads, then two of the very same time
    // across the page boundary (ranks 9 and 10), then the fixture's five. Invented ids and texts (ADR 0010).
    const media = fake.state().media;
    for (let k = 0; k < 9; k++) {
      media.push({
        id: `vault_new_${String(k)}`,
        type: 'photo',
        folderId: 'folder_1',
        fromFanId: null,
        durationSeconds: null,
        createdAt: `2027-01-01T00:01:0${String(k)}.000Z`,
      });
    }
    for (const id of ['vault_tie_a', 'vault_tie_b']) {
      media.push({
        id,
        type: 'video',
        folderId: 'folder_1',
        fromFanId: null,
        durationSeconds: 12,
        createdAt: '2027-01-01T00:00:30.000Z',
        description: 'Texte inventé du coffre',
        suggestedMinPrice: 1_000,
        suggestedMaxPrice: 2_000,
      });
    }
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  const FOLDER_1 = [
    'vault_new_8',
    'vault_new_7',
    'vault_new_6',
    'vault_new_5',
    'vault_new_4',
    'vault_new_3',
    'vault_new_2',
    'vault_new_1',
    'vault_new_0',
    'vault_tie_a',
    'vault_tie_b',
    'media_05',
    'media_04',
    'media_03',
    'media_02',
    'media_01',
  ];

  it('mirrors the folders and the media in Reveal’s order, after one sync and after two', async () => {
    await sync();
    const first = await folderOf('folder_1');
    expect(first?.media.map((m) => m.platformMediaId)).toEqual(FOLDER_1);
    expect(first).toMatchObject({ folderName: 'SCRIPT 1 | ☀️', moment: 'day', platform: 'reveal' });
    expect(first?.media.find((m) => m.platformMediaId === 'vault_tie_a')).toEqual({
      platformMediaId: 'vault_tie_a',
      kind: 'video',
      durationSeconds: 12,
      uploadedAt: '2027-01-01T00:00:30.000Z',
      platformDescription: 'Texte inventé du coffre',
      suggestedPriceMinor: { min: 1_000, max: 2_000 },
      removed: false,
    });
    expect((await view()).folders.map((f) => f.folderRef)).toEqual(['folder_1', 'folder_2', 'folder_3']);
    // No address of a file, ever.
    expect(JSON.stringify(await view())).not.toMatch(/https?:/u);

    const firstSync = (await view()).syncedAt;
    expect(firstSync).toBe(now.toISOString());
    const before = await syncTimes();
    now = new Date(now.getTime() + 60_000);
    await sync();
    expect((await folderOf('folder_1'))?.media.map((m) => m.platformMediaId)).toEqual(FOLDER_1);
    // Nothing moved: no media row written, only the account's sync time, which the view shows.
    expect(await syncTimes()).toEqual(before);
    expect((await view()).syncedAt).toBe(now.toISOString());
    expect((await view()).syncedAt).not.toBe(firstSync);
  });

  it('keeps a media Reveal no longer lists, and moves one that changed folder', async () => {
    const media = fake.state().media;
    const gone = media.findIndex((m) => m.id === 'media_02');
    media.splice(gone, 1);
    const moved = media.find((m) => m.id === 'media_04');
    if (moved === undefined) throw new Error('fixture changed');
    moved.folderId = 'folder_2';
    await sync();
    const folder1 = await folderOf('folder_1');
    expect(folder1?.media.find((m) => m.platformMediaId === 'media_02')?.removed).toBe(true);
    expect(folder1?.media.some((m) => m.platformMediaId === 'media_04')).toBe(false);
    expect((await folderOf('folder_2'))?.media.find((m) => m.platformMediaId === 'media_04')?.removed).toBe(
      false,
    );
  });

  it('reads the vault for the owner and an active manager of her list only', async () => {
    expect((await app.modules.connectors.vault.view(creatorId, user('manager'))).folders.length).toBe(3);
    for (const who of ['outsider', 'chatter'] as const) {
      expect(await codeOf(app.modules.connectors.vault.view(creatorId, user(who)))).toBe('vault_forbidden');
    }
    // Another tenant reads none of her rows.
    const other = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: other, nameKey: 'autre', displayName: 'Autre', timezone: 'Europe/Paris' });
    const seen = await withTenant(app.db.db, other, (tx) => tx.select().from(schema.mediaPlatformRefs));
    expect(seen).toEqual([]);
  });

  it('gives another module the account’s scripts through the connector, and refuses an unknown account', async () => {
    const scripts = await app.modules.connectors.platformReads.scripts(accountId);
    expect(scripts.length).toBeGreaterThan(0);
    expect(await codeOf(app.modules.connectors.platformReads.scripts(newId(PlatformAccountIdSchema)))).toBe(
      'platform_account_not_found',
    );
  });

  it('reads nothing of an archived creator', async () => {
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, creatorId));
    fake.state().media.push({
      id: 'vault_after_archive',
      type: 'photo',
      folderId: 'folder_3',
      fromFanId: null,
      durationSeconds: null,
      createdAt: '2027-02-01T00:00:00.000Z',
    });
    const before = await syncTimes();
    await sync();
    expect(await syncTimes()).toEqual(before);
  });
});
