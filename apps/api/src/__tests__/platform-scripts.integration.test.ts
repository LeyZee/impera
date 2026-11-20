import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
  ok,
  PLATFORM_SCRIPT_NAME_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  PLATFORM_SCRIPT_STEPS_MAX,
  PlatformAccountIdSchema,
  PlatformScriptViewSchema,
  PreparedScriptContentSchema,
  PreparedScriptIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type DescriptionReviewReason,
  type DropMediaDescription,
  type PlatformAccountId,
} from '@impera/contracts';
import { and, eq, schema, sql, withCreatorAccount, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway, ScriptIdentityInput } from '@impera/llm';
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

/** What the fixed brain was told, in order. */
const told: ScriptIdentityInput[] = [];
const IDENTITY = {
  ambiance: 'complice et taquine',
  energy: 'rising' as const,
  setting: 'un salon inventé',
  useWhen: ['il raconte sa soirée'],
  avoidWhen: [],
};
const identityBrain: Pick<LlmGateway, 'identifyScript' | 'promptHashes'> = {
  promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1', scriptIdentity: 'identity-v1' },
  identifyScript: (input) => {
    told.push(input);
    return Promise.resolve(
      ok({
        output: IDENTITY,
        meta: {
          provider: 'xai',
          model: 'brain-test',
          isFallback: false,
          latencyMs: 1,
          promptHash: 'identity-v1',
        },
      }),
    );
  },
};

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
    scripts().jobs.importPlatformScripts({ creatorId, platformAccountId, correlationId: 'test' }, at);

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
      scriptIdentityBrain: identityBrain,
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
    expect(run).toEqual({ outcome: 'imported', added: 4, changed: 0, gone: 0, refused: 0, recognised: 0 });
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
    expect(again).toEqual({ outcome: 'imported', added: 0, changed: 0, gone: 0, refused: 0, recognised: 0 });
    await scenario([
      { type: 'script_changed', scriptId: 'script_1_3', priceCents: 4_500 },
      { type: 'sequence_removed', sequenceId: 'sequence_2' },
    ]);
    const at = new Date('2026-11-14T12:00:00Z');
    const run = await importOf(noraAccount, nora, at);
    // Sequence 2's steps stay on the platform as loose steps: three scripts of one step each.
    expect(run).toEqual({ outcome: 'imported', added: 3, changed: 1, gone: 1, refused: 0, recognised: 0 });
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
    // Nothing of her vault is in the CRM before the owner ticks it (ADR 0145 § 5): the script says so.
    expect((await ownerView('sequence_1'))?.gaps).toContain('media_not_imported');
    expect((await step())?.media).toMatchObject([{ ref: 'media_02', inVault: true, imported: false }]);
    // Every folder of her vault ticked whole, the root's included, as the owner does on the vault's screen.
    await test.admin.db.execute(sql`
      insert into vault_import_choices (id, creator_id, platform_account_id, scope, folder_ref, imported, chosen_by)
      select gen_random_uuid(), r.creator_id, r.platform_account_id, 'folder', r.folder_ref, true, ${ids.owner}
        from (select distinct creator_id, platform_account_id, folder_ref from media_platform_refs
               where platform_account_id = ${noraAccount}) r`);
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
      {
        ref: 'media_02',
        kind: 'image',
        inVault: true,
        imported: true,
        mediaAssetId: null,
        described: false,
        description: null,
      },
    ]);
    expect((await step())?.previewMedia).toEqual([
      {
        ref: 'media_09',
        kind: 'video',
        inVault: false,
        imported: false,
        mediaAssetId: null,
        described: false,
        description: null,
      },
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
    const validated = newId(z.uuid());
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: validated,
      creatorId: nora,
      mediaAssetId: asset,
      vocabularyVersion: '1',
      content: { detailed: 'Une photo inventée.' },
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
      {
        ref: 'media_02',
        kind: 'image',
        inVault: true,
        imported: true,
        mediaAssetId: asset,
        described: true,
        description: { id: validated, detailed: 'Une photo inventée.', reviewReasons: [], validated: true },
      },
    ]);
    expect(await ownerView('sequence_1')).toMatchObject({
      gaps: ['media_absent', 'media_not_described', 'identity_not_validated'],
      proposable: false,
    });
    // A manager of her list reads the same links in his own transaction, under her RLS; a job as the service role.
    const managerView = (
      await scripts().reads.platformScripts(nora, { userId: ids.manager, role: 'operator' })
    )?.find((each) => each.ref === 'sequence_1');
    expect(managerView?.steps[1]?.media).toEqual((await step())?.media);
    if (managerView === undefined) throw new Error('read');
    expect((await scripts().forJobs.platformScript(nora, managerView.id))?.steps[1]?.previewMedia).toEqual(
      (await step())?.previewMedia,
    );
  });

  /** Invented (ADR 0010): a vision's description of a vault media, as `media.describe_vault` writes it. */
  const VISION: DropMediaDescription = {
    vocabularyVersion: '1.0.0',
    kind: 'image',
    detailed: 'Une photo inventée, à valider.',
    factualDescription: 'Une photo inventée.',
    durationS: null,
    segments: [],
    intensity: 'soft',
    anatomyVisible: [],
    castMode: 'solo',
    mood: [],
    setting: null,
    audio: null,
    textVisible: null,
    quality: 'good',
    confidenceLow: false,
    notVisible: false,
    flags: [],
  };

  /** A vault media of hers read and described by the vision, waiting for a person; gives the description's id. */
  async function seen(ref: string, detailed: string, reasons: DescriptionReviewReason[]): Promise<string> {
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
    const description = newId(z.uuid());
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: description,
      creatorId: nora,
      mediaAssetId: asset,
      vocabularyVersion: '1.0.0',
      content: { ...VISION, detailed },
      model: 'vision-test',
      promptHash: 'drop-v1',
      reviewReasons: reasons,
    });
    await test.admin.db
      .update(schema.mediaPlatformRefs)
      .set({ mediaAssetId: asset })
      .where(
        and(
          eq(schema.mediaPlatformRefs.platformAccountId, noraAccount),
          eq(schema.mediaPlatformRefs.platformMediaId, ref),
        ),
      );
    return description;
  }

  it('lets the team validate the descriptions of a script’s media as shown, or rewrite one, then asks its identity', async () => {
    const before = await ownerView('sequence_1');
    if (before === undefined) throw new Error('imported');
    // The vision's descriptions of its first and last photos, waiting for a person; the last with a reason.
    const first = await seen('media_01', 'Une photo inventée, à valider.', []);
    const unsure = await seen('media_03', 'Une photo inventée, pas sûre.', ['unsure']);
    const shown = await ownerView('sequence_1');
    expect(shown?.steps[0]?.media[0]).toMatchObject({
      described: false,
      description: {
        id: first,
        detailed: 'Une photo inventée, à valider.',
        reviewReasons: [],
        validated: false,
      },
    });
    expect(shown?.steps[2]?.media[0]?.description).toMatchObject({ id: unsure, reviewReasons: ['unsure'] });
    const base = `/v1/creators/${nora}/platform-scripts/${before.id}/descriptions`;
    const code = (response: { json: () => unknown }) =>
      z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;
    // A chatter, her own account, a creator not on his list: never.
    expect((await post('chatter', `${base}/validate`, { descriptionIds: [first] })).statusCode).toBe(404);
    expect((await post('nora', `${base}/validate`, { descriptionIds: [first] })).statusCode).toBe(403);
    expect(
      (
        await post('manager', `/v1/creators/${ines}/platform-scripts/${before.id}/descriptions/validate`, {
          descriptionIds: [first],
        })
      ).statusCode,
    ).toBe(403);
    // One that waits for a reason never goes with others; one that is not of this script is stale.
    const together = await post('owner', `${base}/validate`, { descriptionIds: [first, unsure] });
    expect([together.statusCode, code(together)]).toEqual([
      409,
      'platform_script_description_alone_conflict',
    ]);
    const other = await post('owner', `${base}/validate`, { descriptionIds: [newId(z.uuid())] });
    expect([other.statusCode, code(other)]).toEqual([409, 'platform_script_description_stale_conflict']);
    // Validated as shown by a manager of her list; again, nothing is written twice.
    const validated = await post('manager', `${base}/validate`, { descriptionIds: [first] });
    expect(validated.statusCode).toBe(200);
    expect(PlatformScriptViewSchema.parse(validated.json()).steps[0]?.media[0]).toMatchObject({
      described: true,
      description: { id: first, validated: true },
    });
    expect((await post('owner', `${base}/validate`, { descriptionIds: [first] })).statusCode).toBe(200);
    // The unsure one rewritten by hand: a new row, validated by whoever writes it; the vision's stays as it was.
    const corrected = await post('owner', `${base}/correct`, {
      descriptionId: unsure,
      detailed: '  Une photo inventée, relue par l’agence.  ',
    });
    expect(corrected.statusCode).toBe(200);
    const after = PlatformScriptViewSchema.parse(corrected.json()).steps[2]?.media[0];
    expect(after).toMatchObject({
      described: true,
      description: {
        detailed: 'Une photo inventée, relue par l’agence.',
        reviewReasons: [],
        validated: true,
      },
    });
    expect(after?.description?.id).not.toBe(unsure);
    const [vision] = await test.admin.db
      .select()
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.id, unsure));
    expect(vision).toMatchObject({ validatedAt: null, author: 'sense' });
    // The row corrected is no longer the one shown: a second correction of it is stale.
    const late = await post('owner', `${base}/correct`, { descriptionId: unsure, detailed: 'Trop tard.' });
    expect([late.statusCode, code(late)]).toEqual([409, 'platform_script_description_stale_conflict']);
    expect((await post('owner', `${base}/correct`, { descriptionId: first, detailed: ' ' })).statusCode).toBe(
      400,
    );
    // The trail says who lifted which reason, the text never.
    const audit = await test.admin.db
      .select({
        userId: schema.auditLog.userId,
        action: schema.auditLog.action,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, before.id))
      .orderBy(schema.auditLog.createdAt);
    expect(audit).toEqual([
      {
        userId: ids.manager,
        action: 'media_description.validated',
        details: { descriptionIds: [first], lifted: [], creatorId: nora },
      },
      {
        userId: ids.owner,
        action: 'media_description.corrected',
        details: {
          from: unsure,
          to: after?.description?.id,
          lifted: [{ descriptionId: unsure, reasons: ['unsure'] }],
          creatorId: nora,
        },
      },
    ]);
    // Its identity is asked again from what is validated now: one waiting job for the script.
    const jobs = z.array(z.object({ key: z.string() })).parse(
      (
        await test.admin.db.execute(
          sql`select j.key from graphile_worker._private_jobs j
                join graphile_worker._private_tasks t on t.id = j.task_id
                where t.identifier = 'scripts.identify_platform_script' and j.key = ${`scripts.identify_platform_script:${before.id}`}`,
        )
      ).rows,
    );
    expect(jobs).toHaveLength(1);
  });

  it('lets the owner and an active manager of her list read, never a chatter nor her own account', async () => {
    const manager = await scripts().reads.platformScripts(nora, { userId: ids.manager, role: 'operator' });
    expect(manager?.length).toBe(7);
    // A manager reads the creators of his list only, as her vault; the owner reads Inès, who has none of Nora's.
    expect(await scripts().reads.platformScripts(ines, { userId: ids.manager, role: 'operator' })).toBeNull();
    expect(await scripts().reads.platformScripts(ines, { userId: ids.owner, role: 'owner' })).toEqual([]);
    expect(await scripts().reads.platformScripts(nora, { userId: ids.chatter, role: 'operator' })).toBeNull();
    expect(await scripts().reads.platformScripts(nora, { userId: ids.nora, role: 'creator' })).toBeNull();
    // Closed to her account by the base too, not only by the reads' role check (`creator_closed`).
    const hers = await withCreatorAccount(app.db.db, ids.nora, async (tx) => [
      ...(await tx.select().from(schema.platformScripts)),
      ...(await tx.select().from(schema.platformScriptSteps)),
      ...(await tx.select().from(schema.platformScriptStepMedia)),
    ]);
    expect(hers).toEqual([]);
    // A creator who does not exist answers like a reader who may not read: never her existence.
    expect(
      await scripts().reads.platformScripts(newId(CreatorIdSchema), { userId: ids.owner, role: 'owner' }),
    ).toBeNull();
  });

  it('reads one script of hers out of any person, and none of another creator', async () => {
    const row = (await scriptRows()).find((each) => each.platformScriptRef === 'sequence_1');
    if (row === undefined) throw new Error('imported');
    expect((await scripts().forJobs.platformScript(nora, row.id))?.steps[0]?.ref).toBe('script_1_1');
    expect(await scripts().forJobs.platformScript(ines, row.id)).toBeNull();
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

  it('holds the bounds in the base too: a name, a text or a step past them is refused, even to the service role', async () => {
    const row = (await scriptRows()).find((each) => each.platformScriptRef === 'sequence_1');
    if (row === undefined) throw new Error('imported');
    const refusal = (write: Promise<unknown>) =>
      write.then(
        () => '',
        (error: unknown) =>
          error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error),
      );
    expect(
      await refusal(
        test.service.db
          .update(schema.platformScripts)
          .set({ name: 'a'.repeat(PLATFORM_SCRIPT_NAME_MAX + 1) })
          .where(eq(schema.platformScripts.id, row.id)),
      ),
    ).toMatch(/platform_scripts_text_check/u);
    expect(
      await refusal(
        test.service.db.insert(schema.platformScriptSteps).values({
          platformScriptId: row.id,
          creatorId: nora,
          position: PLATFORM_SCRIPT_STEPS_MAX,
          platformIndex: 0,
          platformStepRef: 'step_inventee',
          name: 'Étape',
          text: 'Texte',
          priceMinor: 0,
          currency: 'EUR',
        }),
      ),
    ).toMatch(/platform_script_steps_position_check/u);
    expect(
      await refusal(
        test.service.db.insert(schema.platformScriptSteps).values({
          platformScriptId: row.id,
          creatorId: nora,
          position: PLATFORM_SCRIPT_STEPS_MAX - 1,
          platformIndex: 0,
          platformStepRef: 'step_inventee',
          name: 'Étape',
          text: 'c'.repeat(PLATFORM_SCRIPT_STEP_TEXT_MAX + 1),
          priceMinor: 0,
          currency: 'EUR',
        }),
      ),
    ).toMatch(/platform_script_steps_text_check/u);
  });

  /** A vault media of hers read and described, its description validated by the owner; gives the description's id. */
  async function described(ref: string, kind: 'image' | 'video', detailed: string): Promise<string> {
    const asset = newId(MediaAssetIdSchema);
    await test.admin.db.insert(schema.mediaAssets).values({
      id: asset,
      creatorId: nora,
      kind,
      origin: 'creator',
      storageKey: `test/${asset}`,
      mime: kind === 'image' ? 'image/jpeg' : 'video/mp4',
      bytes: 1000,
      sha256: asset,
    });
    const description = newId(z.uuid());
    await test.admin.db.insert(schema.mediaDescriptions).values({
      id: description,
      creatorId: nora,
      mediaAssetId: asset,
      vocabularyVersion: '1',
      content: { detailed },
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
          eq(schema.mediaPlatformRefs.platformMediaId, ref),
        ),
      );
    return description;
  }

  const identify = (ref: string) =>
    ownerView(ref).then((view) => {
      if (view === undefined) throw new Error(`no ${ref}`);
      return scripts().jobs.identifyPlatformScript({ creatorId: nora, platformScriptId: view.id });
    });

  /** One sign-in per person for the whole file: the sign-in limiter counts each one. */
  const cookies = new Map<string, string>();
  const cookieOf = async (who: string): Promise<string> => {
    const known = cookies.get(who);
    if (known !== undefined) return known;
    const cookie = await signIn(server, `${who}@example.test`, PASSWORD);
    cookies.set(who, cookie);
    return cookie;
  };

  const post = async (
    who: 'owner' | 'manager' | 'chatter' | 'nora',
    url: string,
    payload: object,
    method: 'POST' | 'PUT' = 'POST',
  ) =>
    server.inject({
      method,
      url,
      headers: { cookie: await cookieOf(who), origin: DASHBOARD_ORIGIN },
      payload,
    });

  it('writes an identity once each photo and video of the script is described, with no switch, never a price', async () => {
    // Sequence 4: a photo; a photo and a teaser video; a video and a teaser photo.
    expect(await identify('sequence_4')).toBe('waiting');
    for (const [ref, kind] of [
      ['media_10', 'image'],
      ['media_11', 'image'],
      ['media_03', 'video'],
      ['media_12', 'video'],
      ['media_04', 'image'],
    ] as const)
      await described(ref, kind, `Une description inventée de ${ref}.`);
    expect(await identify('sequence_4')).toBe('identified');
    expect(await identify('sequence_4')).toBe('already');
    expect(told).toHaveLength(1);
    expect(told[0]?.steps.map((step) => [step.name, step.media.map((media) => media.description)])).toEqual([
      ['Script de test 4 · étape 1', ['Une description inventée de media_10.']],
      [
        'Script de test 4 · étape 2',
        ['Une description inventée de media_11.', 'Une description inventée de media_03.'],
      ],
      [
        'Script de test 4 · étape 3',
        ['Une description inventée de media_12.', 'Une description inventée de media_04.'],
      ],
    ]);
    expect(JSON.stringify(told[0])).not.toMatch(/priceMinor|EUR/u);
    const view = await ownerView('sequence_4');
    expect(view?.identity).toMatchObject({ content: IDENTITY, author: 'brain', validatedAt: null });
    expect(view).toMatchObject({ gaps: ['identity_not_validated'], proposable: false });
  });

  it('lets an active manager of her list validate it, once, and the script becomes proposable', async () => {
    const view = await ownerView('sequence_4');
    if (view?.identity == null) throw new Error('identified');
    const url = `/v1/creators/${nora}/platform-scripts/${view.id}/identity/validate`;
    // A chatter, her own account, a creator who is not on his list: never.
    expect((await post('chatter', url, { identityId: view.identity.id })).statusCode).toBe(404);
    expect((await post('nora', url, { identityId: view.identity.id })).statusCode).toBe(403);
    expect(
      (
        await post('manager', `/v1/creators/${ines}/platform-scripts/${view.id}/identity/validate`, {
          identityId: view.identity.id,
        })
      ).statusCode,
    ).toBe(403);
    const response = await post('manager', url, { identityId: view.identity.id });
    expect(response.statusCode).toBe(200);
    const validated = PlatformScriptViewSchema.parse(response.json());
    expect(validated).toMatchObject({
      gaps: [],
      proposable: true,
      identity: { id: view.identity.id, moment: 'night' },
    });
    expect(validated.identity?.validatedAt).not.toBeNull();
    // Validated again: nothing changes, nothing is written twice.
    const again = PlatformScriptViewSchema.parse(
      (await post('owner', url, { identityId: view.identity.id })).json(),
    );
    expect(again.identity?.validatedAt).toBe(validated.identity?.validatedAt);
    const audit = await test.admin.db
      .select({ userId: schema.auditLog.userId, action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, view.id));
    expect(audit).toEqual([{ userId: ids.manager, action: 'script_identity.validated' }]);
    // The list reads the same, through its route.
    const listed = await server.inject({
      method: 'GET',
      url: `/v1/creators/${nora}/platform-scripts`,
      headers: { cookie: await signIn(server, 'manager@example.test', PASSWORD) },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      z
        .array(PlatformScriptViewSchema)
        .parse(listed.json())
        .find((each) => each.ref === 'sequence_4')?.proposable,
    ).toBe(true);
  });

  it('holds a validated identity to its version: a description corrected asks for a new one, the old is stale', async () => {
    const before = await ownerView('sequence_4');
    if (before?.identity == null) throw new Error('validated');
    // The description of the first photo corrected and validated anew: another version of the script.
    await described('media_10', 'image', 'Une description corrigée, inventée.');
    const after = await ownerView('sequence_4');
    expect(after?.identity).toBeNull();
    expect(after).toMatchObject({ gaps: ['identity_not_validated'], proposable: false });
    const url = `/v1/creators/${nora}/platform-scripts/${before.id}/identity/validate`;
    const stale = await post('owner', url, { identityId: before.identity.id });
    expect([stale.statusCode, stale.json<{ error: { code: string } }>().error.code]).toEqual([
      409,
      'script_identity_stale_conflict',
    ]);
    // Written by hand for the version of now: validated by whoever writes it.
    const corrected = await post(
      'owner',
      `/v1/creators/${nora}/platform-scripts/${before.id}/identity/correct`,
      {
        content: { ...IDENTITY, ambiance: 'douce et lente', energy: 'soft' },
      },
    );
    expect(corrected.statusCode).toBe(200);
    expect(PlatformScriptViewSchema.parse(corrected.json())).toMatchObject({
      proposable: true,
      identity: { author: 'human', content: { ambiance: 'douce et lente', energy: 'soft' } },
    });
    // A hand's identity stands for its version: the brain leaves it alone.
    expect(await identify('sequence_4')).toBe('already');
    // A body outside the schema is refused before anything is read.
    expect(
      (
        await post('owner', `/v1/creators/${nora}/platform-scripts/${before.id}/identity/correct`, {
          content: { ...IDENTITY, energy: 'wild' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('keeps the identities closed to her account and written by the job or a hand of the team only', async () => {
    const hers = await withCreatorAccount(app.db.db, ids.nora, (tx) =>
      tx.select().from(schema.scriptIdentities),
    );
    expect(hers).toEqual([]);
    const view = await ownerView('sequence_4');
    if (view?.identity == null) throw new Error('corrected');
    // The application role cannot rewrite one, even in her tenant as the owner: only the stamp is granted, once.
    const failure: unknown = await withTenant(app.db.db, nora, (tx) =>
      tx
        .update(schema.scriptIdentities)
        .set({ content: IDENTITY })
        .where(eq(schema.scriptIdentities.creatorId, nora)),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const cause = failure instanceof Error && failure.cause instanceof Error ? failure.cause.message : '';
    expect(cause).toMatch(/permission denied/u);
  });

  it('asks the identity again after an import that changes a script, and each hour for those of a switch on', async () => {
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs j using graphile_worker._private_tasks t
          where t.id = j.task_id and t.identifier = 'scripts.identify_platform_script'`,
    );
    const identityJobs = async () =>
      z
        .array(z.object({ key: z.string() }))
        .parse(
          (
            await test.admin.db.execute(
              sql`select j.key from graphile_worker._private_jobs j
                  join graphile_worker._private_tasks t on t.id = j.task_id
                  where t.identifier = 'scripts.identify_platform_script' order by j.key`,
            )
          ).rows,
        )
        .map((row) => row.key);
    await scenario([{ type: 'script_changed', scriptId: 'script_4_2', priceCents: 2_500 }]);
    expect(await importOf(noraAccount, nora, new Date('2026-11-15T10:00:00Z'))).toMatchObject({ changed: 1 });
    const changed = await ownerView('sequence_4');
    expect(await identityJobs()).toEqual([`scripts.identify_platform_script:${changed?.id ?? ''}`]);
    // A price is not in the identity: the one written by hand still stands, the script still proposable.
    expect(changed).toMatchObject({ proposable: true, identity: { author: 'human' } });
    const active = (await scriptRows()).filter((row) => row.active && row.creatorId === nora);
    expect(await scripts().jobs.identifyBacklog('test')).toBe(active.length);
  });

  it('keeps the branches of a step in one order, offered only once the agency set each condition (ADR 0112)', async () => {
    // A loose step joins sequence 4 on the rank of its second step: two branches of one step.
    await scenario([
      { type: 'sequence_branched', sequenceId: 'sequence_4', scriptId: 'script_2_1', stepIndex: 1 },
    ]);
    await importOf(noraAccount, nora, new Date('2026-11-15T11:00:00Z'));
    const view = await ownerView('sequence_4');
    if (view === undefined) throw new Error('imported');
    // The branches of rank 1 by their ref, whatever order Reveal listed them in.
    expect(view.steps.map((step) => [step.ref, step.position, step.platformIndex, step.branches])).toEqual([
      ['script_4_1', 0, 0, 1],
      ['script_2_1', 1, 1, 2],
      ['script_4_2', 2, 1, 2],
      ['script_4_3', 3, 2, 1],
    ]);
    expect(view.steps.map((step) => step.condition)).toEqual([null, null, null, null]);
    expect(view.gaps).toContain('branch_unsettled');
    expect(view.proposable).toBe(false);
    // The brain's prompt reads steps one after the other: such an identity is written by hand.
    const before = told.length;
    expect(await identify('sequence_4')).toBe('branched');
    expect(told).toHaveLength(before);

    const url = `/v1/creators/${nora}/platform-scripts/${view.id}/steps/1/branches`;
    const body = {
      branches: [
        { stepRef: 'script_4_2', condition: { kind: 'none' } },
        { stepRef: 'script_2_1', condition: { kind: 'text', text: "S'il a parlé de son travail" } },
      ],
    };
    // A chatter, her own account, a creator who is not on the manager's list: never.
    expect((await post('chatter', url, body, 'PUT')).statusCode).toBe(404);
    expect((await post('nora', url, body, 'PUT')).statusCode).toBe(403);
    expect(
      (
        await post(
          'manager',
          `/v1/creators/${ines}/platform-scripts/${view.id}/steps/1/branches`,
          body,
          'PUT',
        )
      ).statusCode,
    ).toBe(403);
    // A step without branches, or branches that are not those of the step: nothing written.
    expect(
      (
        await post(
          'manager',
          `/v1/creators/${nora}/platform-scripts/${view.id}/steps/0/branches`,
          body,
          'PUT',
        )
      ).statusCode,
    ).toBe(404);
    const stale = await post(
      'manager',
      url,
      { branches: [body.branches[0], { stepRef: 'script_9_9', condition: { kind: 'none' } }] },
      'PUT',
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe(
      'platform_script_branches_stale_conflict',
    );
    // A condition outside the closed list: refused by the schema.
    const unknown = { branches: [body.branches[0], { stepRef: 'script_2_1', condition: { kind: 'mood' } }] };
    expect((await post('manager', url, unknown, 'PUT')).statusCode).toBe(400);

    const response = await post('manager', url, body, 'PUT');
    expect(response.statusCode).toBe(200);
    const set = PlatformScriptViewSchema.parse(response.json());
    // In the agency's order, each with its condition; nothing left to set on the branches.
    expect(set.steps.map((step) => [step.ref, step.condition?.kind ?? null])).toEqual([
      ['script_4_1', null],
      ['script_4_2', 'none'],
      ['script_2_1', 'text'],
      ['script_4_3', null],
    ]);
    expect(set.gaps).not.toContain('branch_unsettled');
    const audit = await test.admin.db
      .select({ userId: schema.auditLog.userId, action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, view.id),
          eq(schema.auditLog.action, 'platform_script.branches_set'),
        ),
      );
    expect(audit).toEqual([{ userId: ids.manager, action: 'platform_script.branches_set' }]);

    // Reveal lists the branches again in another order: the import keeps the same, and the settings outlive it.
    await scenario([{ type: 'script_changed', scriptId: 'script_4_3', priceCents: 3_100 }]);
    await importOf(noraAccount, nora, new Date('2026-11-15T12:00:00Z'));
    const again = await ownerView('sequence_4');
    expect(again?.steps.map((step) => [step.ref, step.condition?.kind ?? null])).toEqual([
      ['script_4_1', null],
      ['script_4_2', 'none'],
      ['script_2_1', 'text'],
      ['script_4_3', null],
    ]);
    // Two by default: refused at once.
    const twoDefaults = {
      branches: [body.branches[0], { stepRef: 'script_2_1', condition: { kind: 'none' } }],
    };
    const refused = PlatformScriptViewSchema.parse((await post('owner', url, twoDefaults, 'PUT')).json());
    expect(refused.gaps).toContain('branch_two_defaults');
  });

  it('never offers a script with a « Tarif réduit » on a step, and offers it again once taken off (recette 16/11)', async () => {
    const stepsOf = async () =>
      (await ownerView('sequence_4'))?.steps.map((step) => [step.ref, step.discount]);
    await scenario([
      {
        type: 'script_changed',
        scriptId: 'script_4_3',
        priceCents: 3_000,
        discount: { priceCents: 1_500, minutes: 60 },
      },
    ]);
    await importOf(noraAccount, nora, new Date('2026-11-15T12:00:00Z'));
    const view = await ownerView('sequence_4');
    expect(view?.gaps).toContain('step_discounted');
    // « À traiter » warns of it, since the import that read the discount, for the owner and a manager of her list.
    const warned = [{ id: view?.id, name: view?.name, steps: 1, since: new Date('2026-11-15T12:00:00Z') }];
    expect(await scripts().reads.discountedScripts(nora, { userId: ids.owner, role: 'owner' })).toEqual(
      warned,
    );
    expect(await scripts().reads.discountedScripts(nora, { userId: ids.manager, role: 'operator' })).toEqual(
      warned,
    );
    expect(
      await scripts().reads.discountedScripts(ines, { userId: ids.manager, role: 'operator' }),
    ).toBeNull();
    expect(
      await scripts().reads.discountedScripts(nora, { userId: ids.chatter, role: 'operator' }),
    ).toBeNull();
    expect(await scripts().reads.discountedScripts(nora, { userId: ids.nora, role: 'creator' })).toBeNull();
    // A later import that changes nothing keeps the day it began.
    await importOf(noraAccount, nora, new Date('2026-11-15T12:30:00Z'));
    expect(await scripts().reads.discountedScripts(nora, { userId: ids.owner, role: 'owner' })).toEqual(
      warned,
    );
    expect(view?.proposable).toBe(false);
    // Read as it is, on its step only; the price stays the full one.
    expect(await stepsOf()).toEqual([
      ['script_4_1', null],
      ['script_4_2', null],
      ['script_2_1', null],
      ['script_4_3', { priceMinor: 1_500, minutes: 60 }],
    ]);
    expect(view?.steps.find((step) => step.ref === 'script_4_3')?.priceMinor).toBe(3_000);
    await scenario([{ type: 'script_changed', scriptId: 'script_4_3', priceCents: 3_000, discount: null }]);
    await importOf(noraAccount, nora, new Date('2026-11-15T13:00:00Z'));
    expect((await ownerView('sequence_4'))?.gaps).not.toContain('step_discounted');
    expect((await stepsOf())?.every(([, discount]) => discount === null)).toBe(true);
    expect(await scripts().reads.discountedScripts(nora, { userId: ids.owner, role: 'owner' })).toEqual([]);
  });

  it('recognises a script copied into Reveal by hand once everything matches, and closes it (ADR 0112 § 23)', async () => {
    const [row] = await test.admin.db
      .select()
      .from(schema.platformScripts)
      .where(eq(schema.platformScripts.platformScriptRef, 'sequence_1'));
    if (row === undefined) throw new Error('imported');
    const steps = await test.admin.db
      .select()
      .from(schema.platformScriptSteps)
      .where(eq(schema.platformScriptSteps.platformScriptId, row.id))
      .orderBy(schema.platformScriptSteps.position);
    const sold = await test.admin.db
      .select()
      .from(schema.platformScriptStepMedia)
      .where(
        and(
          eq(schema.platformScriptStepMedia.platformScriptId, row.id),
          eq(schema.platformScriptStepMedia.role, 'sold'),
        ),
      );
    let n = 0;
    const uuid = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
    // What the agency wrote in Impera, then copied by hand: the same name, steps, media and prices.
    const content = PreparedScriptContentSchema.parse({
      name: row.name,
      description: 'Un script inventé, recopié à la main.',
      moment: 'night',
      steps: steps.map((step) => ({
        key: uuid(),
        rhythm: 3,
        branches: [
          {
            key: uuid(),
            condition: null,
            teaser: '',
            offerText: 'Texte inventé',
            media: sold
              .filter((media) => media.position === step.position)
              .map((media) => ({ ref: media.platformMediaRef })),
            afterMedia: { justAfter: '', unread: '', readNotBought: '' },
            priceMinor: step.priceMinor,
            currency: step.currency,
          },
        ],
      })),
    });
    const ready = async (priceShift: number) => {
      const id = newId(PreparedScriptIdSchema);
      const [first, ...rest] = content.steps;
      if (first === undefined) throw new Error('steps');
      const shifted = {
        ...content,
        steps: [
          {
            ...first,
            branches: first.branches.map((b) => ({ ...b, priceMinor: b.priceMinor + priceShift })),
          },
          ...rest,
        ],
      };
      await test.admin.db.insert(schema.preparedScripts).values({
        id,
        creatorId: nora,
        platformAccountId: noraAccount,
        state: 'ready_to_copy',
        content: shifted,
        createdBy: ids.manager,
        updatedBy: ids.manager,
      });
      return id;
    };
    // One copied with another price on its first step: never tied; the exact one is.
    const differs = await ready(100);
    const exact = await ready(0);
    const run = await importOf(noraAccount, nora, new Date('2026-11-16T10:00:00Z'));
    expect(run).toMatchObject({ outcome: 'imported', recognised: 1 });
    const prepared = await test.admin.db
      .select({
        id: schema.preparedScripts.id,
        state: schema.preparedScripts.state,
        matched: schema.preparedScripts.matchedPlatformScriptId,
      })
      .from(schema.preparedScripts)
      .where(eq(schema.preparedScripts.platformAccountId, noraAccount));
    expect(prepared.find((each) => each.id === exact)).toMatchObject({ state: 'matched', matched: row.id });
    expect(prepared.find((each) => each.id === differs)).toMatchObject({
      state: 'ready_to_copy',
      matched: null,
    });
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, exact));
    expect(audit).toEqual([{ action: 'prepared_script.matched', userId: null }]);
    // A native script is tied once: the next import ties nothing more.
    expect(await importOf(noraAccount, nora, new Date('2026-11-16T11:00:00Z'))).toMatchObject({
      recognised: 0,
    });
  });
});
