import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvoiceStorageUnavailable } from '../../domain/errors';
import { createMemoryInvoiceStore, createS3InvoiceStore } from '../invoice-buckets';

/** An invented bucket and invented keys (ADR 0010): nothing here reaches a provider. */
const CONFIG = {
  endpoint: 'https://objects.example.test/',
  region: 'eu-central',
  bucket: 'factures-exemple',
  accessKeyId: 'EXAMPLEKEYID',
  secretAccessKey: 'example-secret-for-tests-only',
};
const KEY = 'invoices/2026/0190f1a2-0000-7000-8000-000000000001.pdf';
const BYTES = new TextEncoder().encode('%PDF-1.7 exemple');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const LOCK = new Date('2037-01-01T00:00:00.000Z');

/** A provider that answers `response` and keeps each request it got. */
function provider(response: () => Response): {
  readonly requests: Request[];
  readonly fetch: (request: Request) => Promise<Response>;
} {
  const requests: Request[] = [];
  return {
    requests,
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(response());
    },
  };
}

describe('Équipe › Factures : le dépôt dans un seau S3 verrouillé (ADR 0037 § 4 à § 6)', () => {
  it('sends the PDF once, signed with its SHA-256, under a compliance lock, never over an object', async () => {
    const bucket = provider(() => new Response(null, { status: 200 }));
    const store = createS3InvoiceStore(CONFIG, bucket.fetch);
    expect(await store.writeOnce(KEY, BYTES, SHA, LOCK)).toBe('written');
    const [request] = bucket.requests;
    if (request === undefined) throw new Error('no request');
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(
      'https://objects.example.test/factures-exemple/invoices/2026/0190f1a2-0000-7000-8000-000000000001.pdf',
    );
    expect(Object.fromEntries(request.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'x-amz-content-sha256': SHA,
      'x-amz-checksum-sha256': createHash('sha256').update(BYTES).digest('base64'),
      'content-md5': createHash('md5').update(BYTES).digest('base64'),
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': '2037-01-01T00:00:00.000Z',
      'if-none-match': '*',
    });
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=EXAMPLEKEYID\//u);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(BYTES);
  });

  it('says « exists » when the key already holds an object (412)', async () => {
    const store = createS3InvoiceStore(CONFIG, provider(() => new Response(null, { status: 412 })).fetch);
    expect(await store.writeOnce(KEY, BYTES, SHA, LOCK)).toBe('exists');
  });

  it('refuses to send bytes whose SHA-256 is not the one given', async () => {
    const bucket = provider(() => new Response(null, { status: 200 }));
    const store = createS3InvoiceStore(CONFIG, bucket.fetch);
    await expect(store.writeOnce(KEY, BYTES, '0'.repeat(64), LOCK)).rejects.toThrow(/not that of its bytes/u);
    expect(bucket.requests).toEqual([]);
  });

  it('fails with the provider’s code, never its whole answer, when it refuses', async () => {
    const answer = () =>
      new Response('<Error><Code>AccessDenied</Code><Message>Long text</Message></Error>', { status: 403 });
    const store = createS3InvoiceStore(CONFIG, provider(answer).fetch);
    const write = store.writeOnce(KEY, BYTES, SHA, LOCK);
    await expect(write).rejects.toBeInstanceOf(InvoiceStorageUnavailable);
    await expect(write).rejects.toThrow(
      'factures-exemple: PUT invoices/2026/0190f1a2-0000-7000-8000-000000000001.pdf answered 403 (AccessDenied)',
    );
    await expect(store.read(KEY)).rejects.toThrow(/answered 403 \(AccessDenied\)$/u);
  });

  it('fails as « unavailable » when the provider does not answer', async () => {
    const store = createS3InvoiceStore(CONFIG, () => Promise.reject(new TypeError('fetch failed')));
    await expect(store.read(KEY)).rejects.toBeInstanceOf(InvoiceStorageUnavailable);
    await expect(store.writeOnce(KEY, BYTES, SHA, LOCK)).rejects.toThrow(/no answer for/u);
  });

  it('reads an object with the compliance lock the provider names, and nothing for a missing key', async () => {
    const locked = () =>
      new Response(BYTES, {
        status: 200,
        headers: {
          'x-amz-object-lock-mode': 'COMPLIANCE',
          'x-amz-object-lock-retain-until-date': '2037-01-01T00:00:00Z',
        },
      });
    expect(await createS3InvoiceStore(CONFIG, provider(locked).fetch).read(KEY)).toEqual({
      bytes: BYTES,
      retainUntil: LOCK,
    });
    expect(
      await createS3InvoiceStore(CONFIG, provider(() => new Response(null, { status: 404 })).fetch).read(KEY),
    ).toBeNull();
  });

  it('never takes a governance lock, or a date it cannot read, for a compliance lock', async () => {
    const answer = (headers: Record<string, string>) => () => new Response(BYTES, { status: 200, headers });
    const governance = answer({
      'x-amz-object-lock-mode': 'GOVERNANCE',
      'x-amz-object-lock-retain-until-date': '2037-01-01T00:00:00Z',
    });
    const unreadable = answer({
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': 'soon',
    });
    const none = answer({});
    for (const one of [governance, unreadable, none]) {
      expect((await createS3InvoiceStore(CONFIG, provider(one).fetch).read(KEY))?.retainUntil).toBeNull();
    }
  });
});

describe('Équipe › Factures : le seau en mémoire du développement (ADR 0037 § 8)', () => {
  it('keeps each key once, as given, and gives a copy of its bytes', async () => {
    const store = createMemoryInvoiceStore();
    expect(await store.read(KEY)).toBeNull();
    expect(await store.writeOnce(KEY, BYTES, SHA, LOCK)).toBe('written');
    expect(
      await store.writeOnce(
        KEY,
        new TextEncoder().encode('other'),
        createHash('sha256').update('other').digest('hex'),
        LOCK,
      ),
    ).toBe('exists');
    const read = await store.read(KEY);
    expect(read).toEqual({ bytes: BYTES, retainUntil: LOCK });
    read?.bytes.fill(0);
    expect(store.peek(KEY)?.bytes).toEqual(BYTES);
    await expect(store.writeOnce('other', BYTES, '0'.repeat(64), LOCK)).rejects.toThrow(
      /not that of its bytes/u,
    );
  });
});
