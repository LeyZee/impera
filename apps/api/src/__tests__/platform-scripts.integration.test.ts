import {
  ConnectorConfigSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type PlatformScript,
} from '@impera/contracts';
import { eq, schema, sql, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors } from '../modules/connectors';
import { createScriptsModule, type ScriptsModule } from '../modules/scripts';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { testConfig } from './support/config';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

/**
 * The import of the native scripts (ADR 0099 § 1 time 2, P6-01) against FakeReveal's default world: four sequences
 * of three steps, invented. The import writes as the service role; the agency reads under her RLS and the team's
 * scopes. Invented data only (ADR 0010).
 */
describe('the native scripts imported from the platform', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let scripts: ScriptsModule;
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
  /** The vault as the sync left it: media_02 read and described, media_09 listed and not read yet. */
  const vault = new Map([
    ['media_02', { mediaAssetId: '0193a000-0000-7000-8000-000000000002', described: true }],
    ['media_09', { mediaAssetId: null, described: false }],
  ]);

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return userId;
  }

  async function scenario(events: object[]): Promise<void> {
    const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
    expect(response.statusCode).toBe(200);
  }

  /** Nora's account reads FakeReveal; Inès's reads no scripts. */
  async function listed(accountId: PlatformAccountId): Promise<readonly PlatformScript[] | null> {
    if (accountId !== noraAccount) return null;
    const connector = revealApiConnectors({ fetch: fake.fetch, baseUrl: 'https://reveal.test' })(
      {
        id: noraAccount,
        creatorId: nora,
        platform: 'reveal',
        sessionState: 'valid',
        lastPollAt: null,
        config: ConnectorConfigSchema.parse({}),
        consecutiveErrors: 0,
        pausedUntil: null,
      },
      JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      {
        sends: {
          find: () => Promise.reject(new Error('no send in an import')),
          begin: () => Promise.reject(new Error('no send in an import')),
          settle: () => Promise.reject(new Error('no send in an import')),
          ownIds: () => Promise.reject(new Error('no send in an import')),
        },
      },
    );
    if (connector.listPlatformScripts === undefined) throw new Error('the Reveal connector reads scripts');
    return connector.listPlatformScripts();
  }

  const importOf = (platformAccountId: PlatformAccountId, creatorId: CreatorId, at: Date) =>
    scripts.jobs.importPlatformScripts({ creatorId, platformAccountId }, at);

  const scriptRows = () =>
    test.admin.db.select().from(schema.platformScripts).orderBy(schema.platformScripts.platformScriptRef);

  beforeAll(async () => {
    fake = createFakeReveal();
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    scripts = createScriptsModule({
      db: app.db.db,
      adminDb: test.service.db,
      requests: {
        ask: () => Promise.reject(new Error('no request here')),
        last: () => Promise.resolve(null),
        lastFor: () => Promise.resolve(null),
      },
      requireRole: app.requireRole,
      limitsOf: () => Promise.resolve(null),
      cardFontsDir: '',
      rasterizeCard: () => Promise.reject(new Error('no card here')),
      platformScripts: {
        source: (account) => listed(account.id),
        vault: (_accountId, refs) => linksOf(refs),
      },
    });
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
      });
    }
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

  function linksOf(refs: readonly string[]) {
    return Promise.resolve(new Map([...vault].filter(([ref]) => refs.includes(ref))));
  }

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('imports each sequence with its steps in the platform’s order and its prices as they are', async () => {
    const run = await importOf(noraAccount, nora, new Date('2026-11-14T10:00:00Z'));
    expect(run).toEqual({ outcome: 'imported', added: 4, changed: 0, gone: 0 });
    // Inès's account reads no scripts; an account named with another creator is not read.
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
    const views = await scripts.reads.platformScripts(nora, { userId: ids.owner, role: 'owner' });
    const changed = views?.find((view) => view.ref === 'sequence_1');
    expect(changed?.steps.map((step) => step.priceMinor)).toEqual([500, 1_500, 4_500]);
    // 5 € then 15 €: already more than double; then 45 €, three times 15 € and above 40 €.
    expect(changed?.warnings).toEqual([
      { code: 'price_more_than_double', position: 1 },
      { code: 'price_more_than_double', position: 2 },
      { code: 'price_above_ceiling', position: 2 },
    ]);
    // A gone script keeps its steps: a run or a reward may still name it.
    expect(views?.find((view) => view.ref === 'sequence_2')?.steps).toHaveLength(3);
  });

  it('says where each media stands in the vault, and offers no script before its identity (SC-04 c8)', async () => {
    const views = await scripts.reads.platformScripts(nora, { userId: ids.owner, role: 'owner' });
    const step = views?.find((view) => view.ref === 'sequence_1')?.steps[1];
    expect(step?.media).toEqual([
      {
        ref: 'media_02',
        kind: 'image',
        inVault: true,
        mediaAssetId: '0193a000-0000-7000-8000-000000000002',
        described: true,
      },
    ]);
    expect(step?.previewMedia).toEqual([
      { ref: 'media_09', kind: 'video', inVault: true, mediaAssetId: null, described: false },
    ]);
    expect(views?.find((view) => view.ref === 'sequence_1')).toMatchObject({
      gaps: ['media_absent', 'media_not_described', 'identity_not_validated'],
      proposable: false,
    });
  });

  it('lets the owner and an active manager of her list read, never a chatter nor her own account', async () => {
    const manager = await scripts.reads.platformScripts(nora, { userId: ids.manager, role: 'operator' });
    expect(manager?.length).toBe(7);
    // A manager reads the creators of his list only, as her vault; the owner reads Inès, who has none of Nora's.
    expect(await scripts.reads.platformScripts(ines, { userId: ids.manager, role: 'operator' })).toBeNull();
    expect(await scripts.reads.platformScripts(ines, { userId: ids.owner, role: 'owner' })).toEqual([]);
    expect(await scripts.reads.platformScripts(nora, { userId: ids.chatter, role: 'operator' })).toBeNull();
    expect(await scripts.reads.platformScripts(nora, { userId: ids.nora, role: 'creator' })).toBeNull();
    // A creator who does not exist answers like a reader who may not read: never her existence.
    expect(
      await scripts.reads.platformScripts(newId(CreatorIdSchema), { userId: ids.owner, role: 'owner' }),
    ).toBeNull();
  });

  it('reads one script of hers out of any person, and none of another creator', async () => {
    const row = (await scriptRows()).find((each) => each.platformScriptRef === 'sequence_1');
    if (row === undefined) throw new Error('imported');
    expect((await scripts.reads.platformScript(nora, row.id))?.steps[0]?.ref).toBe('script_1_1');
    expect(await scripts.reads.platformScript(ines, row.id)).toBeNull();
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
