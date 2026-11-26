import {
  CopilotFanCardFieldSchema,
  CopilotFanNoteSchema,
  ExtensionLinkCreatedSchema,
  ExtensionLinkStatusSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { and, eq, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

interface Person {
  readonly userId: string;
  readonly memberId: string | null;
  readonly cookie: string;
}

/**
 * The two writes the extension's panel makes on a fan (ADR 0109 and its amendment of 21/11): a field of his card
 * (« Corriger ») and a note, with the person's link only, its scope, the shift, then the CRM's own right on the fan; the
 * audit line says `via: 'extension'` and never the value. The link's scopes, read by `GET /v1/extension/link`, and its
 * revocation when the person leaves or changes role (§ 7). Nothing is sent to any fan. Invented data only (ADR 0010).
 */
describe('the copilot panel writes on a fan (ADR 0109)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: Person;
  let anna: CreatorId;
  let bea: CreatorId;
  let annaAccount: string;
  let fan: FanId;
  let beaFan: FanId;
  let people = 0;

  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;

  /** An agency member of Anna (`chatter` scope self, `manager` scope agency), on shift on her from `from` to `to` min. */
  async function member(
    teamRole: 'chatter' | 'manager',
    window?: { from: number; to: number },
  ): Promise<Person> {
    people += 1;
    const email = `${teamRole}-${String(people)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, {
      email,
      name: `Prénom ${String(people)}`,
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [anna] })
      .where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `${teamRole} ${String(people)}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    if (window !== undefined) {
      // An account of hers per shift: an account takes three shifts at once at most (ADR 0049).
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: anna, platform: 'reveal', handle: `shift-${accountId}` });
      const base = Math.floor(Date.now() / MINUTE) * MINUTE;
      await test.admin.db.insert(schema.shifts).values({
        id: newId(ShiftIdSchema),
        creatorId: anna,
        platformAccountId: accountId,
        memberId,
        startsAt: new Date(base + window.from * MINUTE),
        endsAt: new Date(base + window.to * MINUTE),
        createdBy: ownerId,
        updatedBy: ownerId,
      });
    }
    return { userId, memberId, cookie: await signIn(server, email, PASSWORD) };
  }

  const linkOf = async (cookie: string, label = `Panneau ${String(people)}`): Promise<string> => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/trends/extension-links',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { label },
    });
    expect(response.statusCode).toBe(201);
    return ExtensionLinkCreatedSchema.parse(response.json()).token;
  };

  const status = (token: string | null) =>
    server.inject({
      method: 'GET',
      url: '/v1/extension/link',
      headers: token === null ? {} : { 'x-extension-link': token },
    });

  const correct = (
    token: string | null,
    payload: object,
    opts: { creatorId?: string; fanId?: string; cookie?: string } = {},
  ) =>
    server.inject({
      method: 'PUT',
      url: `/v1/copilot/fans/${opts.fanId ?? fan}/card/location?creatorId=${opts.creatorId ?? anna}`,
      headers: {
        ...(token === null ? {} : { 'x-extension-link': token }),
        ...(opts.cookie === undefined ? {} : { cookie: opts.cookie, origin: DASHBOARD_ORIGIN }),
      },
      payload,
    });

  const note = (token: string | null, text: string, opts: { creatorId?: string; fanId?: string } = {}) =>
    server.inject({
      method: 'POST',
      url: `/v1/copilot/fans/${opts.fanId ?? fan}/notes?creatorId=${opts.creatorId ?? anna}`,
      headers: token === null ? {} : { 'x-extension-link': token },
      payload: { note: text },
    });

  const auditOf = (action: string, userId: string) =>
    test.admin.db
      .select({
        entityId: schema.auditLog.entityId,
        details: schema.auditLog.details,
        userId: schema.auditLog.userId,
      })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.userId, userId)));

  const linksOf = (userId: string) =>
    test.admin.db
      .select({ id: schema.extensionLinks.id, revokedAt: schema.extensionLinks.revokedAt })
      .from(schema.extensionLinks)
      .where(eq(schema.extensionLinks.userId, userId));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const created = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, created));
    owner = { userId: ownerId, memberId: null, cookie: await signIn(server, created.email, PASSWORD) };
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    bea = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    annaAccount = newId(PlatformAccountIdSchema);
    const beaAccount = newId(PlatformAccountIdSchema);
    fan = newId(FanIdSchema);
    beaFan = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(schema.platformAccounts).values([
        { id: annaAccount, creatorId: anna, platform: 'reveal', handle: 'anna-demo' },
        { id: beaAccount, creatorId: bea, platform: 'reveal', handle: 'bea-demo' },
      ]);
      await tx.insert(schema.fans).values([
        {
          id: fan,
          creatorId: anna,
          platformAccountId: annaAccount,
          platformFanId: 'fan-1',
          displayName: 'Basile',
        },
        {
          id: beaFan,
          creatorId: bea,
          platformAccountId: beaAccount,
          platformFanId: 'fan-2',
          displayName: 'Côme',
        },
      ]);
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives a new link the scopes of the CRM, and says them with its expiry; an old link has none', async () => {
    const chatter = await member('chatter', { from: -10, to: 60 });
    const token = await linkOf(chatter.cookie);
    const read = await status(token);
    expect(read.statusCode).toBe(200);
    const view = ExtensionLinkStatusSchema.parse(read.json());
    expect(view).toMatchObject({
      role: 'chatter',
      displayName: 'Prénom 1',
      scopes: ['fan_card', 'operator_note'],
    });
    expect(new Date(view.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await status(null)).statusCode).toBe(401);
    expect((await status('a'.repeat(43))).statusCode).toBe(401);

    // A link made before the scopes existed: it still reads, never writes on a fan (§ 5).
    await test.admin.db
      .update(schema.extensionLinks)
      .set({ scopes: [] })
      .where(eq(schema.extensionLinks.userId, chatter.userId));
    expect(ExtensionLinkStatusSchema.parse((await status(token)).json()).scopes).toEqual([]);
    const refused = await correct(token, { items: ['Annecy'] });
    expect(refused.statusCode).toBe(403);
    expect(codeOf(refused)).toBe('extension_link_scope_forbidden');
    expect(codeOf(await note(token, 'Note inventée'))).toBe('extension_link_scope_forbidden');
  });

  it('lets a chatter on shift correct a field and write a note, traced « depuis l’extension » without the value', async () => {
    const chatter = await member('chatter', { from: -10, to: 60 });
    const token = await linkOf(chatter.cookie);

    const written = await correct(token, { items: ['Annecy'] });
    expect(written.statusCode).toBe(200);
    // The field written alone: nothing else of the fan.
    expect(CopilotFanCardFieldSchema.parse(written.json())).toMatchObject({
      field: 'location',
      current: { items: ['Annecy'], source: 'noted', notedBy: chatter.userId },
    });
    const card = await app.modules.fans.card(anna, fan);
    expect(card.fields.find((entry) => entry.field === 'location')?.current?.items).toEqual(['Annecy']);

    const noted = await note(token, '  Préfère qu’on lui écrive le soir  ');
    expect(noted.statusCode).toBe(201);
    const first = CopilotFanNoteSchema.parse(noted.json());
    expect(first).toMatchObject({
      value: 'Préfère qu’on lui écrive le soir',
      source: 'noted',
      notedBy: chatter.userId,
      notedByName: 'Prénom 2',
    });
    expect(first.key).toMatch(/^note_\d+$/);
    // Notes add up, never replace one another.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = CopilotFanNoteSchema.parse((await note(token, 'Aime le jazz')).json());
    expect(second.key).not.toBe(first.key);
    const others = (await app.modules.fans.card(anna, fan)).others.map((other) => other.value);
    expect(others).toEqual(expect.arrayContaining(['Préfère qu’on lui écrive le soir', 'Aime le jazz']));

    const edits = await auditOf('fan_card.edit', chatter.userId);
    expect(edits).toEqual([
      {
        entityId: fan,
        userId: chatter.userId,
        details: { creatorId: anna, via: 'extension', field: 'location' },
      },
    ]);
    const notes = await auditOf('fan_note.create', chatter.userId);
    expect(notes).toHaveLength(2);
    for (const line of notes) expect(line.details).toEqual({ creatorId: anna, via: 'extension' });
    // Never the value, in any audit line of the fan.
    const lines = await test.admin.db.select({ details: schema.auditLog.details }).from(schema.auditLog);
    expect(JSON.stringify(lines)).not.toMatch(/Annecy|jazz|soir/);
  });

  it('refuses out of shift, without a link, on another creator and on a fan she does not have', async () => {
    const later = await member('chatter', { from: 120, to: 240 });
    const token = await linkOf(later.cookie);
    const off = await correct(token, { items: ['Annecy'] });
    expect(off.statusCode).toBe(403);
    expect(codeOf(off)).toBe('copilot_shift_forbidden');
    expect(codeOf(await note(token, 'Note inventée'))).toBe('copilot_shift_forbidden');

    const chatter = await member('chatter', { from: -10, to: 60 });
    const live = await linkOf(chatter.cookie);
    // The dashboard's cookie opens nothing here: the link alone names the person.
    const cookieOnly = await correct(null, { items: ['Annecy'] }, { cookie: chatter.cookie });
    expect(cookieOnly.statusCode).toBe(401);
    expect(codeOf(cookieOnly)).toBe('extension_link_unauthenticated');
    expect((await note('b'.repeat(43), 'Note inventée')).statusCode).toBe(401);

    const elsewhere = await correct(live, { items: ['Annecy'] }, { creatorId: bea, fanId: beaFan });
    expect(elsewhere.statusCode).toBe(403);
    expect(codeOf(elsewhere)).toBe('copilot_shift_forbidden');
    expect((await note(live, 'Note inventée', { fanId: beaFan })).statusCode).toBe(404);
    expect((await correct(live, { items: ['Annecy'] }, { fanId: newId(FanIdSchema) })).statusCode).toBe(404);
    // A body the card refuses, after the link is read.
    expect((await note(live, '   ')).statusCode).toBe(400);
    expect((await note(live, 'x'.repeat(301))).statusCode).toBe(400);
    expect(await auditOf('fan_card.edit', later.userId)).toEqual([]);
  });

  it('lets the owner write on any of her creators, and never a creator’s link', async () => {
    const token = await linkOf(owner.cookie);
    expect(ExtensionLinkStatusSchema.parse((await status(token)).json())).toMatchObject({
      role: 'owner',
      scopes: ['fan_card', 'operator_note'],
    });
    expect(
      (await correct(token, { items: ['Chambéry'] }, { creatorId: bea, fanId: beaFan })).statusCode,
    ).toBe(200);

    const email = 'creator@example.test';
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: 'Anna', password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, userId));
    const hers = await linkOf(await signIn(server, email, PASSWORD));
    expect(ExtensionLinkStatusSchema.parse((await status(hers)).json())).toMatchObject({
      role: 'creator',
      scopes: [],
    });
    expect(codeOf(await note(hers, 'Note inventée'))).toBe('extension_link_scope_forbidden');
  });

  it('revokes a member’s links when he leaves or changes role, each in the audit log (§ 7)', async () => {
    const leaving = await member('chatter', { from: -10, to: 60 });
    const token = await linkOf(leaving.cookie);
    // Two browsers of his.
    await linkOf(leaving.cookie, 'Téléphone');
    const memberId = leaving.memberId ?? '';
    // Away is not gone: his links stay (his reads are closed by the session anyway).
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'on_leave' })
      .where(eq(schema.teamMembers.id, memberId));
    expect((await linksOf(leaving.userId)).filter((link) => link.revokedAt === null)).toHaveLength(2);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left', leftOn: '2026-11-26' })
      .where(eq(schema.teamMembers.id, memberId));
    expect((await linksOf(leaving.userId)).every((link) => link.revokedAt !== null)).toBe(true);
    expect((await status(token)).statusCode).toBe(401);
    const revoked = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'extension_link.revoke'));
    expect(
      revoked.filter(
        (line) => z.object({ reason: z.literal('member_left') }).safeParse(line.details).success,
      ),
    ).toHaveLength(2);

    // A chatter made manager: the link made for a chatter's rights goes; he links again.
    const promoted = await member('chatter', { from: -10, to: 60 });
    await linkOf(promoted.cookie);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ teamRole: 'manager' })
      .where(eq(schema.teamMembers.id, promoted.memberId ?? ''));
    expect((await linksOf(promoted.userId)).every((link) => link.revokedAt !== null)).toBe(true);

    // The account's role changes (a member made creator, an owner's transfer): the same.
    const moved = await member('manager');
    await linkOf(moved.cookie);
    await test.admin.db.update(schema.user).set({ role: 'creator' }).where(eq(schema.user.id, moved.userId));
    expect((await linksOf(moved.userId)).every((link) => link.revokedAt !== null)).toBe(true);

    // Anything else on the row revokes nothing.
    const stays = await member('chatter', { from: -10, to: 60 });
    await linkOf(stays.cookie);
    await test.admin.db
      .update(schema.user)
      .set({ name: 'Autre prénom' })
      .where(eq(schema.user.id, stays.userId));
    await test.admin.db
      .update(schema.teamMembers)
      .set({ displayName: 'autre' })
      .where(eq(schema.teamMembers.id, stays.memberId ?? ''));
    expect((await linksOf(stays.userId)).every((link) => link.revokedAt === null)).toBe(true);
  });
});
