import { randomBytes } from 'node:crypto';

import { CreatorIdSchema, newId, PlatformAccountIdSchema, TelegramBotIdSchema } from '@nirvana/contracts';
import {
  createDbClient,
  encryptSecret,
  parseEncryptionKeys,
  schema,
  sql,
  withAdmin,
  type DbClient,
} from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { checkEncryptionKeys, READ_ONLY_POOL_OPTIONS } from '../key-check';
import { createPostgresCredentialStore } from '../modules/providers/infra/postgres.store';
import { createPostgresTelegramStore } from '../modules/telegram/infra/postgres.store';

const newKeys = () => parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`);

/** ADR 0028 § 7: the kept copy of the keys opens every sealed column, read only, invented data only (ADR 0010). */
describe('ops:check-keys', () => {
  let test: TestDb;
  let readOnly: DbClient;
  const session = newKeys();
  const credentials = newKeys();
  const accountId = newId(PlatformAccountIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    readOnly = createDbClient(test.adminUrl, READ_ONLY_POOL_OPTIONS);
    const creatorId = newId(CreatorIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.creators)
        .values({ id: creatorId, nameKey: creatorId, displayName: 'Nora Vidal', timezone: 'Europe/Paris' });
      await tx.insert(schema.platformAccounts).values({
        id: accountId,
        creatorId,
        platform: 'reveal',
        handle: 'nora-vidal',
        sessionCiphertext: encryptSecret('{"cookie":"invented"}', session, accountId),
      });
    });
    await createPostgresCredentialStore({ adminDb: test.admin.db, keys: credentials }).save({
      provider: 'xai',
      key: 'xai-FAKEFAKEFAKEFAKEFAKEFAKEFAKE0000',
      keyLabel: null,
      summary: 'Clé de démonstration',
      facts: [],
      settings: {},
      voices: [],
      state: 'connected',
      verifiedAt: new Date('2026-10-27T10:00:00Z'),
      charactersLeft: null,
      lastErrorKind: null,
      revision: 0,
    });
    await createPostgresTelegramStore({ adminDb: test.admin.db, keys: credentials }).bots.insertBot({
      id: newId(TelegramBotIdSchema),
      telegramBotId: '100000001',
      username: 'nirvana_demo_bot',
      displayName: 'Démo',
      token: '100000001:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK',
      state: 'active',
    });
  });

  afterAll(async () => {
    await readOnly.close();
    await test.close();
  });

  it('opens every sealed row with the right copy', async () => {
    expect(await checkEncryptionKeys(readOnly.db, { session, credentials })).toEqual([
      expect.objectContaining({ keys: 'SESSION_ENCRYPTION_KEYS', total: 1, unreadable: [] }),
      expect.objectContaining({ keys: 'CREDENTIALS_ENCRYPTION_KEYS', total: 1, unreadable: [] }),
      expect.objectContaining({ keys: 'CREDENTIALS_ENCRYPTION_KEYS', total: 1, unreadable: [] }),
    ]);
  });

  it('names what a stale copy does not open, never a secret', async () => {
    const families = await checkEncryptionKeys(readOnly.db, { session: newKeys(), credentials: newKeys() });
    expect(families.map((family) => family.unreadable)).toEqual([[accountId], ['xai'], ['nirvana_demo_bot']]);
    expect(JSON.stringify(families)).not.toContain('FAKE');
    expect(JSON.stringify(families)).not.toContain('invented');
  });

  it('runs on a connection the database keeps read only', async () => {
    await expect(readOnly.db.execute(sql`delete from provider_credentials`)).rejects.toMatchObject({
      cause: { code: '25006' },
    }); // read_only_sql_transaction
  });
});
