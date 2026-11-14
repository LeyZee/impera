import { newId, TeamMemberIdSchema } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner, currentUserById, resolveActor } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';

import { testConfig } from './support/config';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR_ID = '00000000-0000-4000-8000-000000000001';

/** The shift of the test opens the first creator of the member's list, whatever the hour. */
const shiftCreators = (_userId: string, creatorIds: readonly string[]): Promise<string[]> =>
  Promise.resolve(creatorIds.slice(0, 1));

describe('resolveActor: an account read by its id as a session is read (ADR 0026 § 4, ADR 0105 § 1)', () => {
  let test: TestDb;
  let app: App;
  let ownerId = '';
  let operatorId = '';

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    ownerId = (await createOwner(app.auth, app.db.db, OWNER)).userId;
    operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [CREATOR_ID] })
      .where(eq(schema.user.id, operatorId));
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('answers null for an account that does not exist', async () => {
    expect(await resolveActor(app.db.db, shiftCreators, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('says whether the second factor is active, without guessing it', async () => {
    const before = await resolveActor(app.db.db, shiftCreators, ownerId);
    expect(before?.user.role).toBe('owner');
    expect(before?.membership.teamScope).toBe('owner');
    expect(before?.secondFactorEnabled).toBe(false);
    await test.admin.db
      .update(schema.user)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.user.id, ownerId));
    expect((await resolveActor(app.db.db, shiftCreators, ownerId))?.secondFactorEnabled).toBe(true);
  });

  it('gives a chatter at work the creators his shift opens, and a member who left nothing', async () => {
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: operatorId,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Chatteur',
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
    });
    const atWork = await resolveActor(app.db.db, shiftCreators, operatorId);
    expect(atWork?.user.creatorIds).toEqual([]);
    expect(atWork?.user.routedCreatorIds).toEqual([CREATOR_ID]);
    expect(atWork?.user.shiftCreatorIds).toEqual([CREATOR_ID]);
    expect(atWork?.membership.team?.role).toBe('chatter');
    expect(atWork?.membership.teamScope).toBe('self');

    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left', leftOn: '2026-11-01' })
      .where(eq(schema.teamMembers.userId, operatorId));
    expect(await resolveActor(app.db.db, shiftCreators, operatorId)).toBeNull();
    expect(await currentUserById(app.db.db, shiftCreators, operatorId)).toBeNull();
  });
});
