import {
  CreatorIdSchema,
  DetectedLinkSchema,
  LinkProposalsResponseSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
  type DetectedLink,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { LinkServiceError, type LinkServiceReader } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const KEY = 'FAKE-link-service-key-accepted';

const detected = (ref: string, name: string, url: string): DetectedLink =>
  DetectedLinkSchema.parse({ ref, name, url });

/**
 * « Détecter ses liens » (INS-02, ADR 0120 § 3) through the real app, against a redirect service in memory: the
 * agency's account lists the links of every creator, so the owner alone reads it. Invented data only (ADR 0010).
 */
describe('POST /v1/creators/:creatorId/redirect-links/detect', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let outage: LinkServiceError | null = null;
  let reads = 0;
  /** What happens in the base while the service is being read. */
  let meanwhile: (() => Promise<unknown>) | null = null;
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };

  const atService: DetectedLink[] = [
    detected(`lnk_${'0'.repeat(23)}a`, 'Nora story du jour', 'https://liens.example.test/nora-story'),
    detected(`lnk_${'0'.repeat(23)}b`, 'Ines Telegram', 'https://liens.example.test/ines-tg'),
    detected(`lnk_${'0'.repeat(23)}c`, 'Nora bio', 'https://liens.example.test/nora-bio'),
  ];

  const readerOf = (): LinkServiceReader => ({
    ping: () => Promise.resolve(),
    listLinks: async () => {
      reads += 1;
      await meanwhile?.();
      if (outage !== null) throw outage;
      return atService;
    },
    readHours: () => Promise.resolve([]),
    readRobotHours: () => Promise.resolve([]),
  });

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  const detect = (creatorId: CreatorId, who: keyof typeof cookies = 'owner') =>
    call('POST', `/v1/creators/${creatorId}/redirect-links/detect`, who);

  async function kept(): Promise<number> {
    const result = await test.admin.db.execute(sql`select count(*)::int as n from redirect_links`);
    return z.array(z.object({ n: z.number() })).parse(result.rows)[0]?.n ?? 0;
  }

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
      LINK_SERVICE_ORIGIN: 'https://liens.example',
    });
    const logger = createLogger(config);
    app = await createApp(config, logger, { linkServiceReaderOf: readerOf });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const [who, teamRole] of [
      ['manager', 'manager'],
      ['chatter', 'chatter'],
    ] as const) {
      const member = await account(`${who}@example.test`, { role: 'operator', creatorIds: [nora, ines] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[who] = member.cookie;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('says a key is missing before the owner gave one, without asking the service', async () => {
    const response = await detect(nora);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'link_service_unprocessable', details: { kind: 'not_connected' } },
    });
    expect(reads).toBe(0);
  });

  it('proposes the links of the account to the owner, and writes nothing', async () => {
    expect((await call('PUT', '/v1/settings/link-service/key', 'owner', { key: KEY })).statusCode).toBe(200);
    const known = await call('POST', `/v1/creators/${nora}/redirect-links`, 'owner', {
      name: 'Ma bio',
      url: 'https://liens.example.test/nora-bio',
      destination: '',
      placement: 'other_network',
      usageNote: '',
      enabled: true,
    });
    expect(known.statusCode, known.body).toBe(200);
    const before = await kept();

    const response = await detect(nora);
    expect(response.statusCode, response.body).toBe(200);
    const { proposals } = LinkProposalsResponseSchema.parse(response.json());
    expect(proposals.map((one) => [one.name, one.placement, one.knownAs !== null])).toEqual([
      ['Ines Telegram', 'telegram_channel', false],
      ['Nora story du jour', 'story_daily', false],
      ['Ma bio', 'other_network', true],
    ]);
    expect(response.body).not.toContain(KEY);
    expect(await kept()).toBe(before);
  });

  it('is the owner’s only: the account lists every creator’s links', async () => {
    const before = reads;
    const anonymous = await server.inject({
      method: 'POST',
      url: `/v1/creators/${nora}/redirect-links/detect`,
      headers: { origin: DASHBOARD_ORIGIN },
    });
    expect(anonymous.statusCode).toBe(401);
    for (const who of ['manager', 'chatter', 'nora'] as const) {
      const refused = await detect(nora, who);
      expect(refused.statusCode, who).toBe(403);
      expect(refused.body).not.toContain('liens.example.test');
    }
    expect(reads).toBe(before);
  });

  it('asks nothing outside for a creator that does not exist', async () => {
    const before = reads;
    const response = await detect(newId(CreatorIdSchema));
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(reads).toBe(before);
  });

  it('says why the service was not read, and never answers a partial list', async () => {
    outage = new LinkServiceError('rate_limited', 30);
    const limited = await detect(ines);
    expect(limited.statusCode).toBe(422);
    expect(limited.json()).toMatchObject({ error: { details: { kind: 'rate_limited' } } });
    outage = new LinkServiceError('unauthorized');
    expect((await detect(ines)).json()).toMatchObject({ error: { details: { kind: 'unauthorized' } } });
    outage = null;
  });

  describe('POST /v1/creators/:creatorId/redirect-links/:linkId/attach', () => {
    const REF = `lnk_${'0'.repeat(23)}c`;
    const linkOf = (name: string, url: string) => ({
      name,
      url,
      destination: '',
      placement: 'other_network',
      usageNote: '',
      enabled: true,
    });
    const Link = z.object({ id: z.string(), attached: z.boolean() });
    const links = async (creatorId: CreatorId) =>
      z
        .object({ links: z.array(Link.extend({ name: z.string() })) })
        .parse((await call('GET', `/v1/creators/${creatorId}/redirect-links`, 'owner')).json()).links;
    const attach = (creatorId: CreatorId, linkId: string, who: keyof typeof cookies = 'owner') =>
      call('POST', `/v1/creators/${creatorId}/redirect-links/${linkId}/attach`, who);
    const refOf = async (linkId: string) => {
      const [row] = await test.admin.db
        .select({ serviceRef: schema.redirectLinks.serviceRef })
        .from(schema.redirectLinks)
        .where(eq(schema.redirectLinks.id, linkId));
      return row?.serviceRef ?? null;
    };
    let bio = '';

    it('keeps the reference the service gives for the link’s own address, and never sends it back', async () => {
      bio = (await links(nora)).find((one) => one.name === 'Ma bio')?.id ?? '';
      expect(await refOf(bio)).toBeNull();
      const response = await attach(nora, bio);
      expect(response.statusCode, response.body).toBe(200);
      expect(Link.parse(response.json()).attached).toBe(true);
      expect(response.body).not.toContain(REF);
      expect(await refOf(bio)).toBe(REF);
      const listed = await call('GET', `/v1/creators/${nora}/redirect-links`, 'owner');
      expect(listed.body).not.toContain(REF);
      expect((await links(nora)).find((one) => one.id === bio)?.attached).toBe(true);
    });

    it('is the owner’s only, and asks nothing outside for anyone else', async () => {
      const before = reads;
      for (const who of ['manager', 'chatter', 'nora'] as const)
        expect((await attach(nora, bio, who)).statusCode, who).toBe(403);
      // A link of another creator is not found under this one.
      expect((await attach(ines, bio)).statusCode).toBe(404);
      expect(reads).toBe(before);
    });

    it('refuses a link the service does not have, and one already attached, without a name', async () => {
      const unknown = await call(
        'POST',
        `/v1/creators/${nora}/redirect-links`,
        'owner',
        linkOf('Ailleurs', 'https://liens.example.test/inconnu'),
      );
      const unmatched = await attach(nora, Link.omit({ attached: true }).parse(unknown.json()).id);
      expect(unmatched.statusCode).toBe(409);
      expect(unmatched.json()).toMatchObject({ error: { code: 'redirect_link_unmatched_conflict' } });

      // Inès is given the address of Nora's attached link: the link of the service stays Nora's.
      const copy = await call(
        'POST',
        `/v1/creators/${ines}/redirect-links`,
        'owner',
        linkOf('Bio copiée', 'https://liens.example.test/nora-bio'),
      );
      const copyId = Link.omit({ attached: true }).parse(copy.json()).id;
      const taken = await attach(ines, copyId);
      expect(taken.statusCode).toBe(409);
      expect(taken.json()).toMatchObject({ error: { code: 'redirect_link_attached_conflict' } });
      expect(taken.body).not.toContain('Nora');
      expect(await refOf(copyId)).toBeNull();
    });

    it('writes nothing when the service does not answer', async () => {
      outage = new LinkServiceError('unavailable');
      const story = await call(
        'POST',
        `/v1/creators/${nora}/redirect-links`,
        'owner',
        linkOf('Story', 'https://liens.example.test/nora-story'),
      );
      const storyId = Link.omit({ attached: true }).parse(story.json()).id;
      const response = await attach(nora, storyId);
      expect(response.statusCode).toBe(422);
      expect(await refOf(storyId)).toBeNull();
      outage = null;
    });

    it('attaches nothing to a link whose address changed while the service was read', async () => {
      const story = (await links(nora)).find((one) => one.name === 'Story')?.id ?? '';
      meanwhile = () =>
        test.admin.db
          .update(schema.redirectLinks)
          .set({ url: 'https://liens.example.test/autre-story' })
          .where(eq(schema.redirectLinks.id, story));
      const response = await attach(nora, story);
      meanwhile = null;
      expect(response.statusCode, response.body).toBe(404);
      expect(await refOf(story)).toBeNull();
    });

    it('detaches a link whose address changes, in the same write', async () => {
      const moved = await call(
        'PUT',
        `/v1/creators/${nora}/redirect-links/${bio}`,
        'owner',
        linkOf('Ma bio', 'https://liens.example.test/nouvelle-bio'),
      );
      expect(moved.statusCode, moved.body).toBe(200);
      expect(Link.parse(moved.json()).attached).toBe(false);
      expect(await refOf(bio)).toBeNull();
    });

    it('keeps a link attached when anything but its address changes', async () => {
      const back = await call(
        'PUT',
        `/v1/creators/${nora}/redirect-links/${bio}`,
        'owner',
        linkOf('Ma bio', 'https://liens.example.test/nora-bio'),
      );
      expect(back.statusCode).toBe(200);
      expect((await attach(nora, bio)).statusCode).toBe(200);
      const renamed = await call(
        'PUT',
        `/v1/creators/${nora}/redirect-links/${bio}`,
        'owner',
        linkOf('Ma bio Insta', 'https://liens.example.test/nora-bio/'),
      );
      expect(Link.parse(renamed.json()).attached).toBe(true);
      expect(await refOf(bio)).toBe(REF);
    });
  });
});
