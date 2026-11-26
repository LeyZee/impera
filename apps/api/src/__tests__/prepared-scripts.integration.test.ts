import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  MediaAssetIdSchema,
  newId,
  PlatformAccountIdSchema,
  PreparedScriptIdSchema,
  PreparedScriptListSchema,
  PreparedScriptViewSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type PreparedScriptContent,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

const ErrorSchema = z.object({ error: z.object({ code: z.string() }) });

/** Invented keys: a UUID per step and branch. */
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Two steps, the second paid; its media `media_01` and `media_02` of her vault. Invented texts only (ADR 0010). */
const CONTENT: PreparedScriptContent = {
  name: 'Soirée inventée',
  description: 'Un soir de pluie inventé.',
  moment: 'night',
  steps: [1, 2].map((n) => ({
    key: key(100 + n),
    rhythm: 3,
    branches: [
      {
        key: key(n),
        condition: null,
        teaser: 'Accroche inventée',
        offerText: 'Texte d’offre inventé',
        media: [{ ref: `media_0${String(n)}` }],
        afterMedia: { justAfter: '', unread: '', readNotBought: '' },
        priceMinor: n === 1 ? 0 : 1500,
        currency: 'EUR',
      },
    ],
  })),
};

/**
 * Her scripts in preparation (ADR 0112 §§ 20-22) through the real routes and tables: created under the client's id,
 * saved on a revision, made « prêt à copier » only without a gap. The owner and the active managers of her list read
 * and write them; a chatter of her list gets the same 404 for a script that exists and one that does not, her own
 * account and the manager of another creator a 403. Invented data only.
 */
describe('the scripts in preparation', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let noraAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  const ids: Record<'owner' | 'manager' | 'chatter' | 'nora' | 'other', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
    other: '',
  };

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return userId;
  }

  type Who = keyof typeof ids;
  /** One sign-in per person: the sign-in is rate-limited per account. */
  const cookies = new Map<Who, string>();
  async function cookieOf(who: Who): Promise<string> {
    const known = cookies.get(who);
    if (known !== undefined) return known;
    const cookie = await signIn(server, `${who}@example.test`, PASSWORD);
    cookies.set(who, cookie);
    return cookie;
  }
  const call = async (who: Who, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: await cookieOf(who), origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  const base = (creatorId: CreatorId) => `/v1/creators/${creatorId}/prepared-scripts`;
  const codeOf = (body: string) => ErrorSchema.parse(JSON.parse(body)).error.code;

  async function vaultMedia(ref: string, kind: 'image' | 'video'): Promise<void> {
    await test.admin.db.insert(schema.mediaPlatformRefs).values({
      id: newId(z.uuid()),
      creatorId: nora,
      platform: 'reveal',
      platformAccountId: noraAccount,
      platformMediaId: ref,
      kind,
      folderPosition: 0,
      platformCreatedAt: new Date('2026-11-01T20:00:00Z'),
      lastSyncedAt: new Date('2026-11-01T20:00:00Z'),
    });
  }

  /** Her media read and described, the description validated by the owner. */
  async function describe_(ref: string): Promise<void> {
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
          eq(schema.mediaPlatformRefs.platformMediaId, ref),
        ),
      );
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    const logger = createLogger(config);
    app = await createApp(config, logger, { composer: fixedComposer });
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
    ids.owner = (
      await createOwner(app.auth, app.db.db, {
        email: 'owner@example.test',
        name: 'Owner',
        password: PASSWORD,
      })
    ).userId;
    for (const [who, teamRole, creatorId] of [
      ['manager', 'manager', nora],
      ['chatter', 'chatter', nora],
      ['other', 'manager', ines],
    ] as const) {
      ids[who] = await account(`${who}@example.test`, { role: 'operator', creatorIds: [creatorId] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: ids[who],
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    ids.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    await vaultMedia('media_01', 'image');
    await vaultMedia('media_02', 'image');
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('creates a script under the client’s id, replays the same send, refuses another content on that id', async () => {
    const id = newId(PreparedScriptIdSchema);
    const body = { id, platformAccountId: noraAccount, content: CONTENT };
    const created = await call('manager', 'POST', base(nora), body);
    expect(created.statusCode).toBe(201);
    const view = PreparedScriptViewSchema.parse(created.json());
    expect(view).toMatchObject({
      state: 'editing',
      revision: 1,
      matchedPlatformScriptId: null,
      copyDifferences: null,
    });
    // Both media listed by her vault, neither described yet.
    expect(view.gaps.map((gap) => [gap.code, gap.step])).toEqual([
      ['media_not_described', 0],
      ['media_not_described', 1],
    ]);
    expect((await call('manager', 'POST', base(nora), body)).statusCode).toBe(200);
    const other = await call('manager', 'POST', base(nora), {
      ...body,
      content: { ...CONTENT, name: 'Autre' },
    });
    expect(other.statusCode).toBe(409);
    expect(codeOf(other.body)).toBe('prepared_script_conflict');
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, id));
    expect(audit.map((row) => row.action)).toEqual(['prepared_script.created']);
  });

  it('refuses an id another creator holds, with a conflict and not a failure', async () => {
    const id = newId(PreparedScriptIdSchema);
    expect(
      (await call('owner', 'POST', base(nora), { id, platformAccountId: noraAccount, content: CONTENT }))
        .statusCode,
    ).toBe(201);
    // Hidden from Inès's side by Nora's RLS: only the key finds it.
    const taken = await call('owner', 'POST', base(ines), {
      id,
      platformAccountId: inesAccount,
      content: CONTENT,
    });
    expect(taken.statusCode).toBe(409);
    expect(codeOf(taken.body)).toBe('prepared_script_conflict');
  });

  it('refuses an account that is not one of hers', async () => {
    const response = await call('owner', 'POST', base(nora), {
      id: newId(PreparedScriptIdSchema),
      platformAccountId: inesAccount,
      content: CONTENT,
    });
    expect(response.statusCode).toBe(400);
    expect(codeOf(response.body)).toBe('prepared_script_account_invalid');
  });

  it('becomes « prêt à copier » only without a gap, on the revision the person saw', async () => {
    const id = newId(PreparedScriptIdSchema);
    expect(
      (await call('owner', 'POST', base(nora), { id, platformAccountId: noraAccount, content: CONTENT }))
        .statusCode,
    ).toBe(201);
    const ready = () => call('owner', 'POST', `${base(nora)}/${id}/ready`, { basedOnRevision: 1 });
    const refused = await ready();
    expect(refused.statusCode).toBe(422);
    expect(codeOf(refused.body)).toBe('prepared_script_gaps_unprocessable');
    // Described since: the gaps are counted at each read, without a save.
    await describe_('media_01');
    await describe_('media_02');
    const accepted = await ready();
    expect(accepted.statusCode).toBe(200);
    expect(PreparedScriptViewSchema.parse(accepted.json())).toMatchObject({
      state: 'ready_to_copy',
      revision: 2,
      gaps: [],
      // Not copied into Reveal yet: no native script of its name.
      copyDifferences: [{ code: 'name_not_found' }],
    });
    // A save on an old revision is refused; on the current one it goes back to editing.
    const stale = await call('manager', 'PUT', `${base(nora)}/${id}`, {
      basedOnRevision: 1,
      content: CONTENT,
    });
    expect(stale.statusCode).toBe(409);
    expect(codeOf(stale.body)).toBe('prepared_script_stale_conflict');
    const saved = await call('manager', 'PUT', `${base(nora)}/${id}`, {
      basedOnRevision: 2,
      content: { ...CONTENT, name: 'Soirée renommée' },
    });
    expect(saved.statusCode).toBe(200);
    expect(PreparedScriptViewSchema.parse(saved.json())).toMatchObject({
      state: 'editing',
      revision: 3,
      content: { name: 'Soirée renommée' },
    });
  });

  it('never lets a paid step sell a media offered once (ADR 0145 § 2)', async () => {
    const id = newId(PreparedScriptIdSchema);
    expect(
      (await call('owner', 'POST', base(nora), { id, platformAccountId: noraAccount, content: CONTENT }))
        .statusCode,
    ).toBe(201);
    const offered = (ref: string, at: Date | null) =>
      test.admin.db
        .update(schema.mediaPlatformRefs)
        .set({ sentForFreeAt: at })
        .where(
          and(
            eq(schema.mediaPlatformRefs.platformAccountId, noraAccount),
            eq(schema.mediaPlatformRefs.platformMediaId, ref),
          ),
        );
    const gaps = async () =>
      PreparedScriptViewSchema.parse((await call('manager', 'GET', `${base(nora)}/${id}`)).json()).gaps.map(
        (gap) => [gap.code, gap.step],
      );
    // The offered step's media, sent for free: nothing sold, nothing said.
    await offered('media_01', new Date());
    expect(await gaps()).toEqual([]);
    // The paid step's: never sold again, « prêt à copier » refused.
    await offered('media_02', new Date());
    expect(await gaps()).toEqual([['media_offered', 1]]);
    const refused = await call('owner', 'POST', `${base(nora)}/${id}/ready`, { basedOnRevision: 1 });
    expect(refused.statusCode).toBe(422);
    await offered('media_01', null);
    await offered('media_02', null);
    expect(await gaps()).toEqual([]);
  });

  it('closes a script an import recognised: no save, no state changed', async () => {
    const id = newId(PreparedScriptIdSchema);
    await call('owner', 'POST', base(nora), { id, platformAccountId: noraAccount, content: CONTENT });
    // The recognition is lot 2's: set here as the service role would, its native script invented.
    const platformScriptId = newId(z.uuid());
    await test.admin.db.insert(schema.platformScripts).values({
      id: platformScriptId,
      creatorId: nora,
      platformAccountId: noraAccount,
      platformScriptRef: 'sequence_inventee',
      name: 'Soirée inventée',
      fingerprint: 'empreinte-inventee',
      syncedAt: new Date(),
      versionAt: new Date(),
    });
    await test.admin.db
      .update(schema.preparedScripts)
      .set({ state: 'matched', matchedPlatformScriptId: platformScriptId, matchedAt: new Date() })
      .where(eq(schema.preparedScripts.id, id));
    const save = await call('owner', 'PUT', `${base(nora)}/${id}`, { basedOnRevision: 1, content: CONTENT });
    expect(save.statusCode).toBe(409);
    expect(codeOf(save.body)).toBe('prepared_script_closed_conflict');
    const back = await call('owner', 'POST', `${base(nora)}/${id}/editing`, { basedOnRevision: 1 });
    expect(codeOf(back.body)).toBe('prepared_script_closed_conflict');
  });

  it('gives a job each native script with the script of ours it copies, or none (ADR 0161 § 5)', async () => {
    const native = async (name: string) => {
      const id = newId(z.uuid());
      await test.admin.db.insert(schema.platformScripts).values({
        id,
        creatorId: nora,
        platformAccountId: noraAccount,
        platformScriptRef: `sequence_${id}`,
        name,
        fingerprint: `empreinte-${id}`,
        syncedAt: new Date(),
        versionAt: new Date(),
      });
      return id;
    };
    const ours = newId(PreparedScriptIdSchema);
    await call('owner', 'POST', base(nora), { id: ours, platformAccountId: noraAccount, content: CONTENT });
    const copy = await native('Soirée inventée');
    // A native script of an earlier tool, never prepared here: it carries none.
    const foreign = await native('Ancien script inventé');
    await test.admin.db
      .update(schema.preparedScripts)
      .set({ state: 'matched', matchedPlatformScriptId: copy, matchedAt: new Date() })
      .where(eq(schema.preparedScripts.id, ours));
    const scripts = await app.modules.scripts.forJobs.accountScripts(nora, noraAccount);
    expect(scripts.find((each) => each.id === copy)?.ours).toEqual({
      preparedScriptId: ours,
      language: 'french',
      versionOf: null,
      description: 'Un soir de pluie inventé.',
      moment: 'night',
      steps: [
        { branches: [{ priceMinor: 0, currency: 'EUR' }] },
        { branches: [{ priceMinor: 1500, currency: 'EUR' }] },
      ],
    });
    expect(scripts.find((each) => each.id === foreign)?.ours).toBeNull();
  });

  it('makes a version in another language: the same steps, media and prices, its texts to translate (ADR 0169)', async () => {
    const source = newId(PreparedScriptIdSchema);
    expect(
      (
        await call('owner', 'POST', base(nora), {
          id: source,
          platformAccountId: noraAccount,
          content: CONTENT,
        })
      ).statusCode,
    ).toBe(201);
    const versions = `${base(nora)}/${source}/versions`;
    const english = newId(PreparedScriptIdSchema);
    const made = await call('manager', 'POST', versions, {
      id: english,
      language: 'english',
      name: 'Rainy night',
    });
    expect(made.statusCode).toBe(201);
    const view = PreparedScriptViewSchema.parse(made.json());
    expect(view).toMatchObject({ language: 'english', versionOf: source, state: 'editing', revision: 1 });
    expect(
      view.content.steps.map((step) => step.branches.map((one) => [one.key, one.priceMinor, one.media])),
    ).toEqual(CONTENT.steps.map((step) => step.branches.map((one) => [one.key, one.priceMinor, one.media])));
    expect(view.content.steps[0]?.branches[0]?.offerText).toBe('');
    expect(view.gaps.map((gap) => gap.code)).toContain('offer_text_missing');
    // The same send replays; a second in English, one in French, or a version of a version is refused.
    expect(
      (await call('manager', 'POST', versions, { id: english, language: 'english', name: 'Rainy night' }))
        .statusCode,
    ).toBe(200);
    for (const [path, language] of [
      [versions, 'english'],
      [versions, 'french'],
      [`${base(nora)}/${english}/versions`, 'italian'],
    ] as const) {
      const refused = await call('owner', 'POST', path, {
        id: newId(PreparedScriptIdSchema),
        language,
        name: 'Notte inventata',
      });
      expect(refused.statusCode, `${path} ${language}`).toBe(409);
      expect(codeOf(refused.body)).toBe('prepared_script_version_conflict');
    }
    // Nobody but the team makes one, and never of a script of another creator.
    const body = { id: newId(PreparedScriptIdSchema), language: 'italian', name: 'Notte inventata' };
    expect((await call('chatter', 'POST', versions, body)).statusCode).toBe(404);
    expect((await call('nora', 'POST', versions, body)).statusCode).toBe(403);
    expect((await call('owner', 'POST', `${base(ines)}/${source}/versions`, body)).statusCode).toBe(404);
    // The base holds it too: a version of a script of another creator, or a second in a language, never enters.
    const insert = (over: Partial<typeof schema.preparedScripts.$inferInsert>) =>
      test.admin.db.insert(schema.preparedScripts).values({
        id: newId(PreparedScriptIdSchema),
        creatorId: nora,
        platformAccountId: noraAccount,
        content: CONTENT,
        createdBy: ids.owner,
        updatedBy: ids.owner,
        ...over,
      });
    await expect(
      insert({ creatorId: ines, platformAccountId: inesAccount, versionOf: source, language: 'italian' }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(insert({ versionOf: source, language: 'english' })).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    // Its script changed (a price): the version differs until « Reprendre la structure », its texts kept.
    const translated = {
      ...view.content,
      description: 'A rainy night.',
      steps: view.content.steps.map((step) => ({
        ...step,
        branches: step.branches.map((one) => ({ ...one, teaser: 'Made up', offerText: 'Made up offer' })),
      })),
    };
    expect(
      (await call('owner', 'PUT', `${base(nora)}/${english}`, { basedOnRevision: 1, content: translated }))
        .statusCode,
    ).toBe(200);
    const repriced = {
      ...CONTENT,
      steps: CONTENT.steps.map((step, at) =>
        at === 1 ? { ...step, branches: step.branches.map((one) => ({ ...one, priceMinor: 1800 })) } : step,
      ),
    };
    expect(
      (await call('owner', 'PUT', `${base(nora)}/${source}`, { basedOnRevision: 1, content: repriced }))
        .statusCode,
    ).toBe(200);
    const differs = PreparedScriptViewSchema.parse(
      (await call('owner', 'GET', `${base(nora)}/${english}`)).json(),
    );
    expect(differs.gaps.map((gap) => gap.code)).toContain('version_differs');
    const resynced = await call('owner', 'POST', `${base(nora)}/${english}/resync`, { basedOnRevision: 2 });
    expect(resynced.statusCode).toBe(200);
    const right = PreparedScriptViewSchema.parse(resynced.json());
    expect(right.gaps.map((gap) => gap.code)).not.toContain('version_differs');
    expect(right.content.steps[1]?.branches[0]).toMatchObject({
      priceMinor: 1800,
      offerText: 'Made up offer',
    });
    // A script of its own has no structure to take back.
    expect(
      (await call('owner', 'POST', `${base(nora)}/${source}/resync`, { basedOnRevision: 2 })).statusCode,
    ).toBe(404);
  });

  it('gives the agent a recognised version with its language and family, only while it keeps its script (ADR 0169)', async () => {
    const source = newId(PreparedScriptIdSchema);
    const english = newId(PreparedScriptIdSchema);
    const content = { ...CONTENT, name: 'Soirée famille inventée' };
    await call('owner', 'POST', base(nora), { id: source, platformAccountId: noraAccount, content });
    await call('owner', 'POST', `${base(nora)}/${source}/versions`, {
      id: english,
      language: 'english',
      name: 'Family night',
    });
    const native = newId(z.uuid());
    await test.admin.db.insert(schema.platformScripts).values({
      id: native,
      creatorId: nora,
      platformAccountId: noraAccount,
      platformScriptRef: `sequence_${native}`,
      name: 'Family night',
      fingerprint: `empreinte-${native}`,
      syncedAt: new Date(),
      versionAt: new Date(),
    });
    await test.admin.db
      .update(schema.preparedScripts)
      .set({ state: 'matched', matchedPlatformScriptId: native, matchedAt: new Date() })
      .where(eq(schema.preparedScripts.id, english));
    const oursOf = async () =>
      (await app.modules.scripts.forJobs.accountScripts(nora, noraAccount)).find((each) => each.id === native)
        ?.ours;
    expect(await oursOf()).toMatchObject({
      preparedScriptId: english,
      language: 'english',
      versionOf: source,
    });
    // Its script given another media since: the version is no longer offered.
    await test.admin.db
      .update(schema.preparedScripts)
      .set({
        content: {
          ...content,
          steps: content.steps.map((step) => ({
            ...step,
            branches: step.branches.map((one) => ({ ...one, media: [{ ref: 'media_09' }] })),
          })),
        },
      })
      .where(eq(schema.preparedScripts.id, source));
    expect(await oursOf()).toBeNull();
  });

  it('is read by the owner and the managers of her list only; anyone else is refused', async () => {
    const listed = await call('manager', 'GET', base(nora));
    expect(listed.statusCode).toBe(200);
    const [first] = PreparedScriptListSchema.parse(listed.json());
    if (first === undefined) throw new Error('no script listed');
    // Her own account and the manager of another creator stop at the role and her list (403); a chatter of her list
    // at her scripts (404).
    for (const who of ['chatter', 'nora', 'other'] as const) {
      const expected = who === 'chatter' ? 404 : 403;
      expect((await call(who, 'GET', base(nora))).statusCode, who).toBe(expected);
      expect((await call(who, 'GET', `${base(nora)}/${first.id}`)).statusCode, who).toBe(expected);
      const write = await call(who, 'PUT', `${base(nora)}/${first.id}`, {
        basedOnRevision: first.revision,
        content: CONTENT,
      });
      expect([403, 404], who).toContain(write.statusCode);
    }
    // The manager of Inès reads none of Nora's, and Nora's ids do not exist on Inès.
    expect((await call('owner', 'GET', `${base(ines)}/${first.id}`)).statusCode).toBe(404);
    expect(PreparedScriptListSchema.parse((await call('owner', 'GET', base(ines))).json())).toEqual([]);
  });
});
