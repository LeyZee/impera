import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema, sql, withTenant, withTenantJob, type Transaction } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createDrizzleDescriptionQueue } from '../modules/content-drops/infra/db/description-queue';
import { createDrizzleThumbnailQueue } from '../modules/content-drops/infra/db/thumbnail-queue';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

/**
 * SEC-16 (ADR 0087 lot c): the two jobs on a medium she dropped read and write in its creator, under the app role
 * (`withTenantJob(…, 'drop_media', …)`). The creator a job names is never taken on its word.
 */
describe('the jobs on a dropped medium, one creator at a time (SEC-16)', () => {
  let test: TestDb;
  let app: App;
  let nora: CreatorId;
  let ines: CreatorId;
  const mediaAssetId = newId(MediaAssetIdSchema);
  const dropId = newId(ContentDropIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config, new LogSink()));
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: 'correct horse battery',
    });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: ines, nameKey: 'ines', displayName: 'Ines', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db.insert(schema.mediaAssets).values({
      id: mediaAssetId,
      creatorId: nora,
      kind: 'image',
      origin: 'creator',
      storageKey: `media/${nora}/invented`,
      mime: 'image/jpeg',
      bytes: 1000,
      sha256: 'a'.repeat(64),
    });
    await test.admin.db.insert(schema.contentDrops).values({
      id: dropId,
      creatorId: nora,
      category: 'feed_shoot',
      createdBy: userId,
    });
    await test.admin.db.insert(schema.contentDropFiles).values({
      id: newId(ContentDropFileIdSchema),
      creatorId: nora,
      dropId,
      position: 0,
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 1000,
      state: 'kept',
      mediaAssetId,
    });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  const medium = async () => {
    const [row] = await test.admin.db
      .select({
        key: schema.mediaAssets.thumbnailKey,
        tried: schema.mediaAssets.thumbnailedAt,
        failures: schema.mediaAssets.descriptionFailures,
      })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, mediaAssetId));
    return row;
  };

  it('opens the drops of its creator to the job, to read only, and to nobody outside it', async () => {
    const files = (tx: Transaction) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from content_drop_files where media_asset_id = ${mediaAssetId}`,
      );
    expect((await withTenantJob(app.db.db, nora, 'drop_media', files)).rows[0]?.n).toBe(1);
    expect((await withTenantJob(app.db.db, ines, 'drop_media', files)).rows[0]?.n).toBe(0);
    // Neither the plain door of a creator nor another job's name reads them.
    expect((await withTenant(app.db.db, nora, files)).rows[0]?.n).toBe(0);
    expect((await withTenantJob(app.db.db, nora, 'daily_stats', files)).rows[0]?.n).toBe(0);
    // No policy lets the job change a drop.
    const changed = await withTenantJob(app.db.db, nora, 'drop_media', (tx) =>
      tx.execute(sql`update content_drops set category = category where id = ${dropId} returning id`),
    );
    expect(changed.rows).toHaveLength(0);
  });

  it('finds the medium to describe in its creator, and counts a failure there only', async () => {
    const queue = createDrizzleDescriptionQueue(app.db.db);
    expect(await queue.target(nora, mediaAssetId)).toMatchObject({
      creatorId: nora,
      kind: 'image',
      category: 'feed_shoot',
      erased: false,
      script: null,
    });
    expect(await queue.target(ines, mediaAssetId)).toBeNull();
    expect(await queue.failed(ines, mediaAssetId)).toBe(0);
    expect((await medium())?.failures).toBe(0);
    expect(await queue.failed(nora, mediaAssetId)).toBe(1);
    expect((await medium())?.failures).toBe(1);
  });

  it('finds the medium to picture in its creator, and marks it there only', async () => {
    const queue = createDrizzleThumbnailQueue(app.db.db, app.adminDb.db);
    const now = new Date('2026-11-20T20:00:00.000Z');
    expect(await queue.target(ines, mediaAssetId)).toBeNull();
    await queue.settle(ines, mediaAssetId, `thumbnails/${ines}/invented.jpg`, now);
    expect(await medium()).toMatchObject({ key: null, tried: null });
    expect(await queue.target(nora, mediaAssetId)).toMatchObject({ creatorId: nora, tried: false });
    await queue.settle(nora, mediaAssetId, `thumbnails/${nora}/invented.jpg`, now);
    expect(await medium()).toMatchObject({ key: `thumbnails/${nora}/invented.jpg`, tried: now });
    expect(await queue.target(nora, mediaAssetId)).toMatchObject({ tried: true });
  });

  it('puts a job off under its key, from the door of its creator', async () => {
    const queue = createDrizzleThumbnailQueue(app.db.db, app.adminDb.db);
    await queue.later(nora, mediaAssetId, 'test', new Date('2030-01-01T00:00:00.000Z'));
    await createDrizzleDescriptionQueue(app.db.db).later(
      nora,
      mediaAssetId,
      'test',
      new Date('2030-01-01T00:00:00.000Z'),
    );
    const queued = await test.admin.db.execute<{ key: string }>(sql`
      select j.key from graphile_worker._private_jobs j order by j.key`);
    expect(queued.rows.map((row) => row.key)).toEqual([
      `content_drops.describe_file:${mediaAssetId}`,
      `content_drops.make_thumbnail:${mediaAssetId}`,
    ]);
  });
});
