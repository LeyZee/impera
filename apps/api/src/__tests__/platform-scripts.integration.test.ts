import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

const JobSchema = z.object({ key: z.string(), queue_name: z.string().nullable(), task: z.string() });

/**
 * The import of the native scripts (ADR 0099 § 1 time 2, P6-01) on FakeReveal's invented world, through the owner's
 * « Synchroniser », the real connector, the vault sync and the real tables: four sequences of three steps. The import
 * writes as the service role; the agency reads under her RLS and the team's scopes. Invented data only (ADR 0010).
 */
describe('the native scripts imported from the platform', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let fake: FakeReveal;
  let logger: ReturnType<typeof createLogger>;
  let nora: CreatorId;
  let ines: CreatorId;
  let noraAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  const ids: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };

  const scripts = () => app.modules.scripts;

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return userId;
  }

  async function scenario(events: object[]): Promise<void> {
    const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
    expect(response.statusCode).toBe(200);
  }

  const importOf = (platformAccountId: PlatformAccountId, creatorId: CreatorId, at: Date) =>
    scripts().jobs.importPlatformScripts({ creatorId, platformAccountId }, at);

  const vaultSync = () =>
    app.modules.connectors.jobs.vaultSync(
      { creatorId: nora, platformAccountId: noraAccount, correlationId: 'test' },
      logger,
    );

  const scriptRows = () =>
    test.admin.db.select().from(schema.platformScripts).orderBy(schema.platformScripts.platformScriptRef);

  const ownerView = async (ref: string) =>
    (await scripts().reads.platformScripts(nora, { userId: ids.owner, role: 'owner' }))?.find(
      (view) => view.ref === ref,
    );

  beforeAll(async () => {
    fake = createFakeReveal();
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    logger = createLogger(config);
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorsClock: () => new Date(fake.state().now),
      connectorRegistry: {
        reveal: revealApiConnectors({ fetch: fake.fetch, baseUrl: 'https://reveal.test' }),
      },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    noraAccount = newId(PlatformAccountIdSchema);
    inesAccount = newId(PlatformAccountIdSchema);
    for (const [id, label, accountId] of [
      [nora, 'Nora', noraAccount],
      [ines, 'Ines', inesAccount],
    ] as const) {
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accountId,
        creatorId: id,
        platform: 'reveal',
        handle: `compte_${label.toLowerCase()}`,
        sessionState: 'none',
      });
    }
    // Nora's account reads FakeReveal; Inès's has no session.
    await app.modules.connectors.sessions.store({
      platformAccountId: noraAccount,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
    ids.owner = (
      await createOwner(app.auth, app.db.db, {
        email: 'owner@example.test',
        name: 'Owner',
        password: PASSWORD,
      })
    ).userId;
    for (const teamRole of ['manager', 'chatter'] as const) {
      ids[teamRole] = await account(`${teamRole}@example.test`, { role: 'operator', creatorIds: [nora] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: ids[teamRole],
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    ids.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('queues the import behind the vault sync the owner asks, on the account’s queue, and no cron', async () => {
    const cookie = await signIn(server, 'owner@example.test', PASSWORD);
    const response = await server.inject({
      method: 'POST',
      url: `/v1/creators/${nora}/vault/sync`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    const queued = z.array(JobSchema).parse(
      (
        await test.admin.db.execute(
          sql`select j.key, q.queue_name, t.identifier as task from graphile_worker._private_jobs j
              left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
              join graphile_worker._private_tasks t on t.id = j.task_id
              where j.key in (${`vault:${noraAccount}`}, ${`scripts:${noraAccount}`}) order by j.id`,
        )
      ).rows,
    );
    expect(queued).toEqual([
      { key: `vault:${noraAccount}`, queue_name: `account:${noraAccount}`, task: 'connector.vault_sync' },
      {
        key: `scripts:${noraAccount}`,
        queue_name: `account:${noraAccount}`,
        task: 'scripts.import_platform_scripts',
      },
    ]);
  });

  it('imports each sequence with its steps in the platform’s order and its prices as they are', async () => {
    await vaultSync();
    const run = await importOf(noraAccount, nora, new Date('2026-11-14T10:00:00Z'));
    expect(run).toEqual({ outcome: 'imported', added: 4, changed: 0, gone: 0 });
    // Inès's account has no session: left as it was; an account named with another creator is not read.
    expect(await importOf(inesAccount, ines, new Date('2026-11-14T10:00:00Z'))).toEqual({
      outcome: 'skipped',
    });
    expect(await importOf(noraAccount, ines, new Date('2026-11-14T10:00:00Z'))).toEqual({
      outcome: 'unknown_account',
    });
    const rows = await scriptRows();
    expect(rows.map((row) => [row.platformScriptRef, row.creatorId, row.active])).toEqual([
      ['sequence_1', nora, true],
      ['sequence_2', nora, true],
      ['sequence_3', nora, true],
      ['sequence_4', nora, true],
    ]);
    const [first] = rows;
    if (first === undefined) throw new Error('imported');
    const steps = await test.admin.db
      .select()
      .from(schema.platformScriptSteps)
      .where(eq(schema.platformScriptSteps.platformScriptId, first.id))
      .orderBy(schema.platformScriptSteps.position);
    expect(
      steps.map((step) => [step.position, step.platformStepRef, step.priceMinor, step.currency]),
    ).toEqual([
      [0, 'script_1_1', 500, 'EUR'],
      [1, 'script_1_2', 1_500, 'EUR'],
      [2, 'script_1_3', 3_000, 'EUR'],
    ]);
    const media = await test.admin.db
      .select()
      .from(schema.platformScriptStepMedia)
      .where(sql`${schema.platformScriptStepMedia.platformScriptId} = ${first.id} and position = 1`)
      .orderBy(schema.platformScriptStepMedia.role, schema.platformScriptStepMedia.rank);
    expect(media.map((each) => [each.role, each.platformMediaRef, each.kind])).toEqual([
      ['preview', 'media_09', 'video'],
      ['sold', 'media_02', 'image'],
    ]);
  });

  it('changes nothing when nothing changed, rewrites a changed script, deactivates a gone one', async () => {
    const again = await importOf(noraAccount, nora, new Date('2026-11-14T11:00:00Z'));
    expect(again).toEqual({ outcome: 'imported', added: 0, changed: 0, gone: 0 });
    await scenario([
      { type: 'script_changed', scriptId: 'script_1_3', priceCents: 4_500 },
      { type: 'sequence_removed', sequenceId: 'sequence_2' },
    ]);
    const at = new Date('2026-11-14T12:00:00Z');
    const run = await importOf(noraAccount, nora, at);
    // Sequence 2's steps stay on the platform as loose steps: three scripts of one step each.
    expect(run).toEqual({ outcome: 'imported', added: 3, changed: 1, gone: 1 });
    const rows = await scriptRows();
    const gone = rows.find((row) => row.platformScriptRef === 'sequence_2');
    expect([gone?.active, gone?.deactivatedAt?.toISOString()]).toEqual([false, at.toISOString()]);
    const changed = await ownerView('sequence_1');
    expect(changed?.steps.map((step) => step.priceMinor)).toEqual([500, 1_500, 4_500]);
    // 5 € then 15 €: already more than double; then 45 €, three times 15 € and above 40 €.
    expect(changed?.warnings).toEqual([
      { code: 'price_more_than_double', position: 1 },
      { code: 'price_more_than_double', position: 2 },
      { code: 'price_above_ceiling', position: 2 },
    ]);
    // A gone script keeps its steps: a run or a reward may still name it.
    expect((await ownerView('sequence_2'))?.steps).toHaveLength(3);
  });

  it('says where each media stands in the vault the sync left, and offers no script before its identity', async () => {
    const step = () => ownerView('sequence_1').then((view) => view?.steps[1]);
    // The preview of that step is gone from her vault since (the sync marks it removed, never deletes it).
    await test.admin.db
      .update(schema.mediaPlatformRefs)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(schema.mediaPlatformRefs.platformAccountId, noraAccount),
          eq(schema.mediaPlatformRefs.platformMediaId, 'media_09'),
        ),
      );
    // Listed by the sync, its file not read yet; the preview no longer in her vault.
    expect((await step())?.media).toEqual([
      { ref: 'media_02', kind: 'image', inVault: true, mediaAssetId: null, described: false },
    ]);
    expect((await step())?.previewMedia).toEqual([
      { ref: 'media_09', kind: 'video', inVault: false, mediaAssetId: null, described: false },
    ]);
    expect((await step())?.complete).toBe(false);
    // Its file read and a description validated by a person: the link says so.
    const asset = newId(MediaAssetIdSchema);
    await test.admin.db.insert(schema.mediaAssets).values({
      id: asset,
      creatorId: nora,
      kind: 'image',
      origin: 'creator',
      storageKey: `test/${asset}`,
      mime: 'image/jpeg',
      bytes: 1000,
      sha256: asset,
    });
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: newId(z.uuid()),
      creatorId: nora,
      mediaAssetId: asset,
      vocabularyVersion: '1',
      content: { factualDescription: 'Une photo inventée.' },
      model: 'test',
      promptHash: 'test',
      validatedBy: ids.owner,
      validatedAt: new Date(),
    });
    await test.admin.db
      .update(schema.mediaPlatformRefs)
      .set({ mediaAssetId: asset })
      .where(
        and(
          eq(schema.mediaPlatformRefs.platformAccountId, noraAccount),
          eq(schema.mediaPlatformRefs.platformMediaId, 'media_02'),
        ),
      );
    expect((await step())?.media).toEqual([
      { ref: 'media_02', kind: 'image', inVault: true, mediaAssetId: asset, described: true },
    ]);
    expect(await ownerView('sequence_1')).toMatchObject({
      gaps: ['media_absent', 'media_not_described', 'identity_not_validated'],
      proposable: false,
    });
  });

  it('lets the owner and an active manager of her list read, never a chatter nor her own account', async () => {
    const manager = await scripts().reads.platformScripts(nora, { userId: ids.manager, role: 'operator' });
    expect(manager?.length).toBe(7);
    // A manager reads the creators of his list only, as her vault; the owner reads Inès, who has none of Nora's.
    expect(await scripts().reads.platformScripts(ines, { userId: ids.manager, role: 'operator' })).toBeNull();
    expect(await scripts().reads.platformScripts(ines, { userId: ids.owner, role: 'owner' })).toEqual([]);
    expect(await scripts().reads.platformScripts(nora, { userId: ids.chatter, role: 'operator' })).toBeNull();
    expect(await scripts().reads.platformScripts(nora, { userId: ids.nora, role: 'creator' })).toBeNull();
    // A creator who does not exist answers like a reader who may not read: never her existence.
    expect(
      await scripts().reads.platformScripts(newId(CreatorIdSchema), { userId: ids.owner, role: 'owner' }),
    ).toBeNull();
  });

  it('reads one script of hers out of any person, and none of another creator', async () => {
    const row = (await scriptRows()).find((each) => each.platformScriptRef === 'sequence_1');
    if (row === undefined) throw new Error('imported');
    expect((await scripts().reads.platformScript(nora, row.id))?.steps[0]?.ref).toBe('script_1_1');
    expect(await scripts().reads.platformScript(ines, row.id)).toBeNull();
  });

  it('keeps the application role from writing a native script, even in her tenant', async () => {
    const failure: unknown = await withTenant(app.db.db, nora, (tx) =>
      tx
        .update(schema.platformScripts)
        .set({ name: 'Autre' })
        .where(eq(schema.platformScripts.creatorId, nora)),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const cause = failure instanceof Error && failure.cause instanceof Error ? failure.cause.message : '';
    expect(cause).toMatch(/permission denied/u);
  });
});
