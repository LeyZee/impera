import {
  ApiErrorSchema,
  newId,
  PERSONA_CORRECTIONS_OPEN_MAX,
  PersonaCorrectionIdSchema,
  PersonaCorrectionListSchema,
  PersonaCorrectionSchema,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

// Invented accounts and creators (ADR 0010).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatter', password: 'horse staple battery' };
const ANNA = { email: 'anna@example.test', name: 'Anna', password: 'battery staple horse' };
const BEA = { email: 'bea@example.test', name: 'Bea', password: 'battery horse staple' };

describe('persona corrections (recette CREA-01 b)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let manager: string;
  let chatter: string;
  let anna: string;
  let bea: string;
  let annaId: CreatorId;
  let beaId: CreatorId;

  const list = (creatorId: string, cookie: string) =>
    server.inject({
      method: 'GET',
      url: `/v1/creators/${creatorId}/persona/corrections`,
      headers: { cookie },
    });
  const propose = (creatorId: string, cookie: string, payload: object) =>
    server.inject({
      method: 'POST',
      url: `/v1/creators/${creatorId}/persona/corrections`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const done = (creatorId: string, correctionId: string, cookie: string) =>
    server.inject({
      method: 'POST',
      url: `/v1/creators/${creatorId}/persona/corrections/${correctionId}/done`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  const codeOf = (body: unknown): string | undefined => ApiErrorSchema.safeParse(body).data?.error.code;

  const account = async (who: typeof OWNER, role: 'operator' | 'creator', creatorIds: string[]) => {
    const { userId } = await createOwner(app.auth, app.db.db, who);
    await test.admin.db.update(schema.user).set({ role, creatorIds }).where(eq(schema.user.id, userId));
    return userId;
  };
  const member = (userId: string, teamRole: 'manager' | 'chatter') =>
    test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: teamRole,
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
    });

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
    annaId = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    beaId = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    await member(await account(MANAGER, 'operator', [annaId]), 'manager');
    await member(await account(CHATTER, 'operator', [annaId]), 'chatter');
    await account(ANNA, 'creator', [annaId]);
    await account(BEA, 'creator', [beaId]);
    owner = await signIn(server, OWNER.email, OWNER.password);
    manager = await signIn(server, MANAGER.email, MANAGER.password);
    chatter = await signIn(server, CHATTER.email, CHATTER.password);
    anna = await signIn(server, ANNA.email, ANNA.password);
    bea = await signIn(server, BEA.email, BEA.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('takes her correction once, shows it to her and to the agency, and lets the owner alone mark it handled', async () => {
    const id = newId(PersonaCorrectionIdSchema);
    const body = { id, section: 'tastes', text: '  Je n’aime plus le café, plutôt le thé.  ' };
    const sent = await propose(annaId, anna, body);
    expect(sent.statusCode, sent.body).toBe(201);
    const stored = PersonaCorrectionSchema.parse(sent.json());
    expect(stored).toMatchObject({ id, section: 'tastes', text: 'Je n’aime plus le café, plutôt le thé.' });
    expect(stored).toMatchObject({ state: 'open', doneAt: null });

    // Sent again (a double tap, a retry): the same one, never two; with other words, refused.
    expect((await propose(annaId, anna, body)).json()).toEqual(stored);
    const changed = await propose(annaId, anna, { ...body, text: 'Autre chose' });
    expect([changed.statusCode, codeOf(changed.json())]).toEqual([409, 'persona_correction_conflict']);

    const read = (cookie: string, creatorId: string = annaId) =>
      list(creatorId, cookie).then((r) => PersonaCorrectionListSchema.parse(r.json()).corrections);
    expect(await read(anna)).toEqual([stored]);
    expect(await read(owner)).toEqual([stored]);
    expect(await read(manager)).toEqual([stored]);
    // A chatter answers her fans with the sheet in force; her proposals are the agency's to read.
    expect((await list(annaId, chatter)).statusCode).toBe(403);

    // Hers only: another creator neither reads nor writes them, nor proposes under her name.
    expect(await read(bea, beaId)).toEqual([]);
    expect((await list(annaId, bea)).statusCode).toBe(403);
    expect((await propose(annaId, bea, { ...body, id: newId(PersonaCorrectionIdSchema) })).statusCode).toBe(
      403,
    );
    const sameId = await propose(beaId, bea, body);
    expect([sameId.statusCode, codeOf(sameId.json())]).toEqual([409, 'persona_correction_conflict']);

    // Only she proposes; only the owner, who changes her persona, marks it handled.
    expect((await propose(annaId, owner, { ...body, id: newId(PersonaCorrectionIdSchema) })).statusCode).toBe(
      403,
    );
    for (const cookie of [anna, manager, chatter])
      expect((await done(annaId, id, cookie)).statusCode).toBe(403);
    const handled = await done(annaId, id, owner);
    expect(handled.statusCode, handled.body).toBe(200);
    const after = PersonaCorrectionSchema.parse(handled.json());
    expect(after.state).toBe('done');
    expect(after.doneAt).not.toBeNull();
    expect((await done(annaId, id, owner)).json()).toEqual(after);
    expect((await read(anna))[0]?.state).toBe('done');

    const unknown = await done(annaId, newId(PersonaCorrectionIdSchema), owner);
    expect([unknown.statusCode, codeOf(unknown.json())]).toEqual([404, 'persona_correction_not_found']);
    expect((await done(beaId, id, owner)).statusCode).toBe(404);
  });

  it('refuses an empty correction, an unknown section, and more open ones than the agency can read', async () => {
    const one = (text: string, section = 'limits') =>
      propose(beaId, bea, { id: newId(PersonaCorrectionIdSchema), section, text });
    expect((await one('   ')).statusCode).toBe(400);
    expect((await one('x'.repeat(601))).statusCode).toBe(400);
    expect((await one('Mes stratégies', 'strategies')).statusCode).toBe(400);

    for (let n = 0; n < PERSONA_CORRECTIONS_OPEN_MAX; n += 1) {
      expect((await one(`Correction ${String(n + 1)}`)).statusCode).toBe(201);
    }
    const over = await one('Une de trop');
    expect([over.statusCode, codeOf(over.json())]).toEqual([429, 'persona_corrections_limited']);

    // Once the owner handles one, she may send another.
    const [first] = PersonaCorrectionListSchema.parse((await list(beaId, owner)).json()).corrections;
    expect((await done(beaId, first?.id ?? '', owner)).statusCode).toBe(200);
    expect((await one('Une de plus')).statusCode).toBe(201);
  });
});
