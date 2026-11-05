import {
  CreatorIdSchema,
  creatorNameKey,
  newId,
  PlatformAccountIdSchema,
  SalesFeedImportResultSchema,
  SalesFeedOverviewSchema,
  type CreatorId,
  type SalesFeedImportLineResult,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import {
  createFakeCrm,
  FAKE_CRM_BASE_URL,
  FAKE_CRM_KEY,
  IMPORT_MODELS,
  type FakeCrm,
} from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const IMPORT_URL = '/v1/settings/sales-feeds/reveal/import';
const dismissalUrl = (id: string) => `/v1/settings/sales-feeds/reveal/models/${id}/dismissal`;

/** The import of Reveal's models as creators (CRM-07 a1, ADR 0069) through the real app, against FakeReveal. */
describe('sales feed import (CRM-07)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let ownerId: string;
  /** Has an account with the handle `creatrice_test`, which `model_imp_handle` also has. */
  let handleHolder: CreatorId;
  /** Named « Doublon Test », the name `model_imp_double` would take. */
  let namesake: CreatorId;

  async function api(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
    cookie = owner,
  ) {
    return server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function overview() {
    const answer = await api('GET', '/v1/settings/sales-feeds/reveal');
    expect(answer.statusCode).toBe(200);
    return SalesFeedOverviewSchema.parse(answer.json());
  }

  async function importLines(lines: object[]) {
    const answer = await api('POST', IMPORT_URL, { lines });
    expect(answer.statusCode).toBe(200);
    return SalesFeedImportResultSchema.parse(answer.json());
  }

  const outcomeOf = (lines: readonly SalesFeedImportLineResult[], id: string) =>
    lines.find((line) => line.platformModelId === id);

  async function creatorNamed(name: string) {
    return test.admin.db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.nameKey, creatorNameKey(name)));
  }

  async function insertCreator(name: string): Promise<CreatorId> {
    const id = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id, displayName: name, nameKey: creatorNameKey(name), timezone: 'Europe/Paris' });
    return id;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, new LogSink());
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    // Connected while no account has a model's handle: nothing is linked on its own, every model is to import.
    expect((await api('PUT', '/v1/settings/sales-feeds/reveal/key', { key: FAKE_CRM_KEY })).statusCode).toBe(
      200,
    );
    crm.setModels(IMPORT_MODELS);
    handleHolder = await insertCreator('Titulaire Test');
    await test.admin.db.insert(schema.platformAccounts).values({
      id: newId(PlatformAccountIdSchema),
      creatorId: handleHolder,
      platform: 'reveal',
      handle: 'creatrice_test',
    });
    namesake = await insertCreator('Doublon Test');
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('is the owner’s only', async () => {
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    const line = { platformModelId: 'model_imp_valid', action: { kind: 'create' } };
    expect((await api('POST', IMPORT_URL, { lines: [line] }, operator)).statusCode).toBe(403);
    expect((await api('PUT', dismissalUrl('model_imp_valid'), undefined, operator)).statusCode).toBe(403);
    expect((await api('POST', IMPORT_URL, { lines: [line, line] })).statusCode).toBe(400);
    expect(await creatorNamed('Validée Test')).toEqual([]);
  });

  it('proposes each model without a link, ticked only when validated and active', async () => {
    const { candidates, dismissed } = await overview();
    expect(dismissed).toEqual([]);
    expect(candidates.map((one) => one.model.platformModelId)).toEqual(IMPORT_MODELS.map((m) => m.modelId));
    const byId = new Map(candidates.map((one) => [one.model.platformModelId, one]));
    expect(candidates.filter((one) => one.preselected).map((one) => one.model.platformModelId)).toEqual([
      'model_imp_valid',
      'model_imp_noname',
      'model_imp_handle',
      'model_imp_double',
    ]);
    expect(byId.get('model_imp_changes')?.model.status).toBe('onboarding_changes_requested');
    expect(byId.get('model_imp_unknown')?.model.status).toBe('other');
    expect(byId.get('model_imp_banned')?.model.status).toBe('banned');
    // An https photo is kept; any other address reads as none.
    expect(byId.get('model_imp_valid')?.model.avatarUrl).toBe('https://cdn.example.test/avatars/valide.jpg');
    expect(byId.get('model_imp_noname')?.model.avatarUrl).toBeNull();
    expect(byId.get('model_imp_valid')?.proposal).toEqual({ kind: 'create' });
    expect(byId.get('model_imp_handle')?.proposal).toEqual({
      kind: 'link',
      creatorId: handleHolder,
      creatorDisplayName: 'Titulaire Test',
      match: 'handle',
    });
    expect(byId.get('model_imp_double')?.proposal).toMatchObject({
      kind: 'link',
      creatorId: namesake,
      match: 'name',
    });
  });

  it('sets a model aside and takes it back, each said once in the audit log', async () => {
    const aside = await api('PUT', dismissalUrl('model_imp_refused'));
    expect(aside.statusCode).toBe(200);
    expect((await api('PUT', dismissalUrl('model_imp_refused'))).statusCode).toBe(200);
    const after = SalesFeedOverviewSchema.parse(aside.json());
    expect(after.candidates.some((one) => one.model.platformModelId === 'model_imp_refused')).toBe(false);
    expect(after.dismissed).toMatchObject([
      { model: { platformModelId: 'model_imp_refused', status: 'refused' } },
    ]);

    const back = SalesFeedOverviewSchema.parse(
      (await api('DELETE', dismissalUrl('model_imp_refused'))).json(),
    );
    expect(back.dismissed).toEqual([]);
    expect(back.candidates.some((one) => one.model.platformModelId === 'model_imp_refused')).toBe(true);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, 'reveal:model_imp_refused'));
    expect(audit).toEqual([
      { action: 'sales_feed.model_dismissed', userId: ownerId },
      { action: 'sales_feed.model_restored', userId: ownerId },
    ]);
  });

  it('imports a selection line by line: a refused line never stops the others', async () => {
    // A sale of the model to create, waiting in quarantine: it joins her register at the import.
    crm.sell({ id: 'sale_imp_01', modelId: 'model_imp_valid' });
    await app.modules.connectors.jobs.readSales(createLogger(testConfig(), new LogSink()), 'test', true);
    await api('PUT', dismissalUrl('model_imp_pending'));

    const result = await importLines([
      { platformModelId: 'model_imp_valid', action: { kind: 'create' } },
      { platformModelId: 'model_imp_noname', action: { kind: 'create' } },
      { platformModelId: 'model_imp_handle', action: { kind: 'create' } },
      { platformModelId: 'model_imp_double', action: { kind: 'create' } },
      { platformModelId: 'model_imp_pending', action: { kind: 'create' } },
      { platformModelId: 'model_imp_changes', action: { kind: 'link', creatorId: newId(CreatorIdSchema) } },
      { platformModelId: 'model_not_on_reveal', action: { kind: 'create' } },
    ]);
    expect(
      result.lines.map((line) => [
        line.platformModelId,
        line.outcome === 'refused' ? line.reason : line.outcome,
      ]),
    ).toEqual([
      ['model_imp_valid', 'created'],
      ['model_imp_noname', 'created'],
      ['model_imp_handle', 'handle_taken'],
      ['model_imp_double', 'name_taken'],
      ['model_imp_pending', 'created'],
      ['model_imp_changes', 'creator_not_found'],
      ['model_not_on_reveal', 'not_listed'],
    ]);

    // Her name from Reveal (its handle when empty), Paris until changed, and nothing else: no persona, no invitation.
    const [valid] = await creatorNamed('Validée Test');
    expect(valid).toMatchObject({ timezone: 'Europe/Paris', avatarKey: null, agentHours: null });
    expect(await creatorNamed('sansnom_test')).toHaveLength(1);
    const validId = CreatorIdSchema.parse(valid?.id);
    expect(outcomeOf(result.lines, 'model_imp_valid')).toMatchObject({ creatorId: validId });
    const [account] = await test.admin.db
      .select()
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.creatorId, validId));
    expect(account).toMatchObject({ platform: 'reveal', handle: 'valide_test', sessionState: 'none' });
    const [link] = await test.admin.db
      .select()
      .from(schema.salesFeedModels)
      .where(eq(schema.salesFeedModels.platformModelId, 'model_imp_valid'));
    expect(link).toMatchObject({ creatorId: validId, platformAccountId: account?.id, linkedBy: ownerId });
    const [sale] = await test.admin.db
      .select({ creatorId: schema.platformSales.creatorId })
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_imp_01'));
    expect(sale?.creatorId).toBe(validId);
    expect(
      await test.admin.db
        .select()
        .from(schema.personaVersions)
        .where(eq(schema.personaVersions.creatorId, validId)),
    ).toEqual([]);
    // Imported once dismissed: no longer set aside. Refused lines wrote nothing.
    expect(await test.admin.db.select().from(schema.salesFeedModelDismissals)).toEqual([]);
    expect(await creatorNamed('Pseudo Pris')).toEqual([]);
    expect(await creatorNamed('Retouches Test')).toEqual([]);

    const after = result.overview.candidates.map((one) => one.model.platformModelId);
    expect(after).not.toContain('model_imp_valid');
    expect(after).toContain('model_imp_double');
  });

  it('links to an existing creator: her account with the handle, or a new one of hers', async () => {
    const result = await importLines([
      { platformModelId: 'model_imp_handle', action: { kind: 'link', creatorId: handleHolder } },
      { platformModelId: 'model_imp_double', action: { kind: 'link', creatorId: namesake } },
      { platformModelId: 'model_imp_changes', action: { kind: 'link', creatorId: namesake } },
    ]);
    expect(result.lines.map((line) => line.outcome)).toEqual(['linked', 'linked', 'linked']);
    const accounts = await test.admin.db
      .select({ handle: schema.platformAccounts.handle })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.creatorId, handleHolder));
    expect(accounts).toEqual([{ handle: 'creatrice_test' }]);
    const hers = await test.admin.db
      .select({ handle: schema.platformAccounts.handle })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.creatorId, namesake))
      .orderBy(schema.platformAccounts.handle);
    expect(hers).toEqual([{ handle: 'doublon_reveal' }, { handle: 'retouches_test' }]);
  });

  it('a replay or a double click creates no second creator', async () => {
    const line = { platformModelId: 'model_imp_unknown', action: { kind: 'create' } };
    const [first, second] = await Promise.all([importLines([line]), importLines([line])]);
    const outcomes = [first.lines[0]?.outcome, second.lines[0]?.outcome].sort();
    expect(outcomes).toEqual(['already_linked', 'created']);
    expect(await creatorNamed('Inconnu Test')).toHaveLength(1);
    const again = await importLines([{ platformModelId: 'model_imp_valid', action: { kind: 'create' } }]);
    expect(again.lines).toMatchObject([{ outcome: 'already_linked' }]);
    expect(await creatorNamed('Validée Test')).toHaveLength(1);
    const imported = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'sales_feed.model_imported'),
          eq(schema.auditLog.entityId, 'reveal:model_imp_unknown'),
        ),
      );
    expect(imported).toHaveLength(1);
    // The model's id and what it became: no subscribers, prices or amounts.
    expect(Object.keys(imported[0]?.details ?? {}).sort()).toEqual([
      'created',
      'creatorId',
      'platform',
      'platformAccountId',
      'platformModelId',
    ]);
  });

  it('imports nothing when the list does not answer', async () => {
    crm.rateLimit(1, 30);
    const answer = await api('POST', IMPORT_URL, {
      lines: [{ platformModelId: 'model_imp_banned', action: { kind: 'create' } }],
    });
    expect(answer.statusCode).toBe(503);
    expect(answer.json()).toMatchObject({ error: { code: 'sales_feed_list_unavailable' } });
    expect(await creatorNamed('Bannie Test')).toEqual([]);
  });
});
