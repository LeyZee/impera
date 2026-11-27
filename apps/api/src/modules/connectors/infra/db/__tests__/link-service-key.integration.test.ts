import { randomBytes } from 'node:crypto';

import { parseEncryptionKeys, schema, sql, eq } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createLinkServiceKeyStore, resealLinkServiceKey } from '../link-service-key';

const FAKE_KEY = 'FAKE-link-service-key-0000';
const by = { userId: null, ip: null };
const denied = (error: unknown): boolean =>
  error instanceof Error && error.cause instanceof Error && error.cause.message.includes('permission denied');
const newKey = (version: string) => parseEncryptionKeys(`${version}:${randomBytes(32).toString('base64')}`);

/** The agency's key of the redirect service (ADR 0120 § 3): sealed, one row, closed to the application role. */
describe('link service key store', () => {
  let test: TestDb;
  const keys = newKey('v1');

  const audit = () =>
    test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'link_service_credential'))
      .orderBy(schema.auditLog.createdAt);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  beforeEach(async () => {
    await test.admin.db.execute(sql`delete from link_service_credentials`);
  });

  afterAll(async () => {
    await test.close();
  });

  it('keeps one sealed key, replaces it, removes it, each with its line', async () => {
    const store = createLinkServiceKeyStore(test.service.db, keys);
    expect(await store.find()).toBeNull();
    expect(await store.remove(by)).toBe(false);

    await store.save(FAKE_KEY, new Date('2026-11-21T10:00:00Z'), by);
    await store.save(`${FAKE_KEY}-bis`, new Date('2026-11-21T11:00:00Z'), by);
    expect(await store.find()).toEqual({
      key: `${FAKE_KEY}-bis`,
      connectedAt: new Date('2026-11-21T11:00:00Z'),
    });

    const rows = await test.admin.db.select().from(schema.linkServiceCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyCiphertext.toString('utf8')).not.toContain(FAKE_KEY);
    expect(rows[0]?.keyCiphertext.toString('latin1')).not.toContain(FAKE_KEY);

    expect(await store.remove(by)).toBe(true);
    expect(await store.find()).toBeNull();

    const lines = await audit();
    expect(lines.map((line) => line.action)).toEqual([
      'link_service_key.connected',
      'link_service_key.replaced',
      'link_service_key.disconnected',
    ]);
    expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(lines[0]?.details)).toMatch(/^\{"fingerprint":"[0-9a-f]{8}"\}$/u);
  });

  it('reads a key no listed encryption key opens as one to paste again', async () => {
    await createLinkServiceKeyStore(test.service.db, keys).save(FAKE_KEY, new Date(), by);
    const found = await createLinkServiceKeyStore(test.service.db, newKey('v2')).find();
    expect(found?.key).toBeNull();
  });

  it('re-seals with the newest key, once, after which the old one can go', async () => {
    const v2 = newKey('v2');
    const both = [...v2, ...keys];
    await createLinkServiceKeyStore(test.service.db, keys).save(FAKE_KEY, new Date(), by);
    expect(await resealLinkServiceKey(test.service.db, both, true)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: [],
    });
    expect(await resealLinkServiceKey(test.service.db, both)).toEqual({
      total: 1,
      rewritten: 1,
      unreadable: [],
    });
    expect(await resealLinkServiceKey(test.service.db, both)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: [],
    });
    expect((await createLinkServiceKeyStore(test.service.db, v2).find())?.key).toBe(FAKE_KEY);
    expect(await resealLinkServiceKey(test.service.db, newKey('v3'), true)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: ['link_service'],
    });
  });

  it('does not open with another secret’s seal', async () => {
    await createLinkServiceKeyStore(test.service.db, keys).save(FAKE_KEY, new Date(), by);
    const [row] = await test.admin.db.select().from(schema.linkServiceCredentials);
    const { decryptSecret } = await import('@impera/db');
    expect(() => decryptSecret(row?.keyCiphertext ?? Buffer.alloc(0), keys, 'sales_feed:reveal')).toThrow();
  });

  it('holds to one row in the base itself', async () => {
    await createLinkServiceKeyStore(test.service.db, keys).save(FAKE_KEY, new Date(), by);
    await expect(
      test.admin.db.execute(
        sql`insert into link_service_credentials (singleton, key_ciphertext, key_version) values (false, '\\x00', 'v1')`,
      ),
    ).rejects.toThrow();
    await expect(
      test.admin.db.execute(
        sql`insert into link_service_credentials (singleton, key_ciphertext, key_version) values (true, '\\x00', 'v1')`,
      ),
    ).rejects.toThrow();
  });

  it('is closed to the application role, whatever it claims to be', async () => {
    await createLinkServiceKeyStore(test.service.db, keys).save(FAKE_KEY, new Date(), by);
    await expect(test.app.db.execute(sql`select * from link_service_credentials`)).rejects.toSatisfy(denied);
    await expect(
      test.app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.team_scope', 'owner', true)`);
        await tx.execute(sql`delete from link_service_credentials`);
      }),
    ).rejects.toSatisfy(denied);
  });
});
