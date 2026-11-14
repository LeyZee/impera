import {
  AvailabilityIdSchema,
  ContentDropIdSchema,
  ContentIdeaIdSchema,
  ContentIdeaListSchema,
  ContentRequestIdSchema,
  CreatorAgendaSchema,
  CreatorIdSchema,
  CreatorTaskSchema,
  JOB_PAYLOADS,
  newId,
  SuggestionIdSchema,
  TeamMemberIdSchema,
  TrendSignalIdSchema,
  ValidatedContentIdeaSchema,
  type ContentIdeaId,
  type CreatorId,
  type DropCategory,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
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

  /** An operator with Nora and Ines on his list: a manager reaches only those (recette 05/11, reco 8). */
  async function member(
    email: string,
    teamRole: 'manager' | 'chatter',
    creatorIds: readonly CreatorId[] = [nora, ines],
  ): Promise<string> {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [...creatorIds] })
      .where(eq(schema.user.id, userId));
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
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
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
    // A manager of Ines alone never reads Nora's ideas (recette 05/11, reco 8).
    const ofInes = await member('manager-ines@example.test', 'manager', [ines]);
    const elsewhere = await call('GET', `/v1/creators/${nora}/ideas?day=${TODAY}`, ofInes);
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([403, 'creator_forbidden']);
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

  it('asks the content of the shoot she accepts for its day, declines the idea of the one she declines; replayed, nothing more', async () => {
    /** The announcement her gesture enqueued, as the worker would read it. */
    const decisionOf = async (suggestionId: string) => {
      const result = await test.admin.db.execute(sql`
        select j.payload from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
         where t.identifier = 'creator_tasks.suggestion_decided'
           and j.key = ${`creator_tasks.suggestion_decided:${suggestionId}`}`);
      const [row] = z.array(z.object({ payload: z.unknown() })).parse(result.rows);
      return JOB_PAYLOADS['creator_tasks.suggestion_decided'].parse(row?.payload);
    };
    const ideaOf = async (ideaId: string) =>
      (
        await test.admin.db
          .select({ state: schema.contentIdeas.state, requestId: schema.contentIdeas.requestId })
          .from(schema.contentIdeas)
          .where(eq(schema.contentIdeas.id, ideaId))
      )[0];

    const yes = await seedIdea(nora, { title: 'Robe verte au jardin', category: 'feed_shoot' });
    const { suggestion } = ValidatedContentIdeaSchema.parse(
      (await validate(cookies.manager, nora, yes)).json(),
    );
    if (suggestion.when?.kind !== 'timed') throw new Error('a timed suggestion');
    const shootDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(
      new Date(suggestion.when.startsAt),
    );
    const accepted = await call('POST', `/v1/creator-space/suggestions/${yes}/accept`, cookies.nora, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    const decided = await decisionOf(yes);
    expect(decided).toMatchObject({ state: 'accepted', day: shootDay });
    await app.modules.trends.jobs.followDecision(decided);
    await app.modules.trends.jobs.followDecision(decided);
    const requests = await test.admin.db
      .select()
      .from(schema.contentRequests)
      .where(eq(schema.contentRequests.creatorId, nora));
    expect(requests.filter((one) => one.id === String(yes))).toEqual([
      expect.objectContaining({
        category: 'feed_shoot',
        dueOn: shootDay,
        reason: 'Robe verte au jardin',
        origin: 'idea',
        state: 'open',
        createdBy: null,
      }),
    ]);
    expect(await ideaOf(yes)).toEqual({ state: 'suggested', requestId: String(yes) });
    // Her drop for that request has all its bytes (VEI-01 d3): the idea is deposited, once; another creator's drop
    // naming the request moves nothing.
    const received = {
      dropId: newId(ContentDropIdSchema),
      requestId: ContentRequestIdSchema.parse(String(yes)),
    };
    await app.modules.trends.jobs.followDeposit({ ...received, creatorId: ines });
    expect(await ideaOf(yes)).toEqual({ state: 'suggested', requestId: String(yes) });
    await app.modules.trends.jobs.followDeposit({ ...received, creatorId: nora });
    await app.modules.trends.jobs.followDeposit({ ...received, creatorId: nora });
    expect(await ideaOf(yes)).toEqual({ state: 'deposited', requestId: String(yes) });

    const no = await seedIdea(nora, { title: 'Bain moussant' });
    await validate(cookies.owner, nora, no);
    const declined = await call('POST', `/v1/creator-space/suggestions/${no}/decline`, cookies.nora, {});
    expect(declined.statusCode, declined.body).toBe(204);
    await app.modules.trends.jobs.followDecision(await decisionOf(no));
    expect(await ideaOf(no)).toEqual({ state: 'declined', requestId: null });
    const none = await test.admin.db
      .select({ id: schema.contentRequests.id })
      .from(schema.contentRequests)
      .where(eq(schema.contentRequests.id, no));
    expect(none).toEqual([]);

    // A suggestion that no idea became: the trend watch has nothing to do with it.
    await app.modules.trends.jobs.followDecision({
      creatorId: nora,
      suggestionId: newId(SuggestionIdSchema),
      state: 'accepted',
      day: shootDay,
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

  it('carries a Reel Insta idea’s reel sheet to her agenda and copies it once into her task (ADR 0082 § 3)', async () => {
    const sheet = {
      hook: 'Devine ce que je cache ce soir',
      onScreen: 'Soirée miroir',
      shots: ['Reflet dans le miroir', 'Tenue de soirée, regard caméra'],
      ending: 'Retour au miroir du début',
      seconds: 20,
    };
    const ideaId = await seedIdea(nora, { title: 'Reel miroir du soir', category: 'instagram_reel' });
    // Moved to another category with a sheet: refused before anything is read (400).
    const elsewhere = await validate(cookies.owner, nora, ideaId, {
      category: 'instagram_post',
      reelBrief: sheet,
    });
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([400, 'request_invalid']);
    // A word of her limits in the sheet: the 422, the field named.
    const touching = await validate(cookies.owner, nora, ideaId, {
      reelBrief: { ...sheet, shots: ['Reflet dans le miroir', 'Un appel vidéo avec un fan'] },
    });
    expect([touching.statusCode, codeOf(touching)]).toEqual([422, 'content_idea_guard_unprocessable']);
    expect(touching.json()).toMatchObject({ error: { details: { field: 'shots' } } });

    const response = await validate(cookies.manager, nora, ideaId, { reelBrief: sheet });
    expect(response.statusCode, response.body).toBe(200);
    const { idea, suggestion } = ValidatedContentIdeaSchema.parse(response.json());
    expect(idea.reelBrief).toEqual(sheet);
    expect(suggestion).toMatchObject({ purpose: 'Pour : Reel Insta', reelBrief: sheet });
    const to = new Date(Date.parse(suggestion.week) + 13 * 86_400_000).toISOString().slice(0, 10);
    const agenda = CreatorAgendaSchema.parse(
      (await call('GET', `/v1/creator-space/agenda?from=${suggestion.week}&to=${to}`, cookies.nora)).json(),
    );
    expect(agenda.suggestions.find((one) => String(one.id) === String(ideaId))?.reelBrief).toEqual(sheet);
    const accepted = await call('POST', `/v1/creator-space/suggestions/${ideaId}/accept`, cookies.nora, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(CreatorTaskSchema.parse(accepted.json()).reelBrief).toEqual(sheet);
  });

  it('takes a reel sheet written by hand on a shoot for a Reel Insta, read by the guards first (ADR 0082 § 3)', async () => {
    const sheet = {
      hook: 'Trois secondes pour te convaincre',
      onScreen: null,
      shots: ['Gros plan sur la tasse', 'Elle sourit à la caméra'],
      ending: null,
      seconds: 15,
    };
    const body = (values: object) => ({
      id: newId(SuggestionIdSchema),
      when: { kind: 'day', day: '2026-12-02' },
      category: 'shoot',
      title: 'Reel café du matin',
      ...values,
    });
    const suggest = (cookie: string, values: object) =>
      call('POST', `/v1/creators/${nora}/suggestions`, cookie, body(values));

    const other = await suggest(cookies.owner, { dropCategory: 'instagram_post', reelBrief: sheet });
    expect([other.statusCode, codeOf(other)]).toEqual([400, 'request_invalid']);
    const tooLong = await suggest(cookies.owner, {
      dropCategory: 'instagram_reel',
      reelBrief: { ...sheet, hook: 'un deux trois quatre cinq six sept huit neuf' },
    });
    expect([tooLong.statusCode, codeOf(tooLong)]).toEqual([400, 'request_invalid']);
    const guarded = await suggest(cookies.manager, {
      dropCategory: 'instagram_reel',
      reelBrief: { ...sheet, ending: 'Le lien en bio, pack à 15 €' },
    });
    expect([guarded.statusCode, codeOf(guarded)]).toEqual([422, 'creator_suggestion_guard_unprocessable']);
    expect(guarded.json()).toMatchObject({
      error: { details: { reason: 'instagram_guard', field: 'ending' } },
    });
    // A chatter is refused before any guard is read.
    const chatter = await suggest(cookies.chatter, { dropCategory: 'instagram_reel', reelBrief: sheet });
    expect(chatter.statusCode).toBe(403);
    // Without an active persona, nothing for an output leaves; a plain task still does.
    const ofInes = await call('POST', `/v1/creators/${ines}/suggestions`, cookies.owner, {
      ...body({ dropCategory: 'instagram_reel', reelBrief: sheet }),
    });
    expect([ofInes.statusCode, codeOf(ofInes)]).toEqual([422, 'creator_suggestion_guard_unprocessable']);
    const plain = await call('POST', `/v1/creators/${ines}/suggestions`, cookies.owner, body({}));
    expect(plain.statusCode, plain.body).toBe(200);

    const made = await suggest(cookies.manager, { dropCategory: 'instagram_reel', reelBrief: sheet });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json()).toMatchObject({ purpose: 'Pour : Reel Insta', reelBrief: sheet, shootBrief: null });
    const agenda = CreatorAgendaSchema.parse(
      (await call('GET', '/v1/creator-space/agenda?from=2026-11-30&to=2026-12-06', cookies.nora)).json(),
    );
    expect(agenda.suggestions.find((one) => one.title === 'Reel café du matin')?.reelBrief).toEqual(sheet);
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
