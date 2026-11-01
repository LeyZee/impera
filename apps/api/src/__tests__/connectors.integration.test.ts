import { randomBytes } from 'node:crypto';

import {
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type SessionState,
} from '@nirvana/contracts';
import { decryptSecret, eq, parseEncryptionKeys, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { FakeConnector } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { activateDemoPersona } from './support/persona';

const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000001');
const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const DEVICE_TOKEN = randomBytes(32).toString('base64');

const JobRowSchema = z.object({ queue_name: z.string().nullable(), key: z.string().nullable() });

describe('connectors module (P0-06)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  const sink = new LogSink();
  /** One fake platform per account; the registry hands the right one to the resolver. */
  const fakes = new Map<string, FakeConnector>();
  const sessionsSeen = new Map<string, string | null>();

  async function account(
    handle: string,
    sessionState: SessionState,
    writes = true,
  ): Promise<PlatformAccountId> {
    const id = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id, creatorId, platform: 'reveal', handle, sessionState, connectorConfig: { writes } });
    fakes.set(id, new FakeConnector());
    return id;
  }

  function fake(id: PlatformAccountId): FakeConnector {
    const found = fakes.get(id);
    if (found === undefined) throw new Error('no fake for this account');
    return found;
  }

  const poll = (platformAccountId: PlatformAccountId) =>
    app.modules.connectors.jobs.poll({ creatorId, platformAccountId, correlationId: 'test' }, NO_LOG);

  async function accountRow(id: PlatformAccountId) {
    const [row] = await test.admin.db
      .select()
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.id, id));
    if (row === undefined) throw new Error('account row missing');
    return row;
  }

  async function count(table: 'messages' | 'domain_events', where: ReturnType<typeof sql>): Promise<number> {
    const result = await test.admin.db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
    );
    return z.array(z.object({ n: z.number() })).parse(result.rows)[0]?.n ?? 0;
  }

  async function jobs(task: string) {
    const result = await test.admin.db.execute(
      sql`select queue_name, key from graphile_worker.jobs where task_identifier = ${task}`,
    );
    return z.array(JobRowSchema).parse(result.rows);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      LOG_LEVEL: 'trace',
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
      EXTENSION_DEVICE_TOKEN: DEVICE_TOKEN,
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorRegistry: {
        reveal: (connectorAccount, session) => {
          sessionsSeen.set(connectorAccount.id, session);
          return fake(connectorAccount.id);
        },
      },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await activateDemoPersona(app, creatorId);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('ingests 3 fan messages into 3 messages and 1 debounced respond job; a second poll adds nothing', async () => {
    const id = await account('poll', 'valid');
    for (const text of ['Salut', 'Ça va ?', 'Tu fais quoi ce soir']) {
      fake(id).enqueueInbound({ conversationId: 'c-1', fanId: 'f-1', fanDisplayName: 'Julien', text });
    }
    await poll(id);
    expect(await count('messages', sql`platform_account_id = ${id}`)).toBe(3);
    expect(await jobs('conversation.respond')).toHaveLength(1);
    expect((await accountRow(id)).lastPollAt).not.toBeNull();

    await poll(id);
    expect(await count('messages', sql`platform_account_id = ${id}`)).toBe(3);
    expect(await jobs('conversation.respond')).toHaveLength(1);
  });

  it('sends an approved draft through the connector: a 429 is retried, the fan gets each bubble once', async () => {
    const id = await account('send', 'valid');
    fake(id).enqueueInbound({ conversationId: 'c-2', fanId: 'f-2', fanDisplayName: 'Marc', text: 'Coucou' });
    await poll(id);
    const [row] = await test.admin.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.platformAccountId, id));
    const conversationId = ConversationIdSchema.parse(row?.id);
    const job = { creatorId, conversationId, correlationId: 'test' };
    await app.modules.conversations.jobs.respond(job, NO_LOG);
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
    const draftId = DraftIdSchema.parse(draft?.id);
    await app.modules.conversations.approveDraft({
      ...job,
      userId: USER,
      draftId,
      bubbles: ['Coucou Marc', 'Tu fais quoi ?'],
    });

    fake(id).failNext('sendText', 'rate_limited');
    await expect(app.modules.conversations.jobs.send({ ...job, draftId }, NO_LOG, 1)).rejects.toMatchObject({
      code: 'connector_rate_limited',
    });
    await app.modules.conversations.jobs.send({ ...job, draftId }, NO_LOG, 2);
    expect(fake(id).sent.map((sent) => sent.text)).toEqual(['Coucou Marc', 'Tu fais quoi ?']);
    expect(fake(id).calls.sendText).toBe(3);

    // The next poll sees our own messages on the platform and does not record them twice.
    await poll(id);
    expect(await count('messages', sql`platform_account_id = ${id} and direction = 'outbound'`)).toBe(2);
    const [state] = await test.admin.db
      .select({ state: schema.conversations.state })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    expect(state?.state).toBe('idle');
  });

  it('refuses to send through an account whose write guard is off: no platform call, no retry', async () => {
    const id = await account('read-only', 'valid', false);
    fake(id).enqueueInbound({ conversationId: 'c-4', fanId: 'f-4', fanDisplayName: 'Léo', text: 'Salut' });
    await poll(id);
    const [row] = await test.admin.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.platformAccountId, id));
    const conversationId = ConversationIdSchema.parse(row?.id);
    const job = { creatorId, conversationId, correlationId: 'test' };
    await app.modules.conversations.jobs.respond(job, NO_LOG);
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
    const draftId = DraftIdSchema.parse(draft?.id);
    await app.modules.conversations.approveDraft({ ...job, userId: USER, draftId, bubbles: ['Coucou'] });

    // Attempt 1 of 5 and yet final: the job does not throw, so Graphile does not retry.
    await app.modules.conversations.jobs.send({ ...job, draftId }, NO_LOG, 1);
    expect(fake(id).calls.sendText).toBe(0);
    expect(fake(id).sent).toHaveLength(0);
    const [after] = await test.admin.db
      .select({ status: schema.drafts.status })
      .from(schema.drafts)
      .where(eq(schema.drafts.id, draftId));
    expect(after?.status).toBe('failed');
    const failed = await test.admin.db.execute(
      sql`select payload->>'error' as error from conversation_events where conversation_id = ${conversationId} and type = 'send_failed'`,
    );
    expect(failed.rows).toEqual([{ error: 'connector_writes_disabled' }]);
    // Nothing will retry: the conversation waits for a human instead of staying in `sending`.
    const [conversation] = await test.admin.db
      .select({ state: schema.conversations.state })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    expect(conversation?.state).toBe('error');
  });

  it('stops an account whose session expired: state, event, no ingestion, no answer, no more calls', async () => {
    const id = await account('expired', 'valid');
    fake(id).enqueueInbound({ conversationId: 'c-3', fanId: 'f-3', fanDisplayName: 'Paul', text: 'Hello' });
    fake(id).expireSession();
    const respondJobs = (await jobs('conversation.respond')).length;
    await poll(id);
    expect((await accountRow(id)).sessionState).toBe('expired');
    expect(
      await count(
        'domain_events',
        sql`type = 'session_state_changed' and payload->>'platformAccountId' = ${id} and payload->>'to' = 'expired'`,
      ),
    ).toBe(1);
    expect(await count('messages', sql`platform_account_id = ${id}`)).toBe(0);
    expect(await jobs('conversation.respond')).toHaveLength(respondJobs);

    const healthCalls = fake(id).calls.health;
    await poll(id);
    expect(fake(id).calls.health).toBe(healthCalls);
  });

  it('opens the circuit breaker after N failed polls, then leaves the account alone', async () => {
    const id = await account('breaker', 'valid');
    for (let failure = 0; failure < 5; failure += 1) fake(id).failNext('listConversations', 'transient');
    for (let failure = 0; failure < 4; failure += 1) await poll(id);
    expect((await accountRow(id)).consecutiveErrors).toBe(4);
    await poll(id);
    const row = await accountRow(id);
    expect(row.pausedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(
      await count('domain_events', sql`type = 'error' and payload->>'code' = 'connector_transient'`),
    ).toBe(1);
    const calls = fake(id).calls.health;
    await poll(id);
    expect(fake(id).calls.health).toBe(calls);
  });

  it('dispatches one poll per pollable account on its serial queue, never two', async () => {
    const id = await account('dispatch', 'valid');
    await app.modules.connectors.jobs.dispatch(NO_LOG);
    await app.modules.connectors.jobs.dispatch(NO_LOG);
    const polls = await jobs('connector.poll');
    const mine = polls.filter((job) => job.key === `poll:${id}`);
    expect(mine).toEqual([{ queue_name: `account:${id}`, key: `poll:${id}` }]);
    // Expired and paused accounts are left out.
    const expired = await test.admin.db
      .select({ id: schema.platformAccounts.id })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.handle, 'expired'));
    expect(polls.map((job) => job.key)).not.toContain(`poll:${expired[0]?.id ?? ''}`);
    const paused = await test.admin.db
      .select({ id: schema.platformAccounts.id })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.handle, 'breaker'));
    expect(polls.map((job) => job.key)).not.toContain(`poll:${paused[0]?.id ?? ''}`);
  });

  it("stores the extension's session encrypted, unreadable without the key, and never logs it", async () => {
    const id = await account('sync', 'none');
    const secret = `reveal-session-${randomBytes(12).toString('hex')}`;
    const refused = await server.inject({
      method: 'POST',
      url: '/v1/connector/sessions',
      headers: { 'x-extension-token': 'wrong' },
      payload: { platformAccountId: id, session: secret },
    });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: { code: 'device_unauthenticated' } });
    // The token before the body (recette 28/10): without it, a body that does not validate, or is not even JSON,
    // gets the same 401, never a 400 listing the fields.
    for (const attempt of [
      { headers: {}, payload: { platformAccountId: 'nope' } },
      { headers: { 'x-extension-token': 'wrong' }, payload: {} },
      { headers: { 'content-type': 'application/json' }, payload: '{"session":' },
    ]) {
      const early = await server.inject({ method: 'POST', url: '/v1/connector/sessions', ...attempt });
      expect([early.statusCode, early.json<{ error: { code: string } }>().error.code]).toEqual([
        401,
        'device_unauthenticated',
      ]);
    }

    const stored = await server.inject({
      method: 'POST',
      url: '/v1/connector/sessions',
      headers: { 'x-extension-token': DEVICE_TOKEN, origin: 'chrome-extension://abcdef' },
      payload: { platformAccountId: id, session: secret },
    });
    expect(stored.statusCode, stored.body).toBe(204);

    const row = await accountRow(id);
    expect(row.sessionState).toBe('valid');
    const ciphertext = row.sessionCiphertext;
    if (ciphertext === null) throw new Error('no ciphertext');
    expect(ciphertext.toString('utf8')).not.toContain(secret);
    expect(ciphertext.toString('latin1')).not.toContain(secret);
    expect(decryptSecret(ciphertext, parseEncryptionKeys(SESSION_KEYS), id)).toBe(secret);
    const otherKey = parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`);
    expect(() => decryptSecret(ciphertext, otherKey, id)).toThrow();
    expect(await app.modules.connectors.sessions.load(creatorId, id)).toBe(secret);

    // The poll builds the connector from the decrypted session.
    await poll(id);
    expect(sessionsSeen.get(id)).toBe(secret);
    const audit = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'connector.session_stored'));
    expect(audit.map((entry) => entry.entityId)).toEqual([id]);
    expect(sink.lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(sink.lines)).not.toContain(secret);
    expect(JSON.stringify(sink.lines)).not.toContain(DEVICE_TOKEN);
  });

  it('dates the session only when it is new: the same one sent again does not hide a late read (recette 28/10)', async () => {
    const id = await account('resent', 'none');
    const send = async (session: string) => {
      const sent = await server.inject({
        method: 'POST',
        url: '/v1/connector/sessions',
        headers: { 'x-extension-token': DEVICE_TOKEN, origin: 'chrome-extension://abcdef' },
        payload: { platformAccountId: id, session },
      });
      expect(sent.statusCode, sent.body).toBe(204);
    };
    const longAgo = new Date('2026-01-01T00:00:00.000Z');
    const age = async () => {
      await test.admin.db
        .update(schema.platformAccounts)
        .set({ sessionUpdatedAt: longAgo })
        .where(eq(schema.platformAccounts.id, id));
    };
    const datedAt = async () => (await accountRow(id)).sessionUpdatedAt?.getTime();

    await send('reveal-session-a');
    expect(await datedAt()).not.toBe(longAgo.getTime());
    await age();
    // The same session sent again: stored, still valid, but not a new one.
    await send('reveal-session-a');
    expect(await datedAt()).toBe(longAgo.getTime());
    expect((await accountRow(id)).sessionState).toBe('valid');
    // Another session: a new one.
    await send('reveal-session-b');
    expect(await datedAt()).not.toBe(longAgo.getTime());
    // The same session again, over an expired state: stored again by a person, so a new start.
    await age();
    await app.modules.connectors.sessions.markExpired(creatorId, id, 'test');
    await send('reveal-session-b');
    expect(await datedAt()).not.toBe(longAgo.getTime());
    expect((await accountRow(id)).sessionState).toBe('valid');
  });
});
