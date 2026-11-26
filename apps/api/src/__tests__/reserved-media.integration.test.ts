import { randomUUID } from 'node:crypto';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  MEDIA_VOCABULARY_VERSION,
  newId,
  PlatformAccountIdSchema,
  type ConversationId,
  type CreatorId,
  type DropCategory,
  type DropMediaDescription,
  type DropMediaKind,
  type FanId,
  type ReservedMediaAsk,
} from '@impera/contracts';
import { schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDrizzleReservedMedia } from '../modules/content-drops/infra/db/reserved-media';

/** An invented description; `validated` when a person of the agency looked at it. */
const described = (
  kind: DropMediaKind,
  intensity: DropMediaDescription['intensity'],
): DropMediaDescription => ({
  vocabularyVersion: MEDIA_VOCABULARY_VERSION,
  kind,
  detailed: 'Média inventé pour le test.',
  factualDescription: 'Média inventé.',
  durationS: kind === 'audio' ? 8 : null,
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

type Shown = { readonly intensity: DropMediaDescription['intensity']; readonly validated: boolean } | null;

/**
 * What the AI sends from her coffre (ADR 0163 § 7): a voice once per fan, a gift never twice the same nor unproven,
 * only what the agency validated, the send noted once. As the agent calls it, through the module's door. Invented data only.
 */
describe('pickReservedMedia and recordReservedMediaSent', () => {
  let test: TestDb;
  let nora: CreatorId;
  let ines: CreatorId;
  let reviewer: string;
  const fans: Record<'basile' | 'theo', { fanId: FanId; conversationId: ConversationId }> = {
    basile: { fanId: newId(FanIdSchema), conversationId: newId(ConversationIdSchema) },
    theo: { fanId: newId(FanIdSchema), conversationId: newId(ConversationIdSchema) },
  };

  /** A drop of hers in that category, each file a medium with what its description shows. Its media, in order. */
  async function drop(
    creatorId: CreatorId,
    category: DropCategory,
    kind: DropMediaKind,
    files: readonly Shown[],
  ) {
    const dropId = newId(ContentDropIdSchema);
    const media: string[] = [];
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.contentDrops)
        .values({ id: dropId, creatorId, category, state: 'ready', createdBy: reviewer });
      for (const [position, shown] of files.entries()) {
        const mediaAssetId = randomUUID();
        const mime = kind === 'audio' ? 'audio/mpeg' : 'image/jpeg';
        await tx.insert(schema.mediaAssets).values({
          id: mediaAssetId,
          creatorId,
          kind,
          origin: 'creator',
          storageKey: `creators/${creatorId}/${mediaAssetId}`,
          mime,
          bytes: 1000,
          sha256: mediaAssetId.replace(/-/gu, '').padEnd(64, '0'),
        });
        await tx.insert(schema.contentDropFiles).values({
          id: newId(ContentDropFileIdSchema),
          creatorId,
          dropId,
          position,
          kind,
          mime,
          bytes: 1000,
          state: 'kept',
          mediaAssetId,
        });
        media.push(mediaAssetId);
        if (shown === null) continue;
        await tx.insert(schema.mediaDescriptions).values({
          id: randomUUID(),
          creatorId,
          mediaAssetId,
          vocabularyVersion: MEDIA_VOCABULARY_VERSION,
          content: described(kind, shown.intensity),
          model: 'vision-test',
          promptHash: 'drop-v2',
          author: 'sense',
          reviewReasons: [],
          ...(shown.validated ? { validatedBy: reviewer, validatedAt: new Date() } : {}),
        });
      }
    });
    return media;
  }

  const pick = (ask: ReservedMediaAsk) => createDrizzleReservedMedia(test.app.db).pick(ask);
  const sent = (mediaAssetId: string, who: keyof typeof fans, creatorId: CreatorId = nora) =>
    createDrizzleReservedMedia(test.app.db).noteSent({
      creatorId,
      mediaAssetId,
      ...fans[who],
      messageId: null,
      sentAt: new Date(),
    });

  let beeps: string[];
  let proofs: string[];
  let gifts: string[];
  let feed: string[];
  let inesBeep: string[];

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    reviewer = randomUUID();
    const accountId = newId(PlatformAccountIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.user)
        .values({ id: reviewer, name: 'Relecteur', email: 'relecteur@example.test' });
      for (const [id, name] of [
        [nora, 'Nora'],
        [ines, 'Ines'],
      ] as const)
        await tx
          .insert(schema.creators)
          .values({ id, displayName: name, nameKey: name.toLowerCase(), timezone: 'Europe/Paris' });
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: nora, platform: 'reveal', handle: 'nora-demo' });
      for (const [name, one] of Object.entries(fans)) {
        await tx.insert(schema.fans).values({
          id: one.fanId,
          creatorId: nora,
          platformAccountId: accountId,
          platformFanId: `fan-${name}`,
          displayName: name,
        });
        await tx.insert(schema.conversations).values({
          id: one.conversationId,
          creatorId: nora,
          platformAccountId: accountId,
          fanId: one.fanId,
          platformConversationId: `conv-${name}`,
        });
      }
    });
    // Nora: two beeps validated; a proof waiting for the agency, then one validated; three gifts, one soft, one too
    // explicit, one not described; a feed photo, never the AI's. Ines: a beep of her own.
    beeps = await drop(nora, 'voice_beep', 'audio', [
      { intensity: 'soft', validated: true },
      { intensity: 'soft', validated: true },
    ]);
    proofs = await drop(nora, 'voice_real', 'audio', [
      { intensity: 'soft', validated: false },
      { intensity: 'soft', validated: true },
    ]);
    gifts = await drop(nora, 'whale_gift', 'image', [
      { intensity: 'soft', validated: true },
      { intensity: 'explicit', validated: true },
      null,
    ]);
    feed = await drop(nora, 'feed_shoot', 'image', [{ intensity: 'soft', validated: true }]);
    inesBeep = await drop(ines, 'voice_beep', 'audio', [{ intensity: 'soft', validated: true }]);
  });

  afterAll(async () => {
    await test.close();
  });

  it('gives a voice once to a fan, whichever of its files, and the next fan still gets it', async () => {
    const basile = { creatorId: nora, category: 'voice_beep', fanId: fans.basile.fanId } as const;
    expect(await pick(basile)).toEqual({ mediaAssetId: beeps[0], kind: 'audio' });
    expect(await sent(beeps[0] ?? '', 'basile')).toBe(true);
    // Replayed: nothing written twice.
    expect(await sent(beeps[0] ?? '', 'basile')).toBe(false);
    expect(await pick(basile)).toBeNull();
    expect(await pick({ ...basile, fanId: fans.theo.fanId })).toEqual({
      mediaAssetId: beeps[0],
      kind: 'audio',
    });
  });

  it('sends only what the agency validated', async () => {
    expect(await pick({ creatorId: nora, category: 'voice_real', fanId: fans.basile.fanId })).toEqual({
      mediaAssetId: proofs[1],
      kind: 'audio',
    });
  });

  it('gives a gift proven not nude, never the same twice, and none once they are all given', async () => {
    const basile = { creatorId: nora, category: 'whale_gift', fanId: fans.basile.fanId } as const;
    expect(await pick(basile)).toEqual({ mediaAssetId: gifts[0], kind: 'image' });
    expect(await sent(gifts[0] ?? '', 'basile')).toBe(true);
    // The explicit one and the undescribed one never go.
    expect(await pick(basile)).toBeNull();
  });

  it('notes nothing for a medium the AI does not send, nor for another creator’s', async () => {
    expect(await sent(feed[0] ?? '', 'theo')).toBe(false);
    expect(await sent(inesBeep[0] ?? '', 'theo')).toBe(false);
    // Under Ines's tenant, Nora's media are not there to pick.
    expect(await pick({ creatorId: ines, category: 'voice_beep', fanId: fans.theo.fanId })).toEqual({
      mediaAssetId: inesBeep[0],
      kind: 'audio',
    });
  });
});
