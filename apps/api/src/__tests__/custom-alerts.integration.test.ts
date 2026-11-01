import {
  AlertsViewSchema,
  CustomAlertGroupSchema,
  newId,
  CustomAlertGroupIdSchema,
  SystemAlertSettingSchema,
  type CreateCustomAlertBody,
} from '@nirvana/contracts';
import { eq, schema, withTenant } from '@nirvana/db';
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

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const errorOf = (response: { readonly statusCode: number; json: () => unknown }) => [
  response.statusCode,
  ErrorBodySchema.parse(response.json()).error.code,
];

describe('alerts (P4-01, /v1/alerts)', () => {
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

  it('writes one row per creator, each under her RLS alone, and shows them as one alert', async () => {
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
    const body: CreateCustomAlertBody = {
      groupId,
      name: 'Vidéo perso',
      phrase: 'Il demande une vidéo faite pour lui',
      keywords: ['vidéo perso', 'custom'],
      pausesAgent: false,
      notify: true,
      creators: [
        { creatorId: nora.id, enabled: true },
        { creatorId: iris.id, enabled: false },
      ],
    };
    const post = (headers: Record<string, string>, payload: object) =>
      server.inject({ method: 'POST', url: '/v1/alerts', headers, payload });
    const view = async () => {
      const response = await server.inject({ method: 'GET', url: '/v1/alerts', headers: owner });
      expect(response.statusCode).toBe(200);
      return AlertsViewSchema.parse(response.json());
    };

    expect((await server.inject({ method: 'GET', url: '/v1/alerts' })).statusCode).toBe(401);
    expect((await post(operator, body)).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/v1/alerts', headers: operator })).statusCode).toBe(
      403,
    );

    const created = await post(owner, body);
    expect(created.statusCode).toBe(201);
    const alert = CustomAlertGroupSchema.parse(created.json());
    expect(alert.groupId).toBe(groupId);
    // Her creators by name: Iris, then Nora.
    expect(alert.creators.map((c) => [c.creatorId, c.enabled])).toEqual([
      [iris.id, false],
      [nora.id, true],
    ]);
    // The same alert sent again is written once; the same id with other values is refused.
    const replay = await post(owner, { ...body, creators: [...body.creators].reverse() });
    expect(replay.statusCode).toBe(200);
    expect(CustomAlertGroupSchema.parse(replay.json())).toEqual(alert);
    expect(errorOf(await post(owner, { ...body, name: 'Autre' }))).toEqual([409, 'custom_alert_conflict']);

    // RLS: each creator reads her own row, never the other's.
    const rowsOf = async (creatorId: string) =>
      withTenant(app.db.db, creatorId, (tx) =>
        tx.select({ creatorId: schema.customAlerts.creatorId }).from(schema.customAlerts),
      );
    expect(await rowsOf(nora.id)).toEqual([{ creatorId: nora.id }]);
    expect(await rowsOf(iris.id)).toEqual([{ creatorId: iris.id }]);
    // What the agent reads: her alerts that are on.
    expect((await app.modules.alerts.store.activeFor(nora.id)).map((a) => a.name)).toEqual(['Vidéo perso']);
    expect(await app.modules.alerts.store.activeFor(iris.id)).toEqual([]);
    expect((await view()).custom).toEqual([alert]);

    // Replace: Iris left out (archived), the words changed on Nora.
    const replaced = await server.inject({
      method: 'PUT',
      url: `/v1/alerts/${groupId}`,
      headers: owner,
      payload: { ...body, keywords: ['custom'], creators: [{ creatorId: nora.id, enabled: true }] },
    });
    expect(replaced.statusCode).toBe(200);
    const after = CustomAlertGroupSchema.parse(replaced.json());
    expect([after.keywords, after.creators.map((c) => c.creatorId)]).toEqual([['custom'], [nora.id]]);
    const [irisRow] = await test.admin.db
      .select({ archivedAt: schema.customAlerts.archivedAt })
      .from(schema.customAlerts)
      .where(eq(schema.customAlerts.creatorId, iris.id));
    expect(irisRow?.archivedAt).toBeInstanceOf(Date);
    // A replay of the creation no longer matches what is stored.
    expect(errorOf(await post(owner, body))).toEqual([409, 'custom_alert_conflict']);

    // Iris back: her row again, not a second one.
    const withoutId: Omit<CreateCustomAlertBody, 'groupId'> = {
      name: body.name,
      phrase: body.phrase,
      keywords: body.keywords,
      pausesAgent: body.pausesAgent,
      notify: body.notify,
      creators: body.creators,
    };
    const back = await server.inject({
      method: 'PUT',
      url: `/v1/alerts/${groupId}`,
      headers: owner,
      payload: withoutId,
    });
    expect(CustomAlertGroupSchema.parse(back.json()).creators.map((c) => c.alertId)).toEqual(
      alert.creators.map((c) => c.alertId),
    );

    // Archived, never deleted: gone from the screen, still in the table for the history.
    expect(
      (await server.inject({ method: 'DELETE', url: `/v1/alerts/${groupId}`, headers: owner })).statusCode,
    ).toBe(204);
    expect((await view()).custom).toEqual([]);
    expect(
      await test.admin.db
        .select({ id: schema.customAlerts.id })
        .from(schema.customAlerts)
        .where(eq(schema.customAlerts.groupId, groupId)),
    ).toHaveLength(2);
    expect(
      errorOf(await server.inject({ method: 'DELETE', url: `/v1/alerts/${groupId}`, headers: owner })),
    ).toEqual([404, 'custom_alert_not_found']);
    expect(errorOf(await post(owner, body))).toEqual([409, 'custom_alert_conflict']);

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, groupId));
    expect(audit.map((a) => a.action)).toEqual([
      'custom_alert.create',
      'custom_alert.update',
      'custom_alert.update',
      'custom_alert.archive',
    ]);
  });

  it('switches a system alert per creator, on without a row, and never her words', async () => {
    const basile = await app.modules.persona.creators.create({ displayName: 'Basile' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const put = (code: string, enabled: boolean) =>
      server.inject({
        method: 'PUT',
        url: `/v1/alerts/system/${code}`,
        headers: owner,
        payload: { creators: [{ creatorId: basile.id, enabled }] },
      });
    const enabledFor = (setting: { creators: { creatorId: string; enabled: boolean }[] }) =>
      setting.creators.find((c) => c.creatorId === basile.id)?.enabled;

    const before = AlertsViewSchema.parse(
      (await server.inject({ method: 'GET', url: '/v1/alerts', headers: owner })).json(),
    ).system;
    expect(before.map((s) => [s.code, s.locked, enabledFor(s)])).toEqual([
      ['keyword', true, true],
      ['service_request', false, true],
      ['identity_doubt', false, true],
    ]);

    const off = await put('service_request', false);
    expect(off.statusCode).toBe(200);
    expect(enabledFor(SystemAlertSettingSchema.parse(off.json()))).toBe(false);
    expect([...(await app.modules.alerts.store.systemOn(basile.id))]).toEqual(['keyword', 'identity_doubt']);
    expect(enabledFor(SystemAlertSettingSchema.parse((await put('service_request', true)).json()))).toBe(
      true,
    );

    expect(errorOf(await put('keyword', false))).toEqual([422, 'system_alert_locked_unprocessable']);
    expect((await put('other', false)).statusCode).toBe(400);
  });

  it('refuses an alert with neither phrase nor word, and a creator that does not exist', async () => {
    const nora = await app.modules.persona.creators.create({ displayName: 'Nora V.' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const base = {
      groupId: newId(CustomAlertGroupIdSchema),
      name: 'Rien',
      phrase: null,
      keywords: [],
      pausesAgent: true,
      notify: false,
      creators: [{ creatorId: nora.id, enabled: true }],
    };
    const post = (payload: object) =>
      server.inject({ method: 'POST', url: '/v1/alerts', headers: owner, payload });
    expect((await post(base)).statusCode).toBe(400);
    expect(
      errorOf(
        await post({
          ...base,
          keywords: ['appel'],
          creators: [{ creatorId: '01900000-0000-7000-8000-000000000000', enabled: true }],
        }),
      ),
    ).toEqual([400, 'alert_creator_invalid']);
    const unknownGroup = await server.inject({
      method: 'PUT',
      url: `/v1/alerts/${newId(CustomAlertGroupIdSchema)}`,
      headers: owner,
      payload: { ...base, keywords: ['appel'] },
    });
    expect(errorOf(unknownGroup)).toEqual([404, 'custom_alert_not_found']);
  });

  it('refuses a second active alert of the same name on a creator, case, accents and spaces aside', async () => {
    const lina = await app.modules.persona.creators.create({ displayName: 'Lina N.' });
    const maya = await app.modules.persona.creators.create({ displayName: 'Maya N.' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const alertOn = (name: string, creators: { creatorId: string; enabled: boolean }[]) => ({
      groupId: newId(CustomAlertGroupIdSchema),
      name,
      phrase: null,
      keywords: ['appel'],
      pausesAgent: false,
      notify: false,
      creators,
    });
    const post = (payload: object) =>
      server.inject({ method: 'POST', url: '/v1/alerts', headers: owner, payload });
    const put = (groupId: string, payload: object) =>
      server.inject({ method: 'PUT', url: `/v1/alerts/${groupId}`, headers: owner, payload });

    const first = alertOn('Appel vidéo', [{ creatorId: lina.id, enabled: true }]);
    expect((await post(first)).statusCode).toBe(201);
    // Same name on the same creator, written otherwise: refused, nothing written.
    const twin = alertOn('  APPEL VIDEO ', [
      { creatorId: maya.id, enabled: true },
      { creatorId: lina.id, enabled: true },
    ]);
    const refused = await post(twin);
    expect(errorOf(refused)).toEqual([409, 'custom_alert_name_conflict']);
    expect(refused.json()).toMatchObject({
      error: { message: 'Une alerte active porte déjà ce nom', details: { creatorIds: [lina.id] } },
    });
    expect(
      await test.admin.db
        .select()
        .from(schema.customAlerts)
        .where(eq(schema.customAlerts.groupId, twin.groupId)),
    ).toEqual([]);
    // Another creator, or the same one with the twin switched off: the name is free.
    expect((await post({ ...twin, creators: [{ creatorId: maya.id, enabled: true }] })).statusCode).toBe(201);
    const off = alertOn('Appel Vidéo', [{ creatorId: lina.id, enabled: false }]);
    expect((await post(off)).statusCode).toBe(201);
    // Switching it on would make two: refused; the first switched off, it goes through.
    expect(
      errorOf(await put(off.groupId, { ...off, creators: [{ creatorId: lina.id, enabled: true }] })),
    ).toEqual([409, 'custom_alert_name_conflict']);
    expect(
      (await put(first.groupId, { ...first, creators: [{ creatorId: lina.id, enabled: false }] })).statusCode,
    ).toBe(200);
    expect(
      (await put(off.groupId, { ...off, creators: [{ creatorId: lina.id, enabled: true }] })).statusCode,
    ).toBe(200);
    // An alert keeps its own name when replaced, and an archived one frees it.
    expect(
      (
        await put(off.groupId, {
          ...off,
          keywords: ['visio'],
          creators: [{ creatorId: lina.id, enabled: true }],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: 'DELETE', url: `/v1/alerts/${off.groupId}`, headers: owner }))
        .statusCode,
    ).toBe(204);
    expect((await post(alertOn('appel vidéo', [{ creatorId: lina.id, enabled: true }]))).statusCode).toBe(
      201,
    );
  });

  it('writes one of two alerts of the same name posted at once', async () => {
    const zoe = await app.modules.persona.creators.create({ displayName: 'Zoé N.' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const body = () => ({
      groupId: newId(CustomAlertGroupIdSchema),
      name: 'Rendez-vous',
      phrase: null,
      keywords: ['rdv'],
      pausesAgent: false,
      notify: false,
      creators: [{ creatorId: zoe.id, enabled: true }],
    });
    const answers = await Promise.all(
      [body(), body()].map((payload) =>
        server.inject({ method: 'POST', url: '/v1/alerts', headers: owner, payload }),
      ),
    );
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([201, 409]);
    expect((await app.modules.alerts.store.activeFor(zoe.id)).map((alert) => alert.name)).toEqual([
      'Rendez-vous',
    ]);
  });

  it('writes and audits once the same alert posted five times at once, the replays unaudited (recette 28/10)', async () => {
    const lea = await app.modules.persona.creators.create({ displayName: 'Léa N.' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const groupId = newId(CustomAlertGroupIdSchema);
    const payload = {
      groupId,
      name: 'Double envoi',
      phrase: null,
      keywords: ['double'],
      pausesAgent: false,
      notify: false,
      creators: [{ creatorId: lea.id, enabled: true }],
    };
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => payload).map((body) =>
        server.inject({ method: 'POST', url: '/v1/alerts', headers: owner, payload: body }),
      ),
    );
    // Without the writers' lock, four of them were created and audited, the fifth a 500.
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    const [first, ...replays] = answers.map((answer) => CustomAlertGroupSchema.parse(answer.json()));
    for (const replay of replays) expect(replay).toEqual(first);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, groupId));
    expect(audit).toEqual([{ action: 'custom_alert.create' }]);
    const rows = await test.admin.db
      .select({ id: schema.customAlerts.id })
      .from(schema.customAlerts)
      .where(eq(schema.customAlerts.groupId, groupId));
    expect(rows).toHaveLength(1);
  });

  it('keeps archived an alert changed at the same moment, on every creator', async () => {
    const ines = await app.modules.persona.creators.create({ displayName: 'Inès R.' });
    const lou = await app.modules.persona.creators.create({ displayName: 'Lou R.' });
    const owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    const fields = {
      phrase: null,
      keywords: ['adresse'],
      pausesAgent: false,
      notify: false,
    };
    for (let round = 0; round < 8; round += 1) {
      const groupId = newId(CustomAlertGroupIdSchema);
      const name = `Adresse ${String(round)}`;
      const created = await server.inject({
        method: 'POST',
        url: '/v1/alerts',
        headers: owner,
        payload: { groupId, name, ...fields, creators: [{ creatorId: ines.id, enabled: true }] },
      });
      expect(created.statusCode).toBe(201);
      // The change also puts the alert on a second creator: an insert, besides the update of the first row.
      const [changed, archived] = await Promise.all([
        server.inject({
          method: 'PUT',
          url: `/v1/alerts/${groupId}`,
          headers: owner,
          payload: {
            name,
            ...fields,
            keywords: ['adresse', 'rue'],
            creators: [
              { creatorId: ines.id, enabled: true },
              { creatorId: lou.id, enabled: true },
            ],
          },
        }),
        server.inject({ method: 'DELETE', url: `/v1/alerts/${groupId}`, headers: owner }),
      ]);
      expect(archived.statusCode).toBe(204);
      const rows = await test.admin.db
        .select({ archivedAt: schema.customAlerts.archivedAt })
        .from(schema.customAlerts)
        .where(eq(schema.customAlerts.groupId, groupId));
      const audit = await test.admin.db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.entityId, groupId));
      if (changed.statusCode === 200) {
        // Both were written, so the change went first and the archive after it: archived on every creator, the
        // second one included, never brought back by the change.
        expect(audit.map((a) => a.action).toSorted()).toEqual([
          'custom_alert.archive',
          'custom_alert.create',
          'custom_alert.update',
        ]);
        expect(rows.every((row) => row.archivedAt !== null)).toBe(true);
      } else {
        // The archive came first: the change finds no alert to change.
        expect(errorOf(changed)).toEqual([404, 'custom_alert_not_found']);
        expect(rows.every((row) => row.archivedAt !== null)).toBe(true);
      }
    }
  });
});
