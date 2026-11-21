import {
  CreatorDecisionsSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
  type NewCreatorDecision,
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

/**
 * « À décider », hers (ADR 0164) through the real app: the code asks, she reads and answers her own, the owner
 * answers in her place, nobody else reads. Invented people, creators and questions only (ADR 0010).
 */
describe('her decisions (ADR 0164)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let now = new Date('2026-11-21T10:00:00Z');
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'nora' | 'ines', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
    ines: '',
  };

  const call = (method: 'GET' | 'POST', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  const subject = (n: number): string => `reel:01936f00-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const caption = (n: number, expiresAt = '2026-11-21T17:30:00.000Z'): NewCreatorDecision => ({
    kind: 'caption',
    subject: subject(n),
    category: 'post',
    question: 'Quelle légende pour ton Reel de ce soir ?',
    context: 'Reel « miroir, robe noire », prévu à 18 h 30.',
    layout: 'rows',
    answers: [
      {
        key: 'question',
        label: 'Une question',
        text: 'Robe noire ou robe rouge ?',
        noted: 'Ce sera la question.',
      },
      { key: 'teasing', label: 'Taquine', text: 'Vingt minutes pour choisir.', noted: 'Ce sera la taquine.' },
      { key: 'short', label: 'Très courte', text: 'Version miroir', noted: 'Ce sera la très courte.' },
    ],
    otherIdeasLeft: 0,
    expiresAt,
  });
  const time = (n: number, expiresAt: string): NewCreatorDecision => ({
    kind: 'publish_time',
    subject: subject(n),
    category: 'post',
    question: 'Je publie ton Reel à 18 h 30 ?',
    context: 'C’est l’heure où tes abonnés sont le plus là.',
    layout: 'buttons',
    answers: [
      { key: 'yes', label: 'Oui, à 18 h 30', text: null, noted: 'C’est noté. Je publie à 18 h 30.' },
      { key: 'change', label: 'Changer l’heure', text: null, noted: 'C’est noté, on change l’heure.' },
    ],
    otherIdeasLeft: 0,
    expiresAt,
  });
  const hers = async (who: 'nora' | 'ines') =>
    CreatorDecisionsSchema.parse((await call('GET', '/v1/creator-space/decisions', who)).json()).decisions;
  const answer = (id: string, key: string, who: keyof typeof cookies = 'nora') =>
    call('POST', `/v1/creator-space/decisions/${id}/answer`, who, { answer: key });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    const logger = createLogger(config);
    app = await createApp(config, logger, { decisionsClock: () => now });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const [who, teamRole] of [
      ['manager', 'manager'],
      ['chatter', 'chatter'],
    ] as const) {
      const member = await account(`${who}@example.test`, { role: 'operator', creatorIds: [nora, ines] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[who] = member.cookie;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('asks once per subject, and she reads what waits on her, the one that ends first on top', async () => {
    const { asking } = app.modules.creatorDecisions;
    expect(await asking.ask(nora, caption(1))).toBe(true);
    expect(await asking.ask(nora, caption(1))).toBe(false);
    expect(await asking.ask(nora, time(2, '2026-11-21T16:00:00.000Z'))).toBe(true);
    expect(await asking.ask(ines, caption(3))).toBe(true);
    const list = await hers('nora');
    expect(list.map((one) => one.kind)).toEqual(['publish_time', 'caption']);
    expect(list[1]?.answers.map((one) => one.label)).toEqual(['Une question', 'Taquine', 'Très courte']);
    expect((await hers('ines')).map((one) => one.kind)).toEqual(['caption']);
  });

  it('refuses a decision that does not hold: answers that do not fit the layout', async () => {
    await expect(
      app.modules.creatorDecisions.asking.ask(nora, { ...caption(9), layout: 'buttons' }),
    ).rejects.toThrow();
  });

  it('is hers only: no other role reads her space, another creator answers nothing of hers', async () => {
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', '/v1/creator-space/decisions', who)).statusCode, who).toBe(403);
    const [first] = await hers('nora');
    if (first === undefined) throw new Error('no decision');
    expect((await answer(first.id, 'yes', 'ines')).statusCode).toBe(404);
    expect((await call('POST', `/v1/creator-space/decisions/${first.id}/later`, 'ines')).statusCode).toBe(
      404,
    );
    expect(await hers('nora')).toHaveLength(2);
  });

  it('puts a question aside for a while, then it comes back', async () => {
    const [first] = await hers('nora');
    if (first === undefined) throw new Error('no decision');
    expect((await call('POST', `/v1/creator-space/decisions/${first.id}/later`, 'nora')).statusCode).toBe(
      204,
    );
    expect((await hers('nora')).map((one) => one.kind)).toEqual(['caption']);
    now = new Date('2026-11-21T12:00:00Z');
    expect((await hers('nora')).map((one) => one.kind)).toEqual(['publish_time', 'caption']);
  });

  it('keeps her answer once: the same again changes nothing, another is refused, an unknown one too', async () => {
    const list = await hers('nora');
    const captionId = list.find((one) => one.kind === 'caption')?.id ?? '';
    expect((await answer(captionId, 'nope')).statusCode).toBe(422);
    const first = await answer(captionId, 'teasing');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ noted: 'Ce sera la taquine.' });
    expect((await answer(captionId, 'teasing')).json()).toEqual({ noted: 'Ce sera la taquine.' });
    expect((await answer(captionId, 'short')).statusCode).toBe(409);
    expect((await hers('nora')).map((one) => one.kind)).toEqual(['publish_time']);
    expect(await app.modules.creatorDecisions.asking.read(nora, 'caption', subject(1), now)).toEqual({
      state: 'answered',
      answerKey: 'teasing',
    });
  });

  it('lets the owner alone answer in her place, in the creator named, with a line in the audit log', async () => {
    for (const who of ['manager', 'chatter', 'nora'] as const)
      expect((await call('GET', `/v1/creators/${nora}/decisions`, who)).statusCode, who).toBe(403);
    const list = CreatorDecisionsSchema.parse(
      (await call('GET', `/v1/creators/${nora}/decisions`, 'owner')).json(),
    ).decisions;
    expect(list.map((one) => one.kind)).toEqual(['publish_time']);
    const id = list[0]?.id ?? '';
    // Named under another creator, her decision is not found.
    expect(
      (await call('POST', `/v1/creators/${ines}/decisions/${id}/answer`, 'owner', { answer: 'yes' }))
        .statusCode,
    ).toBe(404);
    const done = await call('POST', `/v1/creators/${nora}/decisions/${id}/answer`, 'owner', {
      answer: 'yes',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((await answer(id, 'change')).statusCode).toBe(409);
    const lines = await test.admin.db
      .select({ entityId: schema.auditLog.entityId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'creator_decision.answer_for'));
    expect(lines).toEqual([{ entityId: id, details: { creatorId: nora } }]);
  });

  it('shows nothing of a question past its end or withdrawn, and answers neither', async () => {
    const { asking } = app.modules.creatorDecisions;
    await asking.ask(nora, time(4, '2026-11-21T13:00:00.000Z'));
    await asking.ask(nora, time(5, '2026-11-21T20:00:00.000Z'));
    const [ending, lasting] = await hers('nora');
    if (ending === undefined || lasting === undefined) throw new Error('no decision');
    await asking.withdraw(nora, 'publish_time', subject(5));
    expect((await answer(lasting.id, 'yes')).statusCode).toBe(404);
    now = new Date('2026-11-21T13:00:00Z');
    expect(await hers('nora')).toEqual([]);
    expect((await answer(ending.id, 'yes')).statusCode).toBe(404);
    expect(await asking.read(nora, 'publish_time', subject(4), now)).toEqual({
      state: 'ended',
      answerKey: null,
    });
    expect(await asking.read(nora, 'publish_time', subject(5), now)).toEqual({
      state: 'withdrawn',
      answerKey: null,
    });
    expect(await asking.read(nora, 'trial_reel', subject(6), now)).toBeNull();
  });
});
