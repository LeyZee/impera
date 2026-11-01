import { createHash } from 'node:crypto';

import { AwsClient } from 'aws4fetch';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createS3InvoiceStore } from '../infra/invoice-buckets';

/**
 * The S3 store against a real object store with Object Lock (ADR 0037 § 8): MinIO in a container, or the server named
 * by `NIRVANA_TEST_S3_URL` where Docker is not available (its root user in `NIRVANA_TEST_S3_USER` and
 * `NIRVANA_TEST_S3_PASSWORD`). Each run makes its own bucket, under compliance locks of one day: nothing to clean, the
 * container going away with its data.
 */
/**
 * MinIO no longer publishes images (October 2025): this is the last community release, as Coolify (ADR 0027) builds
 * and publishes it.
 */
const IMAGE = 'coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
const USER = process.env['NIRVANA_TEST_S3_USER'] ?? 'nirvana-test';
const PASSWORD = process.env['NIRVANA_TEST_S3_PASSWORD'] ?? 'nirvana-test-password';
const REGION = 'us-east-1';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** A lock of one day, to the second: what the provider gives back. */
const inOneDay = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000 + 86_400_000);

describe('Équipe › Factures : le seau verrouillé, contre un vrai stockage objet (ADR 0037 § 4 à § 6)', () => {
  let container: StartedTestContainer | undefined;
  let endpoint = process.env['NIRVANA_TEST_S3_URL'] ?? '';
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
});
