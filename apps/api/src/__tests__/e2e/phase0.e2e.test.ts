import {
  ConversationDetailSchema,
  ConversationEventViewSchema,
  ConversationSummarySchema,
  CreatorIdSchema,
  newId,
  pageOf,
  PlatformAccountIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../../auth';
import { createApp, type App } from '../../composition-root';
import { createLogger } from '../../logger';
import { FakeConnector } from '../../modules/connectors';
import { buildServer, type Server } from '../../server';
import { startWorker, type WorkerHandle } from '../../worker-runner';
import { FIXED_BUBBLES, fixedComposer } from '../support/composer';
import { testConfig } from '../support/config';
import { activateDemoPersona } from '../support/persona';
import { DASHBOARD_ORIGIN } from '../support/sign-in';

/** Polls `check` until it returns a value, or fails after `timeoutMs`. */
async function eventually<T>(check: () => Promise<T | null>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Phase 0 acceptance (roadmap.md, fiche P0-07b): a fan writes on a (fake) platform, the poller brings the message
 * in, the worker drafts, the dashboard API shows the conversation with its events and its draft, an operator
 * approves, and the bubble reaches the platform once. Real HTTP server on a port, worker inline.
 */
describe('phase 0 end to end', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let worker: WorkerHandle;
  let baseUrl: string;
  let cookie: string;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  const platform = new FakeConnector();

  async function api(method: 'GET' | 'POST', path: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie,
        origin: DASHBOARD_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, json: (await response.text()) || 'null' };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const logger = createLogger(config);
    app = await createApp(config, logger, {
      connectorRegistry: { reveal: () => platform },
      composer: fixedComposer,
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    worker = await startWorker(app, { logger, concurrency: 5, release: 'e2e', cronJobs: [] });

    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db.execute(
      sql`insert into creators (id, display_name, name_key, timezone) values (${creatorId}, 'Test', 'test', 'Europe/Paris')`,
    );
    await activateDemoPersona(app, creatorId);
    await test.admin.db.execute(sql`
      insert into platform_accounts (id, creator_id, platform, handle, session_state, connector_config)
      values (${platformAccountId}, ${creatorId}, 'reveal', 'e2e', 'valid', '{"writes": true}')`);

    const owner = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
    await createOwner(app.auth, app.db.db, owner);
    const signIn = await fetch(`${baseUrl}/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: DASHBOARD_ORIGIN },
      body: JSON.stringify({ email: owner.email, password: owner.password }),
    });
    expect(signIn.status).toBe(200);
    cookie = signIn.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  });

  afterAll(async () => {
    await worker.stop();
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('brings a fan message in, drafts, shows it, and sends the approved bubble once', async () => {
    platform.enqueueInbound({
      conversationId: 'c-1',
      fanId: 'f-1',
      fanDisplayName: 'Julien',
      text: 'Salut toi',
    });
    // What the crontab's dispatcher does every minute.
    await app.modules.connectors.jobs.dispatch({ info: () => undefined, warn: () => undefined });

    const conversation = await eventually(async () => {
      const { status, json } = await api('GET', `/v1/conversations?creatorId=${creatorId}`);
      expect(status).toBe(200);
      return pageOf(ConversationSummarySchema).parse(JSON.parse(json)).items[0] ?? null;
    }, 'the conversation');
    expect(conversation).toMatchObject({ fanDisplayName: 'Julien', state: 'pending', unreadCount: 1 });

    // The debounce (45 s) is the only wait in the chain: the test lets it expire now.
    await test.admin.db.execute(
      sql`update graphile_worker._private_jobs set run_at = now() where task_id in
          (select id from graphile_worker._private_tasks where identifier = 'conversation.respond')`,
    );
    const detail = await eventually(async () => {
      const { json } = await api('GET', `/v1/conversations/${conversation.id}?creatorId=${creatorId}`);
      const parsed = ConversationDetailSchema.parse(JSON.parse(json));
      return parsed.openDrafts.length > 0 ? parsed : null;
    }, 'draft_created');
    expect(detail).toMatchObject({ state: 'awaiting_approval' });
    expect(detail.openDrafts[0]?.bubbles).toEqual(FIXED_BUBBLES);

    const { json: eventsJson } = await api(
      'GET',
      `/v1/conversations/${conversation.id}/events?creatorId=${creatorId}`,
    );
    const events = pageOf(ConversationEventViewSchema).parse(JSON.parse(eventsJson));
    expect(events.items.map((event) => event.type).reverse()).toEqual(['message_received', 'draft_created']);

    const draftId = detail.openDrafts[0]?.id ?? '';
    const approved = await api(
      'POST',
      `/v1/conversations/${conversation.id}/drafts/${draftId}/approve?creatorId=${creatorId}`,
      { bubbles: ['Coucou Julien'] },
    );
    expect(approved.status).toBe(204);

    await eventually(
      () => Promise.resolve(platform.sent.length > 0 ? platform.sent : null),
      'the bubble on the platform',
    );
    const after = await eventually(async () => {
      const { json } = await api('GET', `/v1/conversations/${conversation.id}?creatorId=${creatorId}`);
      const parsed = ConversationDetailSchema.parse(JSON.parse(json));
      return parsed.state === 'idle' ? parsed : null;
    }, 'the conversation back to idle');
    expect(after.lastOutboundAt).not.toBeNull();
    expect(platform.sent.map((sent) => sent.text)).toEqual(['Coucou Julien']);

    // Nothing left of the P0-04 demo task.
    expect(Object.keys(app.tasks)).not.toContain('demo.echo');
  });
});
