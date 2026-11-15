import { randomBytes } from 'node:crypto';

import { eq, parseEncryptionKeys, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createSalesFeedKeyStore, resealSalesFeedKeys } from '../sales-feed-keys';
import { createSalesFeedWebhookStore, resealSalesFeedWebhookSecrets } from '../sales-feed-webhooks';

const FAKE_KEY = 'rvl_FAKEFAKEFAKEFAKEFAKE';
const by = { userId: null, ip: null };
const newKey = (version: string) => parseEncryptionKeys(`${version}:${randomBytes(32).toString('base64')}`);

/** The sales feed keys follow a rotation of CREDENTIALS_ENCRYPTION_KEYS (ops:reencrypt-credentials, ADR 0050 § 4). */
describe('sales feed key store', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('re-seals with the newest key, once, after which the old one can go', async () => {
    const v1 = newKey('v1');
    const v2 = newKey('v2');
    const both = [...v2, ...v1];
    await createSalesFeedKeyStore(test.service.db, v1).save('reveal', FAKE_KEY, ['sales'], new Date(), by);

    expect(await resealSalesFeedKeys(test.admin.db, both, true)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: [],
    });
    expect(await resealSalesFeedKeys(test.admin.db, both)).toEqual({
      total: 1,
      rewritten: 1,
      unreadable: [],
    });
    expect(await resealSalesFeedKeys(test.admin.db, both)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: [],
    });

    const v2Only = createSalesFeedKeyStore(test.service.db, v2);
    expect(await v2Only.find('reveal')).toMatchObject({ key: FAKE_KEY, state: 'connected' });
    const [row] = await withAdmin(test.admin.db, (tx) => tx.select().from(schema.salesFeedCredentials));
    expect(row?.keyVersion).toBe('v2');
    const audit = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'sales_feed_key.reencrypted')),
    );
    // One line for the run that re-sealed, none for the dry run nor the one with nothing left to do.
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(FAKE_KEY);
    await v2Only.remove('reveal', by);
  });

  it('leaves a key no listed encryption key opens, names its platform, and reads it as one to connect again', async () => {
    const lost = newKey('v1');
    await createSalesFeedKeyStore(test.service.db, lost).save('reveal', FAKE_KEY, ['sales'], new Date(), by);
    const stranger = newKey('v3');

    expect(await resealSalesFeedKeys(test.admin.db, stranger)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: ['reveal'],
    });
    expect(await createSalesFeedKeyStore(test.service.db, stranger).find('reveal')).toMatchObject({
      key: null,
      state: 'needs_reconnect',
    });
    expect(await createSalesFeedKeyStore(test.service.db, lost).find('reveal')).toMatchObject({
      key: FAKE_KEY,
    });
    await createSalesFeedKeyStore(test.service.db, lost).remove('reveal', by);
  });

  it('re-seals a webhook’s secret the same way, and names one no listed key opens', async () => {
    const v1 = newKey('v1');
    const v2 = newKey('v2');
    const created = { platformWebhookId: 'webhook_test_01', secret: 'whsec_FAKEFAKEFAKE' };
    await createSalesFeedWebhookStore(test.service.db, v1).save(
      'reveal',
      created,
      'https://impera.example.test/v1/webhooks/sales-feeds/reveal',
      new Date(),
      by,
    );
    expect(await resealSalesFeedWebhookSecrets(test.admin.db, [...v2, ...v1])).toEqual({
      total: 1,
      rewritten: 1,
      unreadable: [],
    });
    expect(await createSalesFeedWebhookStore(test.service.db, v2).find('reveal')).toMatchObject({
      secret: created.secret,
    });
    const [row] = await withAdmin(test.admin.db, (tx) => tx.select().from(schema.salesFeedWebhooks));
    expect(row?.keyVersion).toBe('v2');
    expect(row?.secretCiphertext.toString('utf8')).not.toContain(created.secret);

    const stranger = newKey('v3');
    expect(await resealSalesFeedWebhookSecrets(test.admin.db, stranger, true)).toEqual({
      total: 1,
      rewritten: 0,
      unreadable: ['reveal (webhook)'],
    });
    expect(await createSalesFeedWebhookStore(test.service.db, stranger).find('reveal')).toMatchObject({
      secret: null,
    });
    await createSalesFeedWebhookStore(test.service.db, v2).remove('reveal', by);
  });
});
