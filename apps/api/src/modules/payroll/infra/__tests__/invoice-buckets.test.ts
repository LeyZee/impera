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

  it('lengthens a lock with the object’s retention, signed, and fails with the code when the bucket refuses', async () => {
    const bucket = provider(() => new Response(null, { status: 200 }));
    const store = createS3InvoiceStore(CONFIG, bucket.fetch);
    expect(store.volatile).toBe(false);
    await store.lengthenLock(KEY, LOCK);
    const [request] = bucket.requests;
    if (request === undefined) throw new Error('no request');
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(
      'https://objects.example.test/factures-exemple/invoices/2026/0190f1a2-0000-7000-8000-000000000001.pdf?retention',
    );
    const body = new Uint8Array(await request.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe(
      '<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>2037-01-01T00:00:00.000Z</RetainUntilDate></Retention>',
    );
    expect(request.headers.get('content-md5')).toBe(createHash('md5').update(body).digest('base64'));
    expect(request.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(body).digest('hex'));
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=EXAMPLEKEYID\//u);
    const refused = () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    await expect(
      createS3InvoiceStore(CONFIG, provider(refused).fetch).lengthenLock(KEY, LOCK),
    ).rejects.toThrow(/PUT .*\?retention answered 403 \(AccessDenied\)$/u);
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

describe('Équipe › Pièces : l’effacement d’une pièce refusée dans le seau S3 (EQ-06 lot 5c-2, « ok purge a »)', () => {
  const PAST = '2026-01-01T00:00:00Z';
  /** A listing of the key's versions and markers, as ListObjectVersions writes it. */
  const listing = (
    entries: readonly { kind: 'Version' | 'DeleteMarker'; key?: string; id: string }[],
  ): string =>
    `<ListVersionsResult><IsTruncated>false</IsTruncated>${entries
      .map(
        (one) =>
          `<${one.kind}><Key>${one.key ?? KEY}</Key><VersionId>${one.id}</VersionId><IsLatest>false</IsLatest></${one.kind}>`,
      )
      .join('')}</ListVersionsResult>`;
  /** A bucket that lists `entries`, gives each version `bytes` under `lock`, and answers each delete with `deleted`. */
  const bucket = (
    entries: Parameters<typeof listing>[0],
    lock: string | null,
    options: { bytes?: Uint8Array; deleted?: () => Response } = {},
  ) => {
    const requests: Request[] = [];
    const answer = (request: Request): Response => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.searchParams.has('versions')) {
        return new Response(listing(entries), { status: 200 });
      }
      if (request.method === 'GET') {
        const headers: Record<string, string> =
          lock === null
            ? {}
            : { 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': lock };
        return new Response(options.bytes ?? BYTES, { status: 200, headers });
      }
      if (request.method === 'DELETE') return options.deleted?.() ?? new Response(null, { status: 204 });
      return new Response(null, { status: 500 });
    };
    return {
      requests,
      fetch: (request: Request): Promise<Response> => {
        requests.push(request);
        return Promise.resolve(answer(request));
      },
    };
  };
  const deletes = (requests: readonly Request[]) =>
    requests
      .filter((request) => request.method === 'DELETE')
      .map((request) => new URL(request.url).searchParams.get('versionId'));

  it('erases every version of the exact key by its id, then the markers, once its lock has ended', async () => {
    const provided = bucket(
      [
        { kind: 'Version', id: 'v1' },
        { kind: 'DeleteMarker', id: 'm1' },
        // Another key the prefix also lists: never touched.
        { kind: 'Version', key: `${KEY}.old`, id: 'other' },
      ],
      PAST,
    );
    expect(await createS3InvoiceStore(CONFIG, provided.fetch).remove(KEY, SHA)).toBe('removed');
    const [list] = provided.requests;
    expect(list?.url).toBe(
      'https://objects.example.test/factures-exemple?versions&prefix=invoices%2F2026%2F0190f1a2-0000-7000-8000-000000000001.pdf',
    );
    expect(list?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=EXAMPLEKEYID\//u);
    expect(deletes(provided.requests)).toEqual(['v1', 'm1']);
  });

  it('erases nothing while a lock holds, when a version is another file, or for a date it cannot read', async () => {
    const locked = bucket([{ kind: 'Version', id: 'v1' }], '2037-01-01T00:00:00Z');
    expect(await createS3InvoiceStore(CONFIG, locked.fetch).remove(KEY, SHA)).toBe('locked');
    expect(deletes(locked.requests)).toEqual([]);
    const unreadable = bucket([{ kind: 'Version', id: 'v1' }], 'soon');
    expect(await createS3InvoiceStore(CONFIG, unreadable.fetch).remove(KEY, SHA)).toBe('locked');
    expect(deletes(unreadable.requests)).toEqual([]);
    const other = bucket([{ kind: 'Version', id: 'v1' }], PAST, { bytes: new TextEncoder().encode('autre') });
    expect(await createS3InvoiceStore(CONFIG, other.fetch).remove(KEY, SHA)).toBe('altered');
    expect(deletes(other.requests)).toEqual([]);
  });

  it('says « absent » for no version, clears a marker left alone, and takes a refused delete for « not yet »', async () => {
    const empty = bucket([], null);
    expect(await createS3InvoiceStore(CONFIG, empty.fetch).remove(KEY, SHA)).toBe('absent');
    expect(deletes(empty.requests)).toEqual([]);
    // A run stopped between the version and its marker: the marker goes, the file was gone already.
    const marker = bucket([{ kind: 'DeleteMarker', id: 'm1' }], null);
    expect(await createS3InvoiceStore(CONFIG, marker.fetch).remove(KEY, SHA)).toBe('absent');
    expect(deletes(marker.requests)).toEqual(['m1']);
    const refused = bucket([{ kind: 'Version', id: 'v1' }], PAST, {
      deleted: () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    });
    expect(await createS3InvoiceStore(CONFIG, refused.fetch).remove(KEY, SHA)).toBe('locked');
    const worm = bucket([{ kind: 'Version', id: 'v1' }], PAST, {
      deleted: () =>
        new Response(
          '<Error><Code>InvalidRequest</Code><Message>Object is WORM protected</Message></Error>',
          {
            status: 400,
          },
        ),
    });
    expect(await createS3InvoiceStore(CONFIG, worm.fetch).remove(KEY, SHA)).toBe('locked');
  });

  it('tells whether a version lies under the key, even behind a marker, and fails on a listing cut in two', async () => {
    const hidden = bucket(
      [
        { kind: 'DeleteMarker', id: 'm1' },
        { kind: 'Version', id: 'v1' },
      ],
      PAST,
    );
    expect(await createS3InvoiceStore(CONFIG, hidden.fetch).holdsVersion(KEY)).toBe(true);
    expect(deletes(hidden.requests)).toEqual([]);
    expect(
      await createS3InvoiceStore(
        CONFIG,
        bucket([{ kind: 'DeleteMarker', id: 'm1' }], null).fetch,
      ).holdsVersion(KEY),
    ).toBe(false);
    const truncated = provider(
      () =>
        new Response('<ListVersionsResult><IsTruncated>true</IsTruncated></ListVersionsResult>', {
          status: 200,
        }),
    );
    await expect(createS3InvoiceStore(CONFIG, truncated.fetch).holdsVersion(KEY)).rejects.toBeInstanceOf(
      InvoiceStorageUnavailable,
    );
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

  it('only lengthens a lock, as a compliance lock, and says whether it forgets with the process', async () => {
    const store = createMemoryInvoiceStore();
    expect(store.volatile).toBe(false);
    expect(createMemoryInvoiceStore({ volatile: true }).volatile).toBe(true);
    await expect(store.lengthenLock(KEY, LOCK)).rejects.toBeInstanceOf(InvoiceStorageUnavailable);
    await store.writeOnce(KEY, BYTES, SHA, LOCK);
    const later = new Date('2038-01-01T00:00:00.000Z');
    await store.lengthenLock(KEY, later);
    expect(store.peek(KEY)?.retainUntil).toEqual(later);
    await expect(store.lengthenLock(KEY, LOCK)).rejects.toThrow(/only lengthens/u);
    expect(store.peek(KEY)?.retainUntil).toEqual(later);
    store.plant('unlocked', { bytes: BYTES, retainUntil: null });
    await expect(store.lengthenLock('unlocked', later)).rejects.toThrow(/only lengthens/u);
  });

  it('erases an unlocked object of the right file only, and tells whether it holds one', async () => {
    const store = createMemoryInvoiceStore();
    expect(await store.remove(KEY, SHA)).toBe('absent');
    expect(await store.holdsVersion(KEY)).toBe(false);
    await store.writeOnce(KEY, BYTES, SHA, LOCK);
    expect(await store.remove(KEY, SHA)).toBe('locked');
    store.plant(KEY, { bytes: BYTES, retainUntil: new Date('2026-01-01T00:00:00.000Z') });
    expect(await store.remove(KEY, '0'.repeat(64))).toBe('altered');
    expect(await store.holdsVersion(KEY)).toBe(true);
    expect(await store.remove(KEY, SHA)).toBe('removed');
    expect(store.peek(KEY)).toBeUndefined();
  });
});
