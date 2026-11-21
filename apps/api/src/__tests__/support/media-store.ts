import { AwsClient } from 'aws4fetch';
import type { LightMyRequestResponse } from 'fastify';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { Server } from '../../server';

import { DASHBOARD_ORIGIN } from './sign-in';

/**
 * A real object store for her media (CR-06 b, ADR 0055 § 3): MinIO in a container, or the server named by
 * `IMPERA_TEST_S3_URL` where Docker is not available (its user in `IMPERA_TEST_S3_USER` and `IMPERA_TEST_S3_PASSWORD`).
 */
const IMAGE = 'coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
const USER = process.env['IMPERA_TEST_S3_USER'] ?? 'impera-test';
const PASSWORD = process.env['IMPERA_TEST_S3_PASSWORD'] ?? 'impera-test-password';
const REGION = 'us-east-1';

export interface MediaStore {
  readonly endpoint: string;
  readonly bucket: string;
  /** Signs a request to the store as its owner, to read what the jobs wrote. */
  readonly s3: AwsClient;
  /** The configuration keys that point the API at this store. */
  readonly config: {
    readonly S3_ENDPOINT: string;
    readonly S3_REGION: string;
    readonly S3_BUCKET: string;
    readonly S3_ACCESS_KEY_ID: string;
    readonly S3_SECRET_ACCESS_KEY: string;
  };
  stop(): Promise<void>;
}

/** Starts the store (or takes the one named) and makes a bucket of its own for this file. */
export async function startMediaStore(): Promise<MediaStore> {
  let container: StartedTestContainer | undefined;
  let endpoint = process.env['IMPERA_TEST_S3_URL'] ?? '';
  if (endpoint === '') {
    container = await new GenericContainer(IMAGE)
      .withEnvironment({ MINIO_ROOT_USER: USER, MINIO_ROOT_PASSWORD: PASSWORD })
      .withCommand(['server', '/data'])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();
    endpoint = `http://${container.getHost()}:${String(container.getMappedPort(9000))}`;
  }
  const bucket = `medias-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  const s3 = new AwsClient({ accessKeyId: USER, secretAccessKey: PASSWORD, service: 's3', region: REGION });
  const created = await s3.fetch(`${endpoint}/${bucket}`, { method: 'PUT' });
  if (created.status !== 200) throw new Error(`bucket not made: ${await created.text()}`);
  return {
    endpoint,
    bucket,
    s3,
    config: {
      S3_ENDPOINT: endpoint,
      S3_REGION: REGION,
      S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: USER,
      S3_SECRET_ACCESS_KEY: PASSWORD,
    },
    stop: async () => {
      await container?.stop();
    },
  };
}

/** The invented phone a photo's EXIF names, and its position as text: the cleaning must remove both. */
export const PHOTO_DEVICE = 'Telephone Invente 9';
export const PHOTO_PLACE = '48.8566N 2.3522E';

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];

/**
 * A JPEG of exactly `bytes` bytes, `width` × `height`, with the EXIF a phone writes (an invented device and a position
 * as text): the cleaning follows its markers, never decodes it. `seed` makes two photos of one size differ.
 */
export function jpegOf(bytes: number, width = 30, height = 40, seed = 0x11): Uint8Array {
  const text = (value: string): number[] => [...Buffer.from(value, 'latin1')];
  const segment = (marker: number, payload: number[]): number[] => [
    0xff,
    marker,
    ...be16(payload.length + 2),
    ...payload,
  ];
  const exif = segment(0xe1, [
    ...text('Exif\0\0MM'),
    0,
    0x2a,
    0,
    0,
    0,
    8,
    0,
    0,
    0,
    0,
    0,
    0,
    ...text(`${PHOTO_DEVICE} ${PHOTO_PLACE}`),
  ]);
  const head = [
    0xff,
    0xd8,
    ...exif,
    ...segment(0xc0, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
  ];
  const out = new Uint8Array(bytes).fill(seed);
  out.set(head);
  out.set([0xff, 0xd9], bytes - 2);
  return out;
}

/**
 * Her file sent whole in one part and « complete » called, as her phone does for a small photo: the API signs the part's
 * address (`base` is the file's route, `…/drops/:id/files/:fileId`), the bytes go there bare, then « complete ».
 * Returns the answer of « complete ».
 */
export async function sendWhole(
  server: Server,
  cookie: string,
  base: string,
  bytes: Uint8Array,
): Promise<LightMyRequestResponse> {
  const headers = { cookie, origin: DASHBOARD_ORIGIN };
  const plan = await server.inject({ method: 'POST', url: `${base}/upload`, headers });
  if (plan.statusCode !== 200) throw new Error(`upload refused: ${plan.body}`);
  const { missing } = plan.json<{ missing: { url: string }[] }>();
  const sent = await fetch(missing[0]?.url ?? '', { method: 'PUT', body: bytes });
  return server.inject({
    method: 'POST',
    url: `${base}/complete`,
    headers,
    payload: { parts: [{ number: 1, etag: sent.headers.get('etag') ?? '' }] },
  });
}
