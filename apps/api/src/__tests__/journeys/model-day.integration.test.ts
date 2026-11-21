import {
  AgencyCreatorWeekSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  CreatorAgendaSchema,
  CreatorContentSchema,
  CreatorIdSchema,
  CreatorTaskIdSchema,
  CreatorTicksResultSchema,
  CreatorWeekSchema,
  DropDescriptionsReviewSchema,
  HerDaySchema,
  newId,
  ok,
  type CreatorId,
  type DropMediaDescription,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway } from '@impera/llm';
import { runOnce } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../../auth';
import { createApp, type App } from '../../composition-root';
import { createLogger } from '../../logger';
import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../../modules/scheduling/pure';
import { buildServer, type Server } from '../../server';
import { testConfig } from '../support/config';
import { jpegOf, sendWhole, startMediaStore, type MediaStore } from '../support/media-store';
import { DASHBOARD_ORIGIN, signIn } from '../support/sign-in';

const PASSWORD = 'une phrase de passe assez longue';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

/** Invented (ADR 0010): what the stub vision says of her photo, alone in it. */
const DESCRIBED: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  detailed: 'Photo inventée : une silhouette seule près d’une fenêtre, lumière douce.',
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
const shown: string[] = [];
const dropVision: Pick<LlmGateway, 'describeDrop' | 'transcribe' | 'promptHashes'> = {
  promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1', scriptIdentity: 'identity-v1' },
  describeDrop: (input) => {
    shown.push(input.media.kind);
    return Promise.resolve(
      ok({
        output: DESCRIBED,
        meta: {
          provider: 'google',
          model: 'vision-test',
          isFallback: false,
          latencyMs: 1,
          promptHash: 'drop-v1',
        },
      }),
    );
  },
  transcribe: () => Promise.reject(new Error('a photo has no sound')),
};

/**
 * The model's whole journey in one agency (recette créatrice): invited by the owner, she signs in, reads her day and
 * ticks it, adds and ticks a task, drops a photo through the real upload path (signed address, object store, receipt
 * job), the stub vision describes it, the owner sees it with its description, she withdraws it, and she accepts the
 * shooting week the owner validated. Another creator of the same agency sees none of it. Invented data only (ADR 0010).
 */
describe('a model’s day, from her invitation to her accepted week', () => {
  let store: MediaStore;
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'owner' | 'nora' | 'ines', string> = { owner: '', nora: '', ines: '' };

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
  const run = (task: 'content_drops.receive_file' | 'content_drops.describe_file') =>
    runOnce({ pgPool: test.admin.pool, taskList: { [task]: app.tasks[task] } });

  /** The owner's invitation link, opened and her password chosen, then her first sign-in (CR-02). */
  async function invite(creatorId: CreatorId, email: string): Promise<string> {
    const made = await call('POST', `/v1/creators/${creatorId}/invitation-link`, 'owner', {
      purpose: 'invitation',
      email,
    });
    expect(made.statusCode, made.body).toBe(200);
    const token = new URL(made.json<{ url: string }>().url).hash.slice('#t='.length);
    const redeemed = await server.inject({
      method: 'POST',
      url: '/v1/invitation-links/redeem',
      payload: { token, password: PASSWORD },
      headers: { origin: DASHBOARD_ORIGIN },
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    return signIn(server, email, PASSWORD);
  }

  beforeAll(async () => {
    store = await startMediaStore();
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      ...store.config,
    });
    // The breach check never leaves the machine (ADR 0046 § 4).
    app = await createApp(config, createLogger(config), {
      dropVision,
      passwordBreaches: () => Promise.resolve(false),
    });
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
      email: 'owner@recette.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@recette.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
    await store.stop();
  });

  it('walks her from the invitation to her accepted week, and shows nothing of it to another creator', async () => {
    // 1. Invited by the owner, she signs in: her own account, on her alone.
    cookies.nora = await invite(nora, 'nora@recette.test');
    cookies.ines = await invite(ines, 'ines@recette.test');
    const me = await call('GET', '/v1/me', 'nora');
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({ role: 'creator', creatorIds: [nora] });

    // 2. Her day: the lines to tick, read on the server's day in Paris.
    const today = calendarDayIn(new Date(), PARIS);
    const day = async (who: 'nora' | 'ines') =>
      HerDaySchema.parse((await call('GET', '/v1/creator-space/day', who)).json());
    expect((await day('nora')).today).toBe(today);
    expect(
      (await call('PUT', `/v1/creator-space/day/${today}/items/insta_posts`, 'nora', { done: 1 })).statusCode,
    ).toBe(204);
    expect((await day('nora')).lines.find((line) => line.item === 'insta_posts')?.done).toBe(1);

    // Her task of the day, added from her phone, then ticked.
    const taskId = newId(CreatorTaskIdSchema);
    const added = await call('POST', '/v1/creator-space/tasks', 'nora', {
      id: taskId,
      when: { kind: 'day', day: today },
      category: 'shoot',
      title: 'Séance lumière du soir',
    });
    expect(added.statusCode, added.body).toBe(200);
    const ticked = await call('POST', '/v1/creator-space/ticks', 'nora', {
      ticks: [{ taskId, day: today, doneAt: new Date().toISOString() }],
    });
    expect(ticked.statusCode, ticked.body).toBe(200);
    expect(CreatorTicksResultSchema.parse(ticked.json()).added).toBe(1);
    const agenda = async (who: 'nora' | 'ines') =>
      CreatorAgendaSchema.parse(
        (await call('GET', `/v1/creator-space/agenda?from=${today}&to=${today}`, who)).json(),
      );
    const hers = await agenda('nora');
    expect(hers.tasks.map((task) => task.title)).toEqual(['Séance lumière du soir']);
    expect(hers.ticks.map((tick) => [tick.taskId, tick.day])).toEqual([[taskId, today]]);

    // 3. Her photo, dropped from her phone: the API signs the address, the bytes go to the store, the job keeps them.
    const photo = jpegOf(MB);
    const file = { id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes: photo.length };
    const dropId = newId(ContentDropIdSchema);
    const dropped = await call('POST', '/v1/creator-space/drops', 'nora', {
      id: dropId,
      category: 'feed_shoot',
      files: [file],
    });
    expect(dropped.statusCode, dropped.body).toBe(200);
    const base = `/v1/creator-space/drops/${dropId}/files/${file.id}`;
    // Another creator cannot send into it: for her, it does not exist.
    expect((await call('POST', `${base}/upload`, 'ines')).statusCode).toBe(404);
    const complete = await sendWhole(server, cookies.nora, base, photo);
    expect(complete.statusCode, complete.body).toBe(200);
    await run('content_drops.receive_file');
    const [kept] = await test.admin.db
      .select({ state: schema.contentDropFiles.state, mediaAssetId: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, file.id));
    expect(kept?.state).toBe('kept');
    const mine = CreatorContentSchema.parse((await call('GET', '/v1/creator-space/content', 'nora')).json());
    expect(mine.drops.map((drop) => [drop.id, drop.state])).toEqual([[dropId, 'ready']]);

    // 4. Described once by the vision (stub), kept for the agency to validate.
    await run('content_drops.describe_file');
    expect(shown).toEqual(['image']);

    // 5. The owner sees her drop in her sheet, with its description.
    const agencySide = CreatorContentSchema.parse(
      (await call('GET', `/v1/creators/${nora}/content`, 'owner')).json(),
    );
    expect(agencySide.drops.map((drop) => drop.id)).toContain(dropId);
    const review = await call('GET', `/v1/creators/${nora}/drops/${dropId}/descriptions`, 'owner');
    expect(review.statusCode, review.body).toBe(200);
    const { media } = DropDescriptionsReviewSchema.parse(review.json());
    expect(media).toHaveLength(1);
    const [reviewed] = media;
    expect(reviewed).toMatchObject({
      fileId: file.id,
      mediaAssetId: kept?.mediaAssetId,
      kind: 'image',
      original: true,
    });
    expect(reviewed?.description).toMatchObject({
      author: 'sense',
      detailed: DESCRIBED.detailed,
      validatedAt: null,
    });

    // Ines, of the same agency, sees none of it: not in her content, not her sheet's routes, not to withdraw.
    const hersToo = CreatorContentSchema.parse(
      (await call('GET', '/v1/creator-space/content', 'ines')).json(),
    );
    expect(hersToo.drops).toEqual([]);
    expect((await call('GET', `/v1/creators/${nora}/content`, 'ines')).statusCode).toBe(403);
    expect((await call('GET', `/v1/creators/${nora}/drops/${dropId}/descriptions`, 'ines')).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/v1/creator-space/drops/${dropId}`, 'ines')).statusCode).toBe(404);
    expect((await agenda('ines')).tasks).toEqual([]);
    expect((await day('ines')).lines.every((line) => line.done === 0)).toBe(true);

    // 6. She withdraws it: gone from her content and from the agency's, written withdrawn by her.
    const withdrawn = await call('DELETE', `/v1/creator-space/drops/${dropId}`, 'nora');
    expect(withdrawn.statusCode, withdrawn.body).toBe(204);
    expect(
      CreatorContentSchema.parse((await call('GET', '/v1/creator-space/content', 'nora')).json()).drops,
    ).toEqual([]);
    const [row] = await test.admin.db
      .select({ state: schema.contentDrops.state, withdrawnAt: schema.contentDrops.withdrawnAt })
      .from(schema.contentDrops)
      .where(eq(schema.contentDrops.id, dropId));
    expect(row?.state).toBe('withdrawn');
    expect(row?.withdrawnAt).not.toBeNull();
    // Withdrawn twice is no error (her phone replays).
    expect((await call('DELETE', `/v1/creator-space/drops/${dropId}`, 'nora')).statusCode).toBe(204);

    // 7. Her shooting week (ADR 0140): computed on Sunday evening, validated by the owner, accepted by her in one gesture.
    const week = addDays(today, 15 - isoWeekday(today));
    const planned = await app.modules.creatorWeek.jobs.plan(
      wallClockToInstant(addDays(week, -1), 19 * 60, PARIS),
    );
    expect(planned.failed).toEqual([]);
    const draft = AgencyCreatorWeekSchema.parse(
      (await call('GET', `/v1/creators/${nora}/weeks/${week}`, 'owner')).json(),
    );
    const validated = await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'owner', {
      plan: draft.plan,
    });
    expect(validated.statusCode, validated.body).toBe(200);
    const herWeek = async (who: 'nora' | 'ines') =>
      CreatorWeekSchema.parse((await call('GET', `/v1/creator-space/week?week=${week}`, who)).json());
    expect((await herWeek('nora')).toAccept).toBe(true);
    // Ines has nothing to accept, and her gesture accepts nothing of Nora's.
    expect(await herWeek('ines')).toEqual({ week, toAccept: false, shootDays: [], delivery: null });
    expect((await call('POST', '/v1/creator-space/week/accept', 'ines', { week })).json()).toEqual({
      accepted: 0,
    });
    const accepted = await call('POST', '/v1/creator-space/week/accept', 'nora', { week });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ accepted: draft.plan.shootDays.length + 1 });
    const after = await herWeek('nora');
    expect(after.toAccept).toBe(false);
    expect(after.shootDays.map((one) => one.day)).toEqual(draft.plan.shootDays.map((one) => one.day));
    expect(after.shootDays.every((one) => one.state === 'accepted' && one.taskId !== null)).toBe(true);
    // Her accepted shooting days are tasks of her agenda now; none of Ines's.
    const first = after.shootDays[0]?.day ?? week;
    const shootTasks = CreatorAgendaSchema.parse(
      (await call('GET', `/v1/creator-space/agenda?from=${first}&to=${first}`, 'nora')).json(),
    ).tasks;
    expect(shootTasks.map((task) => task.id)).toContain(after.shootDays[0]?.taskId);
    const inesTasks = CreatorAgendaSchema.parse(
      (await call('GET', `/v1/creator-space/agenda?from=${first}&to=${first}`, 'ines')).json(),
    ).tasks;
    expect(inesTasks).toEqual([]);
  });
});
