import { randomUUID } from 'node:crypto';

import {
  ApiErrorSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropRefusalsSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CreatorContentSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
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
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

/**
 * Her drops and the agency's requests (CR-06, ADR 0044 § 1, ADR 0055): through her own door and the agency's, the
 * format checked before anything is stored, a script only from a request, her refusal and the agency's correction.
 * Invented data only (ADR 0010).
 */
describe('/v1/creator-space/content and the agency’s requests', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    chatter: '',
  };
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
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
    for (const teamRole of ['manager', 'chatter'] as const) {
      // Both creators are on his list: a manager reaches only those (recette 05/11, reco 8).
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
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const content = async (who: 'nora' | 'ines' = 'nora') => {
    const response = await call('GET', '/v1/creator-space/content', who);
    expect(response.statusCode, response.body).toBe(200);
    return CreatorContentSchema.parse(response.json());
  };
  const photo = (bytes = 2 * MB) => ({ id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes });
  const video = (bytes = 40 * MB) => ({ id: newId(ContentDropFileIdSchema), mime: 'video/mp4', bytes });

  it('opens her content to her alone, and the agency’s side to the owner and a manager', async () => {
    expect(await content()).toEqual({ requests: [], drops: [] });
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', '/v1/creator-space/content', who)).statusCode).toBe(403);
    expect((await call('GET', `/v1/creators/${nora}/content`, 'manager')).statusCode).toBe(200);
    const chatter = await call('GET', `/v1/creators/${nora}/content`, 'chatter');
    expect(chatter.statusCode).toBe(403);
    expect(chatter.json()).toMatchObject({ error: { code: 'content_drop_forbidden' } });
    expect((await call('GET', `/v1/creators/${nora}/content`, 'nora')).statusCode).toBe(403);
  });

  it('drops once whatever her phone replays, and refuses another content under its id', async () => {
    const drop = {
      id: newId(ContentDropIdSchema),
      category: 'feed_shoot',
      sentence: 'Séance lingerie rouge au salon',
      files: [photo(), photo(), video()],
    };
    const first = await call('POST', '/v1/creator-space/drops', 'nora', drop);
    expect(first.statusCode, first.body).toBe(200);
    const stored = ContentDropSchema.parse(first.json());
    expect(stored).toMatchObject({ state: 'uploading', category: 'feed_shoot', correctedFrom: null });
    expect(stored.files.map((file) => [file.position, file.kind, file.state])).toEqual([
      [0, 'image', 'awaiting'],
      [1, 'image', 'awaiting'],
      [2, 'video', 'awaiting'],
    ]);
    const replay = await call('POST', '/v1/creator-space/drops', 'nora', drop);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const changed = await call('POST', '/v1/creator-space/drops', 'nora', {
      ...drop,
      sentence: 'Autre chose',
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: { code: 'content_drop_id_conflict' } });
    // Inès never sees it, and her own id clash is a conflict too.
    expect((await content('ines')).drops).toEqual([]);
    expect((await call('POST', '/v1/creator-space/drops', 'ines', drop)).statusCode).toBe(409);
    expect((await content()).drops.map((one) => one.id)).toContain(drop.id);
  });

  it('refuses a file that does not fit its category before anything is stored, with her sentence', async () => {
    const tooHeavy = photo(31 * MB);
    const response = await call('POST', '/v1/creator-space/drops', 'nora', {
      id: newId(ContentDropIdSchema),
      category: 'instagram_reel',
      files: [video(), tooHeavy],
    });
    expect(response.statusCode).toBe(422);
    const body: unknown = response.json();
    expect(body).toMatchObject({
      error: { code: 'content_drop_format_unprocessable', message: '« Reel Insta » prend un seul fichier' },
    });
    const { refusals } = ContentDropRefusalsSchema.parse(ApiErrorSchema.parse(body).error.details);
    expect(refusals).toEqual([
      { fileId: null, sentence: '« Reel Insta » prend un seul fichier' },
      { fileId: tooHeavy.id, sentence: '« Reel Insta » prend seulement des vidéos' },
    ]);
    const unknownType = await call('POST', '/v1/creator-space/drops', 'nora', {
      id: newId(ContentDropIdSchema),
      category: 'feed_shoot',
      files: [{ id: newId(ContentDropFileIdSchema), mime: 'application/pdf', bytes: MB }],
    });
    expect(unknownType.statusCode).toBe(400);
  });

  it('takes a script only from her request for it, answered once; she may refuse another', async () => {
    const structureId = randomUUID();
    const [owner] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.role, 'owner'));
    await test.admin.db
      .insert(schema.scriptStructures)
      .values({ id: structureId, createdBy: owner?.id ?? '' });
    const noScript = await call('POST', '/v1/creator-space/drops', 'nora', {
      id: newId(ContentDropIdSchema),
      category: 'script',
      files: [video()],
    });
    expect(noScript.statusCode).toBe(422);
    expect(noScript.json()).toMatchObject({ error: { code: 'content_drop_script_unprocessable' } });
    const asked = {
      id: newId(ContentRequestIdSchema),
      category: 'script',
      dueOn: '2026-11-10',
      reason: 'Ton prochain script : la douche',
      structureId,
    };
    const created = await call('POST', `/v1/creators/${nora}/content-requests`, 'manager', asked);
    expect(created.statusCode, created.body).toBe(200);
    expect(ContentRequestSchema.parse(created.json())).toMatchObject({
      state: 'open',
      origin: 'agency',
      dropId: null,
    });
    // A script request names its structure, and only it does.
    expect(
      (
        await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', {
          ...asked,
          id: newId(ContentRequestIdSchema),
          structureId: null,
        })
      ).statusCode,
    ).toBe(400);
    // A structure kept for Inès, or archived, is never asked of Nora.
    const kept = randomUUID();
    const archived = randomUUID();
    await test.admin.db.insert(schema.scriptStructures).values([
      { id: kept, createdBy: owner?.id ?? '', reservedCreatorId: ines },
      { id: archived, createdBy: owner?.id ?? '', archivedAt: new Date(Date.now() + 60_000) },
    ]);
    for (const other of [kept, archived, randomUUID()]) {
      const refused = await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', {
        ...asked,
        id: newId(ContentRequestIdSchema),
        structureId: other,
      });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'content_request_structure_unprocessable' } });
    }
    const answer = {
      id: newId(ContentDropIdSchema),
      category: 'script',
      requestId: asked.id,
      files: [video(), photo()],
    };
    expect((await call('POST', '/v1/creator-space/drops', 'nora', answer)).statusCode).toBe(200);
    const again = await call('POST', '/v1/creator-space/drops', 'nora', {
      ...answer,
      id: newId(ContentDropIdSchema),
    });
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ error: { code: 'content_drop_request_unprocessable' } });
    const seen = await content();
    expect(seen.requests.find((one) => one.id === asked.id)?.dropId).toBe(answer.id);
    // Answered: no refusal any more. Withdrawn: open again, and she may refuse it.
    expect(
      (await call('POST', `/v1/creator-space/content-requests/${asked.id}/refuse`, 'nora', {})).statusCode,
    ).toBe(409);
    {
      const r = await call('DELETE', `/v1/creator-space/drops/${answer.id}`, 'nora');
      expect(r.statusCode, r.body).toBe(204);
    }
    {
      const r = await call('DELETE', `/v1/creator-space/drops/${answer.id}`, 'nora');
      expect(r.statusCode, r.body).toBe(204);
    }
    const refused = await call('POST', `/v1/creator-space/content-requests/${asked.id}/refuse`, 'nora', {
      reason: 'Pas de douche chez moi cette semaine',
    });
    expect(refused.statusCode, refused.body).toBe(204);
    expect((await content()).requests.find((one) => one.id === asked.id)).toMatchObject({
      state: 'refused',
      refusalReason: 'Pas de douche chez moi cette semaine',
      dropId: null,
    });
    // Closed: the agency no longer cancels it.
    expect(
      (await call('DELETE', `/v1/creators/${nora}/content-requests/${asked.id}`, 'owner')).statusCode,
    ).toBe(409);
  });

  it('lets the agency correct her category, which she sees, and cancel a request she no longer sees', async () => {
    const drop = { id: newId(ContentDropIdSchema), category: 'feed_shoot', files: [photo()] };
    expect((await call('POST', '/v1/creator-space/drops', 'nora', drop)).statusCode).toBe(200);
    const corrected = await call('PATCH', `/v1/creators/${nora}/drops/${drop.id}`, 'manager', {
      category: 'reveal_story',
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({ category: 'reveal_story', correctedFrom: 'feed_shoot' });
    expect((await content()).drops.find((one) => one.id === drop.id)).toMatchObject({
      category: 'reveal_story',
      correctedFrom: 'feed_shoot',
    });
    // A correction that does not fit the files is refused: a Reel takes only videos.
    const reel = await call('PATCH', `/v1/creators/${nora}/drops/${drop.id}`, 'owner', {
      category: 'instagram_reel',
    });
    expect(reel.statusCode).toBe(422);
    // Back to her choice: the mark goes.
    const back = await call('PATCH', `/v1/creators/${nora}/drops/${drop.id}`, 'owner', {
      category: 'feed_shoot',
    });
    expect(back.json()).toMatchObject({ category: 'feed_shoot', correctedFrom: null });
    expect(
      (await call('PATCH', `/v1/creators/${nora}/drops/${drop.id}`, 'chatter', { category: 'mass_dm' }))
        .statusCode,
    ).toBe(403);
    const asked = {
      id: newId(ContentRequestIdSchema),
      category: 'mass_dm',
      dueOn: '2026-11-08',
      reason: 'Plus que deux relances en stock',
    };
    expect((await call('POST', `/v1/creators/${nora}/content-requests`, 'owner', asked)).statusCode).toBe(
      200,
    );
    expect((await content()).requests.map((one) => one.id)).toContain(asked.id);
    expect(
      (await call('DELETE', `/v1/creators/${nora}/content-requests/${asked.id}`, 'owner')).statusCode,
    ).toBe(204);
    expect((await content()).requests.map((one) => one.id)).not.toContain(asked.id);
    const agencySide = CreatorContentSchema.parse(
      (await call('GET', `/v1/creators/${nora}/content`, 'owner')).json(),
    );
    expect(agencySide.requests.find((one) => one.id === asked.id)?.state).toBe('cancelled');
  });

  it('never lets her withdraw what is already scheduled; the agency drops for her', async () => {
    const drop = { id: newId(ContentDropIdSchema), category: 'telegram_post', files: [video()] };
    const byAgency = await call('POST', `/v1/creators/${nora}/drops`, 'owner', drop);
    expect(byAgency.statusCode, byAgency.body).toBe(200);
    await test.admin.db
      .update(schema.contentDrops)
      .set({ state: 'scheduled' })
      .where(eq(schema.contentDrops.id, drop.id));
    const withdrawn = await call('DELETE', `/v1/creator-space/drops/${drop.id}`, 'nora');
    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json()).toMatchObject({ error: { code: 'content_drop_settled_conflict' } });
    expect((await call('DELETE', `/v1/creators/${nora}/drops/${drop.id}`, 'manager')).statusCode).toBe(204);
    expect((await content()).drops.map((one) => one.id)).not.toContain(drop.id);
  });
});
