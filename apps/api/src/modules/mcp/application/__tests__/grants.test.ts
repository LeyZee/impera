import { CreatorIdSchema, McpGrantIdSchema, newId, UserIdSchema, type McpGrantId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { GrantRecord, McpGrantStore, NewGrant } from '../../domain/ports';
import { createGrants } from '../grants';

const owner = { userId: newId(UserIdSchema), ip: '127.0.0.1' };
const NOW = new Date('2026-11-14T10:00:00.000Z');
const nora = newId(CreatorIdSchema);

function fakeStore(): McpGrantStore & {
  readonly rows: Map<string, GrantRecord & { tokenHash: string }>;
  touched: number;
  touchable: boolean;
} {
  const rows = new Map<string, GrantRecord & { tokenHash: string }>();
  return {
    rows,
    touched: 0,
    touchable: true,
    list: () => Promise.resolve([...rows.values()]),
    create: (by, grant: NewGrant) => {
      const row = {
        id: grant.id,
        userId: by.userId,
        creatorId: grant.creatorId,
        label: grant.label,
        capabilities: grant.capabilities,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + grant.days * 86_400_000),
        lastUsedAt: null,
        revokedAt: null,
        tokenHash: grant.tokenHash,
      };
      rows.set(grant.id, row);
      return Promise.resolve(row);
    },
    revoke: (_by, id: McpGrantId) => {
      const row = rows.get(id);
      if (row?.revokedAt !== null) return Promise.resolve(false);
      rows.set(id, { ...row, revokedAt: NOW });
      return Promise.resolve(true);
    },
    findByTokenHashUnscoped: (hash) =>
      Promise.resolve([...rows.values()].find((row) => row.tokenHash === hash) ?? null),
    touch() {
      this.touched += 1;
      return Promise.resolve(this.touchable);
    },
  };
}

const setup = (now = NOW) => {
  const store = fakeStore();
  const grants = createGrants({
    store,
    mint: () => ({ token: 'impmcp_inventé', hash: 'hash-inventé' }),
    hashOf: (token) => (token === 'impmcp_inventé' ? 'hash-inventé' : 'autre'),
    now: () => now,
  });
  return { store, grants };
};
const body = { label: 'Agent', creatorId: nora, capabilities: ['read:status' as const], days: 30 };
const asOwner = { role: 'owner' as const, teamScope: 'owner' as const };

describe('agent accesses (ADR 0026 § 3)', () => {
  it('creates one with its expiry in days and its token once', async () => {
    const { grants, store } = setup();
    const result = await grants.create(owner, asOwner, body);
    expect(result.ok && result.value.token).toBe('impmcp_inventé');
    expect(result.ok && result.value.expiresAt).toBe('2026-12-14T10:00:00.000Z');
    expect([...store.rows.values()][0]?.tokenHash).toBe('hash-inventé');
    expect(JSON.stringify(await grants.list(owner))).not.toContain('impmcp_');
  });

  it('refuses what grantProblems refuses, and keeps nothing', async () => {
    const { grants, store } = setup();
    expect(
      await grants.create(owner, asOwner, { ...body, capabilities: ['read:fans', 'read:fans'] }),
    ).toEqual({
      ok: false,
      kind: 'capability_repeated',
    });
    expect(
      await grants.create(
        owner,
        { role: 'operator', teamScope: 'agency' },
        { ...body, capabilities: ['prepare:team'] },
      ),
    ).toEqual({ ok: false, kind: 'owner_only' });
    expect(store.rows.size).toBe(0);
  });

  it('finds a live token and stamps it; nothing for a revoked, expired or unknown one', async () => {
    const { grants, store } = setup();
    const result = await grants.create(owner, asOwner, body);
    if (!result.ok) throw new Error('not created');
    expect((await grants.grantOfToken('impmcp_inventé'))?.id).toBe(result.value.id);
    expect(store.touched).toBe(1);
    store.touchable = false;
    expect(await grants.grantOfToken('impmcp_inventé')).toBeNull();
    store.touchable = true;
    expect(await grants.grantOfToken('impmcp_autre')).toBeNull();
    const later = createGrants({
      store,
      mint: () => ({ token: '', hash: '' }),
      hashOf: () => 'hash-inventé',
      now: () => new Date('2026-12-15T00:00:00.000Z'),
    });
    expect(await later.grantOfToken('impmcp_inventé')).toBeNull();
    expect(await grants.revoke(owner, McpGrantIdSchema.parse(result.value.id))).toBe(true);
    expect(await grants.grantOfToken('impmcp_inventé')).toBeNull();
    expect(await grants.revoke(owner, newId(McpGrantIdSchema))).toBe(false);
    expect(store.touched).toBe(2);
  });
});
