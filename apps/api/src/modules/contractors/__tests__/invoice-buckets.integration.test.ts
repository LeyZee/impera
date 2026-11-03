import { createHash } from 'node:crypto';
import { connect, createServer, type Socket } from 'node:net';

import { AwsClient } from 'aws4fetch';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createS3InvoiceStore } from '../infra/invoice-buckets';

/**
 * The S3 store against a real object store with Object Lock (ADR 0037 § 8): MinIO in a container, or the server named
 * by `IMPERA_TEST_S3_URL` where Docker is not available (its root user in `IMPERA_TEST_S3_USER` and
 * `IMPERA_TEST_S3_PASSWORD`). Each run makes its own bucket, under compliance locks of one day: nothing to clean, the
 * container going away with its data.
 */
/**
 * MinIO no longer publishes images (October 2025): this is the last community release, as Coolify (ADR 0027) builds
 * and publishes it.
 */
const IMAGE = 'coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
const USER = process.env['IMPERA_TEST_S3_USER'] ?? 'impera-test';
const PASSWORD = process.env['IMPERA_TEST_S3_PASSWORD'] ?? 'impera-test-password';
const REGION = 'us-east-1';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** A lock of one day, to the second: what the provider gives back. */
const inOneDay = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000 + 86_400_000);
/** A lock that ends in two seconds, to the second, and the wait until it has ended. */
const inTwoSeconds = (): Date => new Date(Math.ceil(Date.now() / 1000) * 1000 + 2_000);
const until = (moment: Date): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, moment.getTime() - Date.now()) + 1_000));

describe('Équipe › Factures : le seau verrouillé, contre un vrai stockage objet (ADR 0037 § 4 à § 8)', () => {
  let container: StartedTestContainer | undefined;
  let endpoint = process.env['IMPERA_TEST_S3_URL'] ?? '';
  const bucket = `factures-${String(Date.now())}`;
  const admin = new AwsClient({
    accessKeyId: USER,
    secretAccessKey: PASSWORD,
    service: 's3',
    region: REGION,
  });
  const store = () =>
    createS3InvoiceStore({ endpoint, region: REGION, bucket, accessKeyId: USER, secretAccessKey: PASSWORD });

  beforeAll(async () => {
    if (endpoint === '') {
      container = await new GenericContainer(IMAGE)
        .withEnvironment({ MINIO_ROOT_USER: USER, MINIO_ROOT_PASSWORD: PASSWORD })
        .withCommand(['server', '/data'])
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start();
      endpoint = `http://${container.getHost()}:${String(container.getMappedPort(9000))}`;
    }
    // A bucket with Object Lock, as the runbook asks of both providers.
    const created = await admin.fetch(`${endpoint}/${bucket}`, {
      method: 'PUT',
      headers: { 'x-amz-bucket-object-lock-enabled': 'true' },
    });
    expect(created.status, await created.text()).toBe(200);
  });

  afterAll(async () => {
    await container?.stop();
  });

  it('writes a PDF under its compliance lock and reads it back with that lock', async () => {
    const bytes = bytesOf('%PDF-1.7 première facture');
    const lock = inOneDay();
    expect(await store().writeOnce('invoices/2026/a.pdf', bytes, sha(bytes), lock)).toBe('written');
    expect(await store().read('invoices/2026/a.pdf')).toEqual({ bytes, retainUntil: lock });
  });

  it('never writes a key twice: the second write says « exists » and the first PDF stays', async () => {
    const first = bytesOf('%PDF-1.7 le vrai');
    const other = bytesOf('%PDF-1.7 un autre');
    expect(await store().writeOnce('invoices/2026/b.pdf', first, sha(first), inOneDay())).toBe('written');
    expect(await store().writeOnce('invoices/2026/b.pdf', other, sha(other), inOneDay())).toBe('exists');
    expect((await store().read('invoices/2026/b.pdf'))?.bytes).toEqual(first);
  });

  it('reads after a 412 even when the bucket’s close of the connection reaches it late (CI, 03/11)', async (context) => {
    // MinIO closes the connection right after a 412, without `Connection: close`. Behind docker-proxy, that close can
    // arrive after the next request has left on the same connection: a proxy that passes it on 50 ms late does so
    // every time.
    const target = new URL(endpoint);
    if (target.protocol !== 'http:') context.skip();
    const open = new Set<Socket>();
    const proxy = createServer((client) => {
      open.add(client);
      const upstream = connect(Number(target.port), target.hostname);
      client.pipe(upstream);
      upstream.on('data', (chunk: Buffer) => client.write(chunk));
      upstream.on('end', () => setTimeout(() => client.end(), 50));
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
      const address = proxy.address();
      if (address === null || typeof address === 'string') throw new Error('the proxy has no port');
      const { port } = address;
      const late = createS3InvoiceStore({
        endpoint: `http://127.0.0.1:${String(port)}`,
        region: REGION,
        bucket,
        accessKeyId: USER,
        secretAccessKey: PASSWORD,
      });
      const bytes = bytesOf('%PDF-1.7 tard');
      expect(await late.writeOnce('invoices/2026/late.pdf', bytes, sha(bytes), inOneDay())).toBe('written');
      expect(await late.writeOnce('invoices/2026/late.pdf', bytes, sha(bytes), inOneDay())).toBe('exists');
      expect((await late.read('invoices/2026/late.pdf'))?.bytes).toEqual(bytes);
    } finally {
      for (const socket of open) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
    }
  });

  it('reads nothing for a key that holds nothing', async () => {
    expect(await store().read('invoices/2026/absent.pdf')).toBeNull();
  });

  it('refuses to delete a locked PDF, even to its root user', async () => {
    const bytes = bytesOf('%PDF-1.7 ineffaçable');
    await store().writeOnce('invoices/2026/c.pdf', bytes, sha(bytes), inOneDay());
    const head = await admin.fetch(`${endpoint}/${bucket}/invoices/2026/c.pdf`, { method: 'HEAD' });
    const version = head.headers.get('x-amz-version-id');
    expect(version).not.toBeNull();
    const removed = await admin.fetch(
      `${endpoint}/${bucket}/invoices/2026/c.pdf?versionId=${encodeURIComponent(version ?? '')}`,
      { method: 'DELETE', headers: { 'x-amz-bypass-governance-retention': 'true' } },
    );
    // AWS answers 403 AccessDenied, MinIO 400 « Object is WORM protected »: refused either way.
    expect(removed.ok).toBe(false);
    expect(await removed.text()).toMatch(/AccessDenied|WORM protected/u);
    expect((await store().read('invoices/2026/c.pdf'))?.bytes).toEqual(bytes);
  });

  it('refuses to shorten a compliance lock, even to its root user, and only lengthens it', async () => {
    const bytes = bytesOf('%PDF-1.7 verrou tenu');
    const lock = inOneDay();
    await store().writeOnce('invoices/2026/e.pdf', bytes, sha(bytes), lock);
    const head = await admin.fetch(`${endpoint}/${bucket}/invoices/2026/e.pdf`, { method: 'HEAD' });
    const version = head.headers.get('x-amz-version-id') ?? '';
    const retain = (until: Date) => {
      const retention = `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>${until.toISOString()}</RetainUntilDate></Retention>`;
      return admin.fetch(
        `${endpoint}/${bucket}/invoices/2026/e.pdf?retention&versionId=${encodeURIComponent(version)}`,
        {
          method: 'PUT',
          body: retention,
          headers: {
            'content-md5': createHash('md5').update(retention).digest('base64'),
            'x-amz-bypass-governance-retention': 'true',
          },
        },
      );
    };
    const shortened = await retain(new Date(lock.getTime() - 3_600_000));
    // AWS answers 403 AccessDenied, MinIO 400 « Object is WORM protected »: refused either way.
    expect(shortened.ok).toBe(false);
    expect(await shortened.text()).toMatch(/AccessDenied|WORM protected/u);
    expect((await store().read('invoices/2026/e.pdf'))?.retainUntil).toEqual(lock);
    // The same request that lengthens it goes through: the refusal above is the lock's, not the request's.
    const later = new Date(lock.getTime() + 3_600_000);
    const lengthened = await retain(later);
    expect(lengthened.status, await lengthened.text()).toBe(200);
    expect(await store().read('invoices/2026/e.pdf')).toEqual({ bytes, retainUntil: later });
  });

  it('lengthens a lock through the store, and the bucket refuses to shorten it', async () => {
    const bytes = bytesOf('%PDF-1.7 verrou prolongé');
    const lock = inOneDay();
    await store().writeOnce('invoices/2026/f.pdf', bytes, sha(bytes), lock);
    const later = new Date(lock.getTime() + 7_200_000);
    await store().lengthenLock('invoices/2026/f.pdf', later);
    expect(await store().read('invoices/2026/f.pdf')).toEqual({ bytes, retainUntil: later });
    await expect(store().lengthenLock('invoices/2026/f.pdf', lock)).rejects.toThrow(
      /\?retention answered 4\d\d/u,
    );
    expect((await store().read('invoices/2026/f.pdf'))?.retainUntil).toEqual(later);
  });

  it('refuses bytes damaged on the way: the provider checks the sums it was sent', async () => {
    const bytes = bytesOf('%PDF-1.7 abîmé en route');
    const damaging = createS3InvoiceStore(
      { endpoint, region: REGION, bucket, accessKeyId: USER, secretAccessKey: PASSWORD },
      async (request) => {
        const body = new Uint8Array(await request.arrayBuffer());
        body[0] = 0x25 ^ 0xff;
        return fetch(new Request(request, { body, duplex: 'half' }));
      },
    );
    await expect(damaging.writeOnce('invoices/2026/d.pdf', bytes, sha(bytes), inOneDay())).rejects.toThrow(
      /answered 400/u,
    );
    expect(await store().read('invoices/2026/d.pdf')).toBeNull();
  });

  /** What the bucket lists under the exact key: its versions and its delete markers (EQ-06 lot 5c-2). */
  const listed = async (key: string): Promise<{ versions: number; markers: number }> => {
    const response = await admin.fetch(`${endpoint}/${bucket}?versions&prefix=${encodeURIComponent(key)}`);
    const body = await response.text();
    const count = (kind: string) =>
      body
        .split(`<${kind}>`)
        .slice(1)
        .filter((block) => (block.split(`</${kind}>`)[0] ?? '').includes(`<Key>${key}</Key>`)).length;
    return { versions: count('Version'), markers: count('DeleteMarker') };
  };

  it('erases nothing of a refused file while its compliance lock holds (« ok purge a »)', async () => {
    const bytes = bytesOf('%PDF-1.7 pièce refusée, encore verrouillée');
    const key = 'contractor-documents/m/locked.pdf';
    await store().writeOnce(key, bytes, sha(bytes), inOneDay());
    expect(await store().remove(key, sha(bytes))).toBe('locked');
    expect((await store().read(key))?.bytes).toEqual(bytes);
    expect(await listed(key)).toEqual({ versions: 1, markers: 0 });
  });

  it('erases the version itself once its lock has ended, nothing left behind a marker', async () => {
    const bytes = bytesOf('%PDF-1.7 pièce refusée, verrou échu');
    const key = 'contractor-documents/m/unlocked.pdf';
    const lock = inTwoSeconds();
    await store().writeOnce(key, bytes, sha(bytes), lock);
    await until(lock);
    // Another file under the key is never erased: the fingerprint is the bucket's, read before.
    expect(await store().remove(key, sha(bytesOf('autre')))).toBe('altered');
    expect(await store().remove(key, sha(bytes))).toBe('removed');
    expect(await store().read(key)).toBeNull();
    expect(await listed(key)).toEqual({ versions: 0, markers: 0 });
    expect(await store().holdsVersion(key)).toBe(false);
    expect(await store().remove(key, sha(bytes))).toBe('absent');
  }, 20_000);

  it('finds and erases a version a delete marker hides, which a HEAD would take for absent', async () => {
    const bytes = bytesOf('%PDF-1.7 pièce refusée, cachée par un marqueur');
    const key = 'contractor-documents/m/hidden.pdf';
    const lock = inTwoSeconds();
    await store().writeOnce(key, bytes, sha(bytes), lock);
    // A plain delete: allowed under the lock, it only adds a marker, the bytes stay.
    const hidden = await admin.fetch(`${endpoint}/${bucket}/${key}`, { method: 'DELETE' });
    expect(hidden.status, await hidden.text()).toBe(204);
    expect(await store().read(key)).toBeNull();
    expect(await store().holdsVersion(key)).toBe(true);
    expect(await store().remove(key, sha(bytes))).toBe('locked');
    await until(lock);
    expect(await store().remove(key, sha(bytes))).toBe('removed');
    expect(await listed(key)).toEqual({ versions: 0, markers: 0 });
    expect(await store().holdsVersion(key)).toBe(false);
  }, 20_000);
});
