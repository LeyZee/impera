import {
  ConversationIdSchema,
  FanCardViewSchema,
  FanIdSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanCardView,
  type FanId,
  type MessageId,
} from '@impera/contracts';
import { and, eq, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { FactProposal } from '../modules/fans';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };

describe('the fan’s card (GET /v1/fans/:id/card, PUT /v1/fans/:id/card/:field, ADR 0085)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;
  let creator: string;
  let operatorId: string;
  let anna: CreatorId;
  let bea: CreatorId;
  let fan: FanId;

  const get = (cookie: string, creatorId: string = anna) =>
    server.inject({ method: 'GET', url: `/v1/fans/${fan}/card?creatorId=${creatorId}`, headers: { cookie } });
  const put = (cookie: string, field: string, payload: object, creatorId: string = anna) =>
    server.inject({
      method: 'PUT',
      url: `/v1/fans/${fan}/card/${field}?creatorId=${creatorId}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const entry = (card: FanCardView, field: string) => card.fields.find((one) => one.field === field);
  const read = async (cookie: string): Promise<FanCardView> =>
    FanCardViewSchema.parse((await get(cookie)).json());

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
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    bea = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    // An invented fan of Anna (ADR 0010).
    const accountId = newId(PlatformAccountIdSchema);
    fan = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: anna, platform: 'reveal', handle: 'anna-demo' });
      await tx.insert(schema.fans).values({
        id: fan,
        creatorId: anna,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
      });
    });
    operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [anna] })
      .where(eq(schema.user.id, operatorId));
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('reads every field in order, empty at first, and the facts already written fill it', async () => {
    expect(
      (await server.inject({ method: 'GET', url: `/v1/fans/${fan}/card?creatorId=${anna}` })).statusCode,
    ).toBe(401);
    const empty = await read(operator);
    expect(empty.fields).toHaveLength(20);
    expect(empty.fields.every((one) => one.current === null && one.toCheck.length === 0)).toBe(true);
    // A fact the brief wrote before the card existed, under another category: it fills the field as it is.
    await app.modules.fans.proposeFacts(anna, fan, [
      {
        category: 'life',
        key: 'location',
        value: 'Lyon',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: new Date('2026-11-01T10:00:00Z'),
      },
    ]);
    expect(entry(await read(owner), 'location')?.current).toMatchObject({
      items: ['Lyon'],
      source: 'declared',
    });
  });

  it('lets a chatter correct a field, authored by the session; the AI then waits « à vérifier »', async () => {
    const written = await put(operator, 'location', { items: ['Annecy'] });
    expect(written.statusCode).toBe(200);
    const card = FanCardViewSchema.parse(written.json());
    expect(entry(card, 'location')?.current).toMatchObject({
      items: ['Annecy'],
      source: 'noted',
      notedBy: operatorId,
      notedByName: 'Operator',
      sourceQuote: null,
    });
    // What he says later never replaces the chatter's note: it waits under it.
    await app.modules.fans.proposeFacts(anna, fan, [
      {
        category: 'identity',
        key: 'location',
        value: 'Grenoble',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: new Date(Date.now() + 60_000),
      },
    ]);
    const after = entry(await read(operator), 'location');
    expect(after?.current?.items).toEqual(['Annecy']);
    expect(after?.toCheck.map((one) => one.items)).toEqual([['Grenoble']]);
    // The context never reads what waits.
    expect((await app.modules.fans.activeFacts(anna, fan)).map((fact) => fact.value)).toEqual(['Annecy']);
    // Keeping the other value in one gesture settles it.
    const kept = FanCardViewSchema.parse((await put(operator, 'location', { items: ['Grenoble'] })).json());
    expect(entry(kept, 'location')).toMatchObject({ current: { items: ['Grenoble'] }, toCheck: [] });
  });

  it('writes a list whole, clears a field, and keeps the history', async () => {
    const outfits = FanCardViewSchema.parse(
      (await put(owner, 'outfits', { items: ['Lingerie rouge', 'Cosplay'] })).json(),
    );
    expect(entry(outfits, 'outfits')?.current?.items).toEqual(['Lingerie rouge', 'Cosplay']);
    const cleared = FanCardViewSchema.parse((await put(operator, 'outfits', { clear: true })).json());
    expect(entry(cleared, 'outfits')?.current).toBeNull();
    const lines = await test.admin.db
      .select()
      .from(schema.fanFacts)
      .where(and(eq(schema.fanFacts.fanId, fan), eq(schema.fanFacts.key, 'outfits')));
    expect(lines).toHaveLength(2);
  });

  it('refuses a value that does not fit its field, and what the card never keeps', async () => {
    expect((await put(operator, 'first_name', { items: ['Basile', 'Bas'] })).statusCode).toBe(400);
    expect((await put(operator, 'intensity', { items: ['hard'] })).statusCode).toBe(400);
    expect((await put(operator, 'unknown_field', { items: ['x'] })).statusCode).toBe(400);
    const refused = await put(operator, 'location', { items: ['12 rue Inventée, 06 12 34 56 78'] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'fan_card_value_unprocessable' } });
    expect(entry(await read(operator), 'location')?.current?.items).toEqual(['Grenoble']);
  });

  it('quotes his own message a value was read in, never hers', async () => {
    const conversationId = newId(ConversationIdSchema);
    const his = newId(MessageIdSchema);
    const hers = newId(MessageIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      const [account] = await tx
        .select({ id: schema.platformAccounts.id })
        .from(schema.platformAccounts)
        .where(eq(schema.platformAccounts.creatorId, anna));
      if (account === undefined) throw new Error('no account');
      await tx.insert(schema.conversations).values({
        id: conversationId,
        creatorId: anna,
        platformAccountId: account.id,
        fanId: fan,
        platformConversationId: 'conv-1',
      });
      const message = (
        id: string,
        direction: 'inbound' | 'outbound',
        author: 'fan' | 'ai',
        text: string,
      ) => ({
        id,
        creatorId: anna,
        platformAccountId: account.id,
        conversationId,
        platformMessageId: id,
        direction,
        author,
        text,
        platformCreatedAt: new Date('2026-11-02T10:00:00Z'),
      });
      await tx
        .insert(schema.messages)
        .values([
          message(his, 'inbound', 'fan', 'je bosse   à l’hôpital,\nde nuit'),
          message(hers, 'outbound', 'ai', 'Tu fais quoi dans la vie ?'),
        ]);
    });
    const fact = (key: string, value: string, sourceMessageId: MessageId): FactProposal => ({
      category: 'life',
      key,
      value,
      kind: 'inferred',
      confidence: 0.7,
      sourceMessageId,
      observedAt: new Date('2026-11-02T10:00:00Z'),
    });
    await app.modules.fans.proposeFacts(anna, fan, [
      fact('job', 'Infirmier', his),
      fact('pets', 'Un chat', hers),
    ]);
    const card = await read(operator);
    expect(entry(card, 'job')?.current).toMatchObject({
      sourceMessageId: his,
      sourceQuote: 'je bosse à l’hôpital, de nuit',
    });
    expect(entry(card, 'pets')?.current).toMatchObject({ sourceMessageId: hers, sourceQuote: null });
  });

  it('refuses the creator, another creator and an unknown fan', async () => {
    // A creator never sees her fans' card (ADR 0063).
    expect((await get(creator)).statusCode).toBe(403);
    expect((await put(creator, 'first_name', { items: ['Basile'] })).statusCode).toBe(403);
    expect((await put(operator, 'first_name', { items: ['Basile'] }, bea)).statusCode).toBe(403);
    // The owner sees every creator, but Anna's fan is not Bea's.
    expect((await get(owner, bea)).statusCode).toBe(404);
    expect((await put(owner, 'first_name', { items: ['Basile'] }, bea)).statusCode).toBe(404);
  });
});
