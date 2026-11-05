import {
  AvailabilityIdSchema,
  ContentIdeaIdSchema,
  ContentIdeaListSchema,
  CreatorAgendaSchema,
  CreatorIdSchema,
  CreatorTaskSchema,
  newId,
  TeamMemberIdSchema,
  TrendSignalIdSchema,
  ValidatedContentIdeaSchema,
  type ContentIdeaId,
  type CreatorId,
  type DropCategory,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
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
const OWNER = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
const TODAY = '2026-11-03';

/**
 * « Idées du jour » (VEI-01 lot d1, ADR 0060 § 5): the owner and an active manager validate, correct or refuse an
 * idea; a validated idea becomes a suggestion in her agenda, its « à tourner » her shooting sheet. Invented data only
 * (ADR 0010): the demo persona, invented creators and ideas.
 */
describe('/v1/creators/:creatorId/ideas', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let ownerId = '';
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;

  async function seedCreator(label: string): Promise<CreatorId> {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone: 'Europe/Paris' });
    return creatorId;
  }

  async function member(email: string, teamRole: 'manager' | 'chatter'): Promise<string> {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `Membre ${teamRole}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return signIn(server, email, PASSWORD);
  }

  async function seedIdea(
    creatorId: CreatorId,
    over: Partial<{ title: string; category: DropCategory; toShoot: string; shootMinutes: number }> = {},
  ): Promise<ContentIdeaId> {
    const signalId = newId(TrendSignalIdSchema);
    await test.admin.db.insert(schema.trendSignals).values({
      id: signalId,
      creatorId,
      source: 'agency_link',
      kind: 'format',
      text: 'Une transition tenue inventée',
      url: `https://www.instagram.com/reel/${signalId.replaceAll('-', '').slice(-11)}/`,
      format: 'reel',
      createdBy: ownerId,
      observedAt: new Date(`${TODAY}T08:00:00.000Z`),
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    const ideaId = newId(ContentIdeaIdSchema);
    await test.admin.db.insert(schema.contentIdeas).values({
      id: ideaId,
      creatorId,
      signalId,
      title: over.title ?? 'Transition robe rouge au miroir',
      category: over.category ?? 'feed_shoot',
      toShoot: over.toShoot ?? 'Trois photos au miroir, robe rouge, lumière de fin de journée.',
      reason: 'Ce format de transition revient chez les comptes suivis cette semaine.',
      shootMinutes: over.shootMinutes ?? 60,
      proposedOn: TODAY,
    });
    return ideaId;
  }

  const validate = (cookie: string, creatorId: CreatorId, ideaId: string, correction: object | null = null) =>
    call('POST', `/v1/creators/${creatorId}/ideas/${ideaId}/validate`, cookie, { correction });

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
    nora = await seedCreator('Nora');
    ines = await seedCreator('Ines');
    await activateDemoPersona(app, nora);
    ownerId = (await createOwner(app.auth, app.db.db, OWNER)).userId;
    cookies.owner = await signIn(server, OWNER.email, OWNER.password);
    cookies.manager = await member('manager@example.test', 'manager');
    cookies.chatter = await member('chatter@example.test', 'chatter');
    const creator = await createOwner(app.auth, app.db.db, {
      email: 'nora@example.test',
      name: 'Nora',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [nora] })
      .where(eq(schema.user.id, creator.userId));
    cookies.nora = await signIn(server, 'nora@example.test', PASSWORD);
    // Her dispos: every day, 14 h to 20 h in her zone.
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      const dispo = {
        id: newId(AvailabilityIdSchema),
        when: { kind: 'weekly', weekday, startMinute: 14 * 60, endMinute: 20 * 60 },
      };
      const made = await call('POST', '/v1/creator-space/availabilities', cookies.nora, dispo);
      expect(made.statusCode, made.body).toBe(200);
    }
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lists her ideas of a day for the owner and a manager, never for a chatter nor for her', async () => {
    const ideaId = await seedIdea(nora, { title: 'Idée de la liste' });
    const list = await call('GET', `/v1/creators/${nora}/ideas?day=${TODAY}`, cookies.manager);
    expect(list.statusCode, list.body).toBe(200);
    const listed = ContentIdeaListSchema.parse(list.json());
    expect(listed.day).toBe(TODAY);
    const one = listed.items.find((idea) => idea.id === ideaId);
    // The signal it cites comes with it, for the agency only.
    expect(one?.signal).toMatchObject({ source: 'agency_link', text: 'Une transition tenue inventée' });
    const chatter = await call('GET', `/v1/creators/${nora}/ideas?day=${TODAY}`, cookies.chatter);
    expect([chatter.statusCode, codeOf(chatter)]).toEqual([403, 'content_idea_forbidden']);
    expect((await call('GET', `/v1/creators/${nora}/ideas?day=${TODAY}`, cookies.nora)).statusCode).toBe(403);
    const otherDay = await call('GET', `/v1/creators/${nora}/ideas?day=2026-11-04`, cookies.owner);
    expect(ContentIdeaListSchema.parse(otherDay.json())).toEqual({ day: '2026-11-04', items: [] });
    // Without a day: today in her zone.
    const today = ContentIdeaListSchema.parse(
      (await call('GET', `/v1/creators/${nora}/ideas`, cookies.owner)).json(),
    );
    expect(today.day).toBe(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    );
  });

  it('turns a corrected idea into a suggestion in her first room, its « à tourner » her sheet; replayed, nothing more', async () => {
    const ideaId = await seedIdea(nora);
    const response = await validate(cookies.manager, nora, ideaId, { title: 'Robe rouge au miroir' });
    expect(response.statusCode, response.body).toBe(200);
    const { idea, suggestion } = ValidatedContentIdeaSchema.parse(response.json());
    expect(idea).toMatchObject({ id: ideaId, state: 'suggested', title: 'Robe rouge au miroir' });
    expect(suggestion).toMatchObject({
      id: ideaId,
      origin: 'agency',
      state: 'suggested',
      category: 'shoot',
      title: 'Robe rouge au miroir',
      purpose: 'Pour : Feed · Séance boudoir',
      shootBrief: 'Trois photos au miroir, robe rouge, lumière de fin de journée.',
      minutes: 60,
    });
    // In one of her dispos, 14 h to 20 h in Paris (UTC+1 in November), and never in the past.
    expect(suggestion.when?.kind).toBe('timed');
    if (suggestion.when?.kind !== 'timed') throw new Error('a timed suggestion');
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(suggestion.when.startsAt)),
    );
    expect(hour).toBeGreaterThanOrEqual(14);
    expect(hour).toBeLessThan(20);
    expect(Date.parse(suggestion.when.startsAt)).toBeGreaterThan(Date.now() - 60_000);

    const [row] = await test.admin.db
      .select({ suggestionId: schema.contentIdeas.suggestionId, decidedBy: schema.contentIdeas.decidedBy })
      .from(schema.contentIdeas)
      .where(eq(schema.contentIdeas.id, ideaId));
    expect(row?.suggestionId).toBe(ideaId);

    // Replayed, with another correction: the same suggestion, the correction not read.
    const again = await validate(cookies.owner, nora, ideaId, { title: 'Autre titre' });
    expect(again.statusCode, again.body).toBe(200);
    expect(ValidatedContentIdeaSchema.parse(again.json())).toEqual({ idea, suggestion });
    const made = await test.admin.db
      .select({ id: schema.creatorSuggestions.id })
      .from(schema.creatorSuggestions)
      .where(eq(schema.creatorSuggestions.id, ideaId));
    expect(made).toHaveLength(1);
  });

  it('shows her the sheet before she accepts, and copies it once into her task', async () => {
    const ideaId = await seedIdea(nora, {
      title: 'Bougies et dentelle',
      toShoot: 'Une vidéo de 20 secondes, bougies.',
    });
    const response = await validate(cookies.owner, nora, ideaId);
    const { suggestion } = ValidatedContentIdeaSchema.parse(response.json());
    if (suggestion.when?.kind !== 'timed') throw new Error('a timed suggestion');
    const day = suggestion.week;
    const to = new Date(Date.parse(day) + 13 * 86_400_000).toISOString().slice(0, 10);
    const agenda = CreatorAgendaSchema.parse(
      (await call('GET', `/v1/creator-space/agenda?from=${day}&to=${to}`, cookies.nora)).json(),
    );
    const seen = agenda.suggestions.find((one) => String(one.id) === String(ideaId));
    expect(seen).toMatchObject({
      shootBrief: 'Une vidéo de 20 secondes, bougies.',
      title: 'Bougies et dentelle',
    });
    const accepted = await call('POST', `/v1/creator-space/suggestions/${ideaId}/accept`, cookies.nora, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(CreatorTaskSchema.parse(accepted.json())).toMatchObject({
      shootBrief: 'Une vidéo de 20 secondes, bougies.',
      category: 'shoot',
    });
  });

  it('refuses a correction that touches her limits or says nudity for a public output; the idea stays to decide', async () => {
    const ideaId = await seedIdea(nora);
    const limit = await validate(cookies.manager, nora, ideaId, { toShoot: 'Un appel vidéo avec un fan.' });
    expect([limit.statusCode, codeOf(limit)]).toEqual([422, 'content_idea_guard_unprocessable']);
    const nudity = await validate(cookies.manager, nora, ideaId, { toShoot: 'Une photo nue au miroir.' });
    expect([nudity.statusCode, codeOf(nudity)]).toEqual([422, 'content_idea_guard_unprocessable']);
    const [row] = await test.admin.db
      .select({ state: schema.contentIdeas.state, toShoot: schema.contentIdeas.toShoot })
      .from(schema.contentIdeas)
      .where(eq(schema.contentIdeas.id, ideaId));
    expect(row).toEqual({
      state: 'proposed',
      toShoot: 'Trois photos au miroir, robe rouge, lumière de fin de journée.',
    });
    // Without an active persona, nothing can tell what touches her: nothing leaves.
    const hers = await seedIdea(ines);
    const none = await validate(cookies.owner, ines, hers);
    expect([none.statusCode, codeOf(none)]).toEqual([422, 'content_idea_guard_unprocessable']);
  });

  it('leaves the suggestion undated when no dispo has room', async () => {
    const ideaId = await seedIdea(nora, { title: 'Journée plage', shootMinutes: 480 });
    const { suggestion } = ValidatedContentIdeaSchema.parse(
      (await validate(cookies.owner, nora, ideaId)).json(),
    );
    expect(suggestion).toMatchObject({ when: null, minutes: 480 });
  });

  it('refuses an idea with its reason once; the other gesture is refused, a chatter does neither', async () => {
    const ideaId = await seedIdea(nora, { title: 'Idée à refuser' });
    const byChatter = await call('POST', `/v1/creators/${nora}/ideas/${ideaId}/refuse`, cookies.chatter, {});
    expect([byChatter.statusCode, codeOf(byChatter)]).toEqual([403, 'content_idea_forbidden']);
    const refused = await call('POST', `/v1/creators/${nora}/ideas/${ideaId}/refuse`, cookies.owner, {
      reason: 'Trop proche de la semaine dernière',
    });
    expect(refused.statusCode, refused.body).toBe(200);
    expect(refused.json()).toMatchObject({
      state: 'refused',
      refusalReason: 'Trop proche de la semaine dernière',
    });
    const again = await call('POST', `/v1/creators/${nora}/ideas/${ideaId}/refuse`, cookies.manager, {});
    expect(again.json()).toMatchObject({
      state: 'refused',
      refusalReason: 'Trop proche de la semaine dernière',
    });
    const validated = await validate(cookies.owner, nora, ideaId);
    expect([validated.statusCode, codeOf(validated)]).toEqual([409, 'content_idea_decided_conflict']);
    const suggested = await seedIdea(nora, { title: 'Idée déjà partie' });
    await validate(cookies.owner, nora, suggested);
    const late = await call('POST', `/v1/creators/${nora}/ideas/${suggested}/refuse`, cookies.owner, {});
    expect([late.statusCode, codeOf(late)]).toEqual([409, 'content_idea_decided_conflict']);
  });

  it('answers 404 for an idea of another creator or none', async () => {
    const hers = await seedIdea(ines);
    const across = await validate(cookies.owner, nora, hers);
    expect([across.statusCode, codeOf(across)]).toEqual([404, 'content_idea_not_found']);
    const none = await validate(cookies.owner, nora, newId(ContentIdeaIdSchema));
    expect([none.statusCode, codeOf(none)]).toEqual([404, 'content_idea_not_found']);
  });
});
