import {
  CustomAlertGroupIdSchema,
  CustomAlertGroupSchema,
  EventIdSchema,
  newId,
  pageOf,
  PlatformAccountIdSchema,
  AlertTriggerItemSchema,
  MarkAlertTriggersSeenResultSchema,
  type AlertTrigger,
  type ConversationId,
  type CreatorId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };

const PageSchema = pageOf(AlertTriggerItemSchema);
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

describe('history of her alerts (P4-01, /v1/alerts/triggers)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;

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
    await createOwner(app.auth, app.db.db, OWNER);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  /** A conversation of hers with one message of the fan's (the text never reaches the history). */
  async function conversationOf(creatorId: CreatorId, fan: string): Promise<ConversationId> {
    const platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: `h-${fan}` });
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: `c-${fan}`,
      platformFanId: `f-${fan}`,
      fanDisplayName: fan,
      message: {
        ref: { platform: 'reveal', id: `m-${fan}` },
        conversationRef: { platform: 'reveal', id: `c-${fan}` },
        direction: 'inbound',
        text: 'texte du fan qui ne sort jamais',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'history',
    });
    return conversationId;
  }

  /** What the agent will write (PR B): a fixture straight into the journal, at the end of its sequence. */
  async function triggered(
    creatorId: CreatorId,
    conversationId: ConversationId,
    trigger: AlertTrigger,
    at: string | null,
    pauses = false,
  ): Promise<string> {
    const id = newId(EventIdSchema);
    const [last] = await test.admin.db
      .select({ seq: sql<number>`max(${schema.conversationEvents.seq})::int` })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId));
    await test.admin.db.insert(schema.conversationEvents).values({
      id,
      creatorId,
      conversationId,
      seq: (last?.seq ?? 0) + 1,
      type: pauses ? 'handoff_requested' : 'alert_triggered',
      payload: pauses
        ? { conversationId, cause: 'custom_alert', trigger }
        : { conversationId, trigger, notify: true },
      actor: 'ai',
      correlationId: 'history',
      // `null`: the base's own clock, to the microsecond, as the agent will write.
      ...(at === null ? {} : { createdAt: new Date(at) }),
    });
    return id;
  }

  it('lists her triggers newest first, names her alert as it was, and keeps the « vu » of the agency', async () => {
    const nora = await app.modules.persona.creators.create({ displayName: 'Nora' });
    const iris = await app.modules.persona.creators.create({ displayName: 'Iris' });
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora.id] })
      .where(eq(schema.user.id, userId));
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const operator = {
      cookie: await signIn(server, OPERATOR.email, OPERATOR.password),
      origin: DASHBOARD_ORIGIN,
    };

    const groupId = newId(CustomAlertGroupIdSchema);
    const created = await server.inject({
      method: 'POST',
      url: '/v1/alerts',
      headers: owner,
      payload: {
        groupId,
        name: 'Vidéo perso',
        phrase: 'Il demande une vidéo faite pour lui',
        keywords: ['vidéo perso'],
        pausesAgent: true,
        notify: true,
        creators: [{ creatorId: nora.id, enabled: true }],
      },
    });
    const alertId = CustomAlertGroupSchema.parse(created.json()).creators[0]?.alertId;
    if (alertId === undefined) throw new Error('no alert row');

    const theo = await conversationOf(nora.id, 'Théo');
    const basile = await conversationOf(nora.id, 'Basile');
    const byWord = await triggered(
      nora.id,
      theo,
      { alert: { kind: 'custom', id: alertId }, matchedBy: 'keyword', keyword: 'vidéo perso' },
      '2026-10-27T10:00:00Z',
      true,
    );
    const service = await triggered(
      nora.id,
      basile,
      { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' },
      '2026-10-27T11:00:00Z',
    );
    const doubt = await triggered(
      nora.id,
      basile,
      { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' },
      '2026-10-27T12:00:00Z',
    );
    // Hers alone: Iris's trigger never shows under Nora.
    await triggered(
      iris.id,
      await conversationOf(iris.id, 'Iris fan'),
      { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' },
      '2026-10-27T13:00:00Z',
    );

    const list = async (query: string, headers = owner) => {
      const response = await server.inject({ method: 'GET', url: `/v1/alerts/triggers?${query}`, headers });
      expect(response.statusCode).toBe(200);
      return PageSchema.parse(response.json());
    };

    const all = await list(`creatorId=${nora.id}`);
    expect(all.items.map((item) => item.id)).toEqual([doubt, service, byWord]);
    const [first, second, third] = all.items;
    expect([first?.alertName, first?.reason, first?.pausedAgent, first?.fanDisplayName]).toEqual([
      'Doute sur la personne',
      'Le fan doute de parler vraiment à la créatrice.',
      false,
      'Basile',
    ]);
    expect(second?.alertName).toBe('Demande de service');
    expect([third?.alertGroupId, third?.alertName, third?.reason, third?.pausedAgent]).toEqual([
      groupId,
      'Vidéo perso',
      'Le fan a écrit « vidéo perso », un mot de l’alerte « Vidéo perso ».',
      true,
    ]);
    // Nothing of what he wrote, beyond the word she declared.
    expect(JSON.stringify(all)).not.toContain('texte du fan');

    // Pages by cursor; filters by alert, hers by group or the system's by code.
    const page = await list(`creatorId=${nora.id}&limit=2`);
    expect(page.items).toHaveLength(2);
    const next = await list(`creatorId=${nora.id}&limit=2&cursor=${page.nextCursor ?? ''}`);
    expect([next.items.map((item) => item.id), next.nextCursor]).toEqual([[byWord], null]);
    expect((await list(`creatorId=${nora.id}&alert=${groupId}`)).items.map((item) => item.id)).toEqual([
      byWord,
    ]);
    expect((await list(`creatorId=${nora.id}&alert=service_request`)).items.map((item) => item.id)).toEqual([
      service,
    ]);
    expect((await list(`creatorId=${nora.id}&alert=${newId(CustomAlertGroupIdSchema)}`)).items).toEqual([]);

    // Seen by one, seen for the agency; again changes nothing.
    const seen = (id: string, headers = owner) =>
      server.inject({ method: 'POST', url: `/v1/alerts/triggers/${id}/seen?creatorId=${nora.id}`, headers });
    expect((await seen(service, operator)).statusCode).toBe(204);
    expect((await seen(service)).statusCode).toBe(204);
    expect((await list(`creatorId=${nora.id}&seen=true`)).items.map((item) => item.id)).toEqual([service]);
    expect((await list(`creatorId=${nora.id}&seen=false`)).items.map((item) => item.id)).toEqual([
      doubt,
      byWord,
    ]);
    const unknown = await seen(newId(EventIdSchema));
    expect([unknown.statusCode, ErrorBodySchema.parse(unknown.json()).error.code]).toEqual([
      404,
      'alert_trigger_not_found',
    ]);

    // « Tout marquer comme vu » up to the newest trigger the screen shows: one come since stays unseen.
    const markAll = (payload: Record<string, string>) =>
      server.inject({
        method: 'POST',
        url: '/v1/alerts/triggers/seen',
        headers: owner,
        payload: { creatorId: nora.id, ...payload },
      });
    const upTo = await markAll({ untilId: service });
    expect(MarkAlertTriggersSeenResultSchema.parse(upTo.json())).toEqual({ marked: 1 });
    expect((await list(`creatorId=${nora.id}&seen=false`)).items.map((item) => item.id)).toEqual([doubt]);
    const notHers = await markAll({ untilId: newId(EventIdSchema) });
    expect([notHers.statusCode, ErrorBodySchema.parse(notHers.json()).error.code]).toEqual([
      404,
      'alert_trigger_not_found',
    ]);

    // A cursor that names no trigger of hers is refused, never read as the first page.
    for (const cursor of ['pas-un-curseur', Buffer.from(newId(EventIdSchema)).toString('base64url')]) {
      const refused = await server.inject({
        method: 'GET',
        url: `/v1/alerts/triggers?creatorId=${nora.id}&cursor=${cursor}`,
        headers: owner,
      });
      expect([refused.statusCode, ErrorBodySchema.parse(refused.json()).error.code]).toEqual([
        400,
        'cursor_invalid',
      ]);
    }

    // An archived alert keeps its name in the history.
    await server.inject({ method: 'DELETE', url: `/v1/alerts/${groupId}`, headers: owner });
    expect((await list(`creatorId=${nora.id}&alert=${groupId}`)).items[0]?.alertName).toBe('Vidéo perso');

    // Whoever reads the whole creator, no one else.
    expect((await list(`creatorId=${nora.id}`, operator)).items).toHaveLength(3);
    const outside = await server.inject({
      method: 'GET',
      url: `/v1/alerts/triggers?creatorId=${iris.id}`,
      headers: operator,
    });
    expect(outside.statusCode).toBe(403);
    expect((await seen(doubt, { ...operator })).statusCode).toBe(204);
    expect(
      (await server.inject({ method: 'GET', url: `/v1/alerts/triggers?creatorId=${nora.id}` })).statusCode,
    ).toBe(401);

    // Written on the base's clock, to the microsecond: the newest shown is marked too, and under the screen's filter
    // only the filtered ones are.
    const freshDoubt = await triggered(
      nora.id,
      theo,
      { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' },
      null,
    );
    const freshService = await triggered(
      nora.id,
      theo,
      { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' },
      null,
    );
    const filtered = await markAll({ untilId: freshService, alert: 'identity_doubt' });
    expect(MarkAlertTriggersSeenResultSchema.parse(filtered.json())).toEqual({ marked: 1 });
    expect((await list(`creatorId=${nora.id}&seen=false`)).items.map((item) => item.id)).toEqual([
      freshService,
    ]);
    expect((await list(`creatorId=${nora.id}&seen=true&limit=1`)).items.map((item) => item.id)).toEqual([
      freshDoubt,
    ]);
    // Her alert that never watched her marks nothing.
    const none = await markAll({ untilId: freshService, alert: newId(CustomAlertGroupIdSchema) });
    expect(MarkAlertTriggersSeenResultSchema.parse(none.json())).toEqual({ marked: 0 });
    const rest = await markAll({ untilId: freshService });
    expect(MarkAlertTriggersSeenResultSchema.parse(rest.json())).toEqual({ marked: 1 });
    expect((await list(`creatorId=${nora.id}&seen=false`)).items).toEqual([]);
  });
});
