import { randomBytes } from 'node:crypto';

import { eq, parseEncryptionKeys, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { NewCredential } from '../../domain/credential';
import { readSavedProviderKeys } from '../../index';
import { createPostgresCredentialStore, keyFingerprint, resealProviderCredentials } from '../postgres.store';

const FAKE_KEY = 'sk_FAKEFAKEFAKEFAKEFAKEFAKE0000';

const newKey = (version: string) => parseEncryptionKeys(`${version}:${randomBytes(32).toString('base64')}`);

const elevenlabs: NewCredential = {
  provider: 'elevenlabs',
  key: FAKE_KEY,
  keyLabel: null,
  summary: 'Voix de Démo · 1 000 vocaux ce mois',
  facts: [{ label: 'Ce mois', value: '1 000 vocaux possibles' }],
  settings: { voice: { id: 'v-demo', name: 'Démo' } },
  voices: [{ id: 'v-demo', name: 'Démo' }],
  state: 'connected',
  verifiedAt: new Date('2026-10-17T19:00:00Z'),
  charactersLeft: 100_000,
  lastErrorKind: null,
  revision: 0,
};

describe('Postgres credential store (ADR 0016)', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('saves, replaces and removes a key, sealed at rest', async () => {
    const store = createPostgresCredentialStore({ adminDb: test.service.db, keys: newKey('v1') });
    await store.save(elevenlabs);
    const saved = await store.find('elevenlabs');
    expect(saved).toEqual({ ...elevenlabs, revision: saved?.revision });
    expect(saved?.revision).toBeGreaterThan(0);

    await store.save({ ...elevenlabs, state: 'low_credit', charactersLeft: 900 });
    expect(await store.list()).toMatchObject([
      { provider: 'elevenlabs', state: 'low_credit', charactersLeft: 900 },
    ]);

    const [row] = await withAdmin(test.admin.db, (tx) => tx.select().from(schema.providerCredentials));
    expect(row?.keyCiphertext.includes(FAKE_KEY)).toBe(false);
    expect(row?.keyVersion).toBe('v1');

    await store.remove('elevenlabs');
    expect(await store.find('elevenlabs')).toBeNull();
  });

  it('leaves an audit line for each connection, replacement and removal, with a fingerprint and never the key', async () => {
    const store = createPostgresCredentialStore({ adminDb: test.service.db, keys: newKey('v1') });
    const owner = { userId: 'usr_owner', ip: '203.0.113.7' };
    const replacement = 'sk_FAKEREPLACEMENTFAKEKEY00000';
    await store.save(elevenlabs, owner);
    await store.save({ ...elevenlabs, key: replacement }, owner);
    await store.remove('elevenlabs', owner);
    await store.remove('elevenlabs', owner);

    const lines = await withAdmin(test.admin.db, (tx) =>
      tx
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.entity, 'provider_credential'))
        .orderBy(schema.auditLog.createdAt),
    );
    const mine = lines.filter((line) => line.userId === owner.userId);
    expect(mine.map((line) => [line.action, line.userId, line.ip, line.details])).toEqual([
      [
        'provider_key.connected',
        'usr_owner',
        '203.0.113.7',
        { provider: 'elevenlabs', fingerprint: keyFingerprint(FAKE_KEY) },
      ],
      [
        'provider_key.replaced',
        'usr_owner',
        '203.0.113.7',
        { provider: 'elevenlabs', fingerprint: keyFingerprint(replacement) },
      ],
      // The second removal found nothing to remove: no line.
      ['provider_key.disconnected', 'usr_owner', '203.0.113.7', { provider: 'elevenlabs' }],
    ]);
    expect(keyFingerprint(FAKE_KEY)).toMatch(/^[0-9a-f]{8}$/);
    const written = JSON.stringify(lines);
    expect(written).not.toContain(FAKE_KEY);
    expect(written).not.toContain(replacement);
  });

  it('writes a status only over the version it read, never the key', async () => {
    const store = createPostgresCredentialStore({ adminDb: test.service.db, keys: newKey('v1') });
    await store.save(elevenlabs);
    const read = await store.find('elevenlabs');
    if (read === null) throw new Error('saved row not found');

    expect(await store.update({ ...read, state: 'low_credit', key: 'ignored' })).toBe(true);
    const after = await store.find('elevenlabs');
    expect(after).toMatchObject({ state: 'low_credit', key: FAKE_KEY });
    // A second write from the same stale read loses, as a 15-minute check must against a replacement.
    expect(await store.update({ ...read, state: 'needs_reconnect' })).toBe(false);
    expect(await store.find('elevenlabs')).toMatchObject({ state: 'low_credit' });

    await store.remove('elevenlabs');
    expect(await store.update(read)).toBe(false);
    expect(await store.find('elevenlabs')).toBeNull();
  });

  it('reads a key it can no longer open as one to replace, and leaves its seal intact', async () => {
    const original = newKey('v1');
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: original }).save(elevenlabs);
    const logged: string[] = [];
    const rotatedTooEarly = createPostgresCredentialStore({
      adminDb: test.service.db,
      keys: newKey('v2'),
      onUnreadable: (provider) => logged.push(provider),
    });
    const unreadable = await rotatedTooEarly.find('elevenlabs');
    await rotatedTooEarly.list();
    // Said once for the log, however often the row is read.
    expect(logged).toEqual(['elevenlabs']);
    expect(unreadable).toMatchObject({ key: null, state: 'needs_reconnect', lastErrorKind: 'unauthorized' });
    if (unreadable === null) throw new Error('saved row not found');

    await rotatedTooEarly.update({ ...unreadable, settings: {} });
    // Putting the old encryption key back recovers the key.
    const restored = createPostgresCredentialStore({ adminDb: test.service.db, keys: original });
    expect(await restored.find('elevenlabs')).toMatchObject({ key: FAKE_KEY });
  });

  it('rotates the encryption key: re-seals with v2, after which v1 can go (ops:reencrypt-credentials)', async () => {
    const v1 = newKey('v1');
    const v2 = newKey('v2');
    const both = [...v2, ...v1];
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: v1 }).save(elevenlabs);
    const before = await createPostgresCredentialStore({ adminDb: test.service.db, keys: both }).find(
      'elevenlabs',
    );

    expect(await resealProviderCredentials(test.admin.db, both)).toEqual({ rewritten: 1, unreadable: [] });
    expect(await resealProviderCredentials(test.admin.db, both)).toEqual({ rewritten: 0, unreadable: [] });

    const v2Only = createPostgresCredentialStore({ adminDb: test.service.db, keys: v2 });
    const after = await v2Only.find('elevenlabs');
    expect(after).toMatchObject({ key: FAKE_KEY, state: 'connected' });
    // The row's version is kept: a check that read it before the rotation still lands.
    expect(after?.revision).toBe(before?.revision);
    const [row] = await withAdmin(test.admin.db, (tx) => tx.select().from(schema.providerCredentials));
    expect(row?.keyVersion).toBe('v2');

    const audit = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'provider_key.reencrypted')),
    );
    // One line for the run that re-sealed, none for the one with nothing left to do.
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(FAKE_KEY);
    await v2Only.remove('elevenlabs');
  });

  it('leaves a key no listed encryption key opens, and names it', async () => {
    const lost = newKey('v1');
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: lost }).save(elevenlabs);
    expect(await resealProviderCredentials(test.admin.db, newKey('v3'))).toEqual({
      rewritten: 0,
      unreadable: ['elevenlabs'],
    });
    expect(
      await createPostgresCredentialStore({ adminDb: test.service.db, keys: lost }).find('elevenlabs'),
    ).toMatchObject({ key: FAKE_KEY });
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: lost }).remove('elevenlabs');
  });
  it('gives `pnpm evals --key-from-crm` the keys these encryption keys open, and leaves out one they do not', async () => {
    const current = newKey('v1');
    const xaiKey = 'xai-FAKEFAKEFAKEFAKEFAKEFAKE0000';
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: current }).save({
      ...elevenlabs,
      provider: 'xai',
      key: xaiKey,
      settings: {},
      voices: [],
      charactersLeft: null,
    });
    await createPostgresCredentialStore({ adminDb: test.service.db, keys: newKey('v9') }).save({
      ...elevenlabs,
      provider: 'mistral',
      settings: {},
      voices: [],
      charactersLeft: null,
    });

    const keys = await readSavedProviderKeys(test.admin.db, current);

    expect(keys.xai).toBe(xaiKey);
    expect(keys.mistral).toBeUndefined();
  });
});
