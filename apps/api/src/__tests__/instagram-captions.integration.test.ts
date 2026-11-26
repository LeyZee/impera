import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  CreatorDecisionsSchema,
  CreatorIdSchema,
  err,
  JOB_PAYLOADS,
  MediaAssetIdSchema,
  newId,
  ok,
  type CaptionProposals,
  type CreatorId,
  type DropMediaDescription,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { CaptionProposalsInput, LlmGateway } from '@impera/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const NOW = new Date('2026-11-21T10:00:00Z');

const DESCRIBED: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'video',
  detailed: 'Elle marche sur une plage au lever du soleil, un café à la main.',
  factualDescription: 'Une marche sur une plage.',
  durationS: 12.4,
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

const THREE: CaptionProposals = {
  captions: [
    { style: 'question', text: 'Team lever de soleil ou team grasse mat ?' },
    { style: 'teasing', text: 'Devine où je me suis réveillée ce matin' },
    { style: 'funny', text: 'Mon café a refroidi trois fois pendant ce Reel' },
  ],
};

/**
 * The captions proposed for a Reel she dropped (ADR 0164 § 9) through the real app: a medium described, the job, the
 * decision she reads and answers. A fake voice, invented people and videos only (ADR 0010).
 */
describe('the captions proposed for her Reels (ADR 0164 § 9)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let noraUser = '';
  let cookie = '';
  const seen: CaptionProposalsInput[] = [];
  const voice = { budget: false };
  const captionVoice: Pick<LlmGateway, 'proposeCaptions'> = {
    proposeCaptions: (input) => {
      seen.push(input);
      if (voice.budget) return Promise.resolve(err({ code: 'budget_reached', attempts: [] }));
      return Promise.resolve(
        ok({
          output: THREE,
          meta: { provider: 'xai', model: 'voice-test', isFallback: false, latencyMs: 1, promptHash: 'c-v1' },
        }),
      );
    },
  };

  /** A drop of hers with one video kept and described, as the receiving and describing jobs leave it. */
  async function drop(category: string, state = 'ready'): Promise<{ dropId: string; mediaAssetId: string }> {
    const mediaAssetId = newId(MediaAssetIdSchema);
    const dropId = newId(ContentDropIdSchema);
    await test.admin.db.insert(schema.mediaAssets).values({
      id: mediaAssetId,
      creatorId: nora,
      kind: 'video',
      origin: 'creator',
      storageKey: `test/${mediaAssetId}`,
      mime: 'video/mp4',
      bytes: 1000,
      durationMs: 12_400,
      sha256: mediaAssetId,
    });
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: newId(z.uuid()),
      creatorId: nora,
      mediaAssetId,
      vocabularyVersion: DESCRIBED.vocabularyVersion,
      content: DESCRIBED,
      model: 'test',
      promptHash: 'test',
    });
    await test.admin.db.insert(schema.contentDrops).values({
      id: dropId,
      creatorId: nora,
      category,
      state,
      sentence: 'Tournée ce matin',
      createdBy: noraUser,
      ...(state === 'withdrawn' && { withdrawnBy: noraUser, withdrawnAt: NOW }),
    });
    await test.admin.db.insert(schema.contentDropFiles).values({
      id: newId(ContentDropFileIdSchema),
      creatorId: nora,
      dropId,
      position: 0,
      kind: 'video',
      mime: 'video/mp4',
      bytes: 1000,
      state: 'kept',
      mediaAssetId,
    });
    return { dropId, mediaAssetId };
  }
  const propose = (mediaAssetId: string) =>
    app.modules.instagramCaptions.jobs.propose(nora, mediaAssetId, 'test');
  const hers = async () =>
    CreatorDecisionsSchema.parse(
      (
        await server.inject({
          method: 'GET',
          url: '/v1/creator-space/decisions',
          headers: { cookie, origin: DASHBOARD_ORIGIN },
        })
      ).json(),
    ).decisions;
  const waiting = async (mediaAssetId: string) =>
    z.array(z.object({ payload: JOB_PAYLOADS['instagram_captions.propose'], run_at: z.coerce.date() })).parse(
      (
        await test.admin.db.execute(sql`
            select j.payload, j.run_at from graphile_worker._private_jobs j
              join graphile_worker._private_tasks t on t.id = j.task_id
             where t.identifier = 'instagram_captions.propose'
               and j.key = ${`instagram_captions.propose:${mediaAssetId}`}`)
      ).rows,
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    const logger = createLogger(config);
    app = await createApp(config, logger, { decisionsClock: () => NOW, captionVoice });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    nora = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    const her = await createOwner(app.auth, app.db.db, {
      email: 'nora@example.test',
      name: 'Nora',
      password: PASSWORD,
    });
    noraUser = her.userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [nora] })
      .where(eq(schema.user.id, noraUser));
    cookie = await signIn(server, 'nora@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('writes nothing in her name while she has no active persona', async () => {
    const { mediaAssetId } = await drop('instagram_reel');
    expect(await propose(mediaAssetId)).toBe('off');
    expect(seen).toHaveLength(0);
    await activateDemoPersona(app, nora);
  });

  it('asks her three captions for a Reel described, once, from the video and her sentence; she answers', async () => {
    const { mediaAssetId, dropId } = await drop('instagram_reel');

    expect(await propose(mediaAssetId)).toEqual({ asked: 1, already: 0, refused: 0 });
    expect(await propose(mediaAssetId)).toEqual({ asked: 0, already: 1, refused: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      mediaDescription: 'Elle marche sur une plage au lever du soleil, un café à la main.',
      sentence: 'Tournée ce matin',
      durationS: 12.4,
      examples: [],
      trace: { creatorId: nora },
    });
    const [decision] = await hers();
    expect(decision).toMatchObject({
      kind: 'caption',
      layout: 'rows',
      category: 'socials',
      otherIdeasLeft: 3,
    });
    expect(decision?.answers.map((answer) => answer.text)).toEqual(THREE.captions.map((one) => one.text));
    const answered = await server.inject({
      method: 'POST',
      url: `/v1/creator-space/decisions/${decision?.id ?? ''}/answer`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { answer: 'teasing' },
    });
    expect(answered.statusCode).toBe(200);
    expect(await app.modules.creatorDecisions.asking.read(nora, 'caption', `drop:${dropId}`, NOW)).toEqual({
      state: 'answered',
      answerKey: 'teasing',
    });
  });

  it('proposes nothing for a photo, a drop withdrawn, nor a medium of another creator', async () => {
    const before = seen.length;
    expect(await propose((await drop('instagram_post')).mediaAssetId)).toBe('nothing');
    expect(await propose((await drop('instagram_reel', 'withdrawn')).mediaAssetId)).toBe('nothing');
    const { mediaAssetId } = await drop('instagram_reel');
    expect(
      await app.modules.instagramCaptions.jobs.propose(newId(CreatorIdSchema), mediaAssetId, 'test'),
    ).toBe('nothing');
    expect(seen).toHaveLength(before);
  });

  it('is asked for once per medium described, and comes back in an hour when the day’s budget is spent', async () => {
    const { mediaAssetId } = await drop('instagram_reel');
    await app.modules.instagramCaptions.described(nora, mediaAssetId, 'test');
    await app.modules.instagramCaptions.described(nora, mediaAssetId, 'test');
    expect(await waiting(mediaAssetId)).toMatchObject([{ payload: { creatorId: nora, mediaAssetId } }]);

    voice.budget = true;
    expect(await propose(mediaAssetId)).toBe('budget');
    voice.budget = false;
    const [job] = await waiting(mediaAssetId);
    expect(job?.run_at.toISOString()).toBe('2026-11-21T11:00:00.000Z');
  });
});
