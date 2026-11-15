import {
  CreatorIdSchema,
  McpGrantIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withMember } from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

/** A fingerprint of the right form; never a real token (ADR 0010). */
const fingerprint = (n: number): string => `${'A'.repeat(42)}${String.fromCharCode(65 + n)}`;

/**
 * The agent accesses of the MCP server (migration 0193, ADR 0026 § 3, ADR 0105): the owner alone reads, adds and
 * revokes, in his own name; nobody deletes, brings a revoked access back, or changes what an access is; the service
 * role only reads. Invented people and creators only.
 */
describe('mcp_grants (ADR 0026 § 3): the owner’s, added and revoked, read by the service role', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const creatorUser = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  let tokens = 0;

  const grant = (values: Partial<typeof s.mcpGrants.$inferInsert> = {}) => ({
    id: newId(McpGrantIdSchema),
    userId: owner,
    creatorId: nora,
    label: 'Agent inventé',
    capabilities: ['read:status'],
    tokenHash: fingerprint(tokens++ % 26),
    createdBy: owner,
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    ...values,
  });
  const add = (by: string, row: ReturnType<typeof grant>) =>
    withMember(test.app.db, by, (tx) => tx.insert(s.mcpGrants).values(row));
  const read = (by: string) =>
    withMember(test.app.db, by, (tx) => tx.select({ id: s.mcpGrants.id }).from(s.mcpGrants)).then((rows) =>
      rows.map((row) => row.id),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.creators).values({
        id: nora,
        nameKey: nora,
        displayName: 'Créatrice Nora',
        timezone: 'Europe/Paris',
      });
      await tx.insert(s.user).values([
        { id: owner, name: 'Compte owner', email: `${owner}@example.test`, role: 'owner' },
        { id: manager, name: 'Compte manager', email: `${manager}@example.test`, role: 'operator' },
        {
          id: creatorUser,
          name: 'Nora',
          email: `${creatorUser}@example.test`,
          role: 'creator',
          creatorIds: [nora],
        },
      ]);
      await tx.insert(s.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: manager,
        teamRole: 'manager',
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: 'Membre manager',
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('the owner alone adds one, in his own name, and alone reads them', async () => {
    const mine = grant();
    await add(owner, mine);
    expect(await failure(add(manager, grant({ userId: manager, createdBy: manager })))).toMatch(
      /row-level security/u,
    );
    expect(await failure(add(owner, grant({ userId: manager })))).toMatch(/row-level security/u);
    expect(await read(owner)).toContain(mine.id);
    expect(await read(manager)).toEqual([]);
    const herOwn = await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.select({ id: s.mcpGrants.id }).from(s.mcpGrants),
    );
    expect(herOwn).toEqual([]);
  });

  it('holds closed capabilities, a fingerprint of its form and an expiry within 90 days', async () => {
    expect(await failure(add(owner, grant({ capabilities: ['write:everything'] })))).toMatch(
      /mcp_grants_capabilities_check/u,
    );
    expect(await failure(add(owner, grant({ tokenHash: 'short' })))).toMatch(/mcp_grants_token_hash_check/u);
    expect(await failure(add(owner, grant({ expiresAt: new Date(Date.now() + 91 * 86_400_000) })))).toMatch(
      /mcp_grants_expires_check/u,
    );
    expect(await failure(add(owner, grant({ expiresAt: new Date(Date.now() - 1_000) })))).toMatch(
      /mcp_grants_expires_check/u,
    );
  });

  it('changes only its last use and its revocation, for good, and is never deleted', async () => {
    const row = grant();
    await add(owner, row);
    const update = (set: Partial<typeof s.mcpGrants.$inferInsert>) =>
      withMember(test.app.db, owner, (tx) =>
        tx.update(s.mcpGrants).set(set).where(eq(s.mcpGrants.id, row.id)),
      );
    await update({ lastUsedAt: new Date() });
    expect(await failure(update({ capabilities: ['read:status', 'read:fans'] }))).toMatch(
      /permission denied/u,
    );
    expect(await failure(update({ expiresAt: new Date(Date.now() + 60 * 86_400_000) }))).toMatch(
      /permission denied/u,
    );
    expect(await failure(update({ lastUsedAt: new Date(Date.now() - 86_400_000) }))).toMatch(
      /only moves forward/u,
    );
    expect(await failure(update({ lastUsedAt: null }))).toMatch(/only moves forward/u);
    await update({ revokedAt: new Date(), revokedBy: owner });
    expect(await failure(update({ revokedAt: null, revokedBy: null }))).toMatch(/stays revoked/u);
    expect(
      await failure(
        withMember(test.app.db, owner, (tx) => tx.delete(s.mcpGrants).where(eq(s.mcpGrants.id, row.id))),
      ),
    ).toMatch(/permission denied/u);
  });

  it('the manager’s update reaches no row of the owner', async () => {
    const row = grant();
    await add(owner, row);
    const changed = await withMember(test.app.db, manager, (tx) =>
      tx
        .update(s.mcpGrants)
        .set({ revokedAt: new Date(), revokedBy: manager })
        .where(eq(s.mcpGrants.id, row.id))
        .returning({ id: s.mcpGrants.id }),
    );
    expect(changed).toEqual([]);
  });

  it('the service role reads an access by its fingerprint and writes nothing', async () => {
    const row = grant();
    await add(owner, row);
    const [found] = await withAdmin(test.service.db, (tx) =>
      tx.select({ id: s.mcpGrants.id }).from(s.mcpGrants).where(eq(s.mcpGrants.tokenHash, row.tokenHash)),
    );
    expect(found?.id).toBe(row.id);
    expect(
      await failure(
        withAdmin(test.service.db, (tx) =>
          tx.update(s.mcpGrants).set({ lastUsedAt: new Date() }).where(eq(s.mcpGrants.id, row.id)),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(await failure(withAdmin(test.service.db, (tx) => tx.insert(s.mcpGrants).values(grant())))).toMatch(
      /permission denied/u,
    );
    expect(await failure(test.service.db.execute(sql`delete from mcp_grants`))).toMatch(/permission denied/u);
  });
});
