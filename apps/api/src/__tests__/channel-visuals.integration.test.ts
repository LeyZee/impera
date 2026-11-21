import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
} from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import type { DropStorage } from '../modules/content-drops';
import { handDescription } from '../modules/content-drops/domain/describe';
import { createChannelVisualsReader } from '../modules/content-drops/infra/db/channel-visuals';

/**
 * Her channel's visuals (ADR 0162 § 5.2), read by the Telegram jobs under the app role, in her creator only
 * (`withTenantJob`, job `telegram_channel`): public, described and validated, live; never another creator's.
 */
describe('her channel’s visuals on Postgres', () => {
  let test: TestDb;
  let dir: string;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const photo = { kind: 'image' as const, durationMs: null };
  const assets = {
    stock: newId(MediaAssetIdSchema),
    explicit: newId(MediaAssetIdSchema),
    unvalidated: newId(MediaAssetIdSchema),
    withdrawn: newId(MediaAssetIdSchema),
    massDm: newId(MediaAssetIdSchema),
  };
  const downloads: string[] = [];
  let source = '';
  const storage: Pick<DropStorage, 'download'> = {
    async download(key, path) {
      downloads.push(key);
      await copyFile(source, path);
      return true;
    },
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    dir = await mkdtemp(join(tmpdir(), 'impera-visuals-test-'));
    source = join(dir, 'source');
    await writeFile(source, new Uint8Array([1, 2, 3]));
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: ines, nameKey: ines, displayName: 'Ines', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.user)
      .values({ id: 'owner-visuals', name: 'Owner', email: 'owner@example.test', emailVerified: true });
    const drop = async (
      category: 'telegram_post' | 'mass_dm',
      state: 'ready' | 'withdrawn',
      files: readonly { asset: string; text: string; level: 'soft' | 'explicit'; validated: boolean }[],
    ) => {
      const dropId = newId(ContentDropIdSchema);
      await test.admin.db.insert(schema.contentDrops).values({
        id: dropId,
        creatorId: nora,
        category,
        state,
        createdBy: 'owner-visuals',
        ...(state === 'withdrawn' && { withdrawnBy: 'owner-visuals', withdrawnAt: new Date() }),
      });
      for (const [position, file] of files.entries()) {
        await test.admin.db.insert(schema.mediaAssets).values({
          id: file.asset,
          creatorId: nora,
          kind: 'image',
          origin: 'creator',
          storageKey: `media/${nora}/${file.asset}`,
          mime: 'image/jpeg',
          bytes: 3,
          sha256: file.asset.replaceAll('-', '').padEnd(64, '0'),
        });
        await test.admin.db.insert(schema.contentDropFiles).values({
          id: newId(ContentDropFileIdSchema),
          creatorId: nora,
          dropId,
          position,
          kind: 'image',
          mime: 'image/jpeg',
          bytes: 3,
          state: 'kept',
          mediaAssetId: file.asset,
        });
        await test.admin.db.insert(schema.mediaDescriptions).values({
          id: newId(z.uuid()),
          creatorId: nora,
          mediaAssetId: file.asset,
          vocabularyVersion: '1.0.0',
          content: handDescription(photo, file.text, file.level),
          model: 'test',
          promptHash: 'test',
          ...(file.validated && { validatedBy: 'owner-visuals', validatedAt: new Date() }),
        });
      }
    };
    await drop('telegram_post', 'ready', [
      { asset: assets.stock, text: 'Elle sourit en robe rouge.', level: 'soft', validated: true },
      { asset: assets.explicit, text: 'Elle sourit.', level: 'explicit', validated: true },
      { asset: assets.unvalidated, text: 'Elle rit.', level: 'soft', validated: false },
    ]);
    await drop('telegram_post', 'withdrawn', [
      { asset: assets.withdrawn, text: 'Elle lit.', level: 'soft', validated: true },
    ]);
    await drop('mass_dm', 'ready', [
      { asset: assets.massDm, text: 'Elle pose en lingerie noire.', level: 'soft', validated: true },
    ]);
  });

  afterAll(async () => {
    await test.close();
    await rm(dir, { recursive: true, force: true });
  });

  const reader = () => createChannelVisualsReader(test.app.db, storage, dir);

  it('lists her public, validated, live media only, and the Mass DM ones for the evening', async () => {
    expect(await reader().telegramStock(nora)).toEqual([
      { mediaId: assets.stock, kind: 'photo', description: 'Elle sourit en robe rouge.' },
    ]);
    expect((await reader().eveningCandidates(nora, '2026-11-23')).map((one) => one.mediaId)).toEqual([
      assets.stock,
      assets.massDm,
    ]);
  });

  it('reads nothing of hers under another creator', async () => {
    expect(await reader().telegramStock(ines)).toEqual([]);
    expect(await reader().file(ines, assets.stock)).toBe('gone');
  });

  it('fetches her file for the upload, and says when it is gone', async () => {
    const file = await reader().file(nora, assets.stock);
    expect(file).toMatchObject({ filename: 'photo.jpeg', mime: 'image/jpeg' });
    expect(file !== 'gone' && file !== 'too_big' && [...file.bytes]).toEqual([1, 2, 3]);
    expect(downloads).toEqual([`media/${nora}/${assets.stock}`]);
    expect(await reader().file(nora, newId(MediaAssetIdSchema))).toBe('gone');
  });
});
