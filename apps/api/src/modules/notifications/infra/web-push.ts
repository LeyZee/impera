/**
 * Web Push without a library (CR-01): the message encryption of RFC 8291 (aes128gcm, RFC 8188) and the server's
 * signature of RFC 8292 (VAPID, ES256), on node:crypto alone. No dependency, so no 14-day quarantine, and the whole
 * protocol fits in this file; its test replays the example of RFC 8291 Appendix A byte for byte.
 */
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

/** Every key is P-256: public keys uncompressed (65 bytes), private keys raw (32 bytes). */
export interface VapidKeys {
  readonly publicKey: Buffer;
  readonly privateKey: Buffer;
}

/** What the browser's PushSubscription gives: where to send, and its two keys. */
export interface PushTarget {
  readonly endpoint: string;
  /** `keys.p256dh`: the device's public key. */
  readonly p256dh: Buffer;
  /** `keys.auth`: a 16-byte secret shared with the device. */
  readonly auth: Buffer;
}

const RECORD_SIZE = 4096;
/** The payload must leave room for the header, the padding delimiter and the tag in one record. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 86 - 1 - 16;

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HKDF with a single block of output (RFC 5869), all RFC 8291 needs: at most 32 bytes. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

/**
 * The encrypted body of one push message (RFC 8291 § 3.4): header (salt, record size, the sender's ephemeral public
 * key) then the single record. `ephemeral` and `salt` are drawn fresh for every message; a test passes the RFC's.
 */
export function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  plaintext: Buffer,
  options: { readonly ephemeralPrivateKey?: Buffer; readonly salt?: Buffer } = {},
): Buffer {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('push_payload_too_large');
  const ecdh = createECDH('prime256v1');
  if (options.ephemeralPrivateKey === undefined) ecdh.generateKeys();
  else ecdh.setPrivateKey(options.ephemeralPrivateKey);
  const asPublic = ecdh.getPublicKey();
  const salt = options.salt ?? randomBytes(16);
  const ecdhSecret = ecdh.computeSecret(target.p256dh);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), target.p256dh, asPublic]);
  const ikm = hkdf(target.auth, ecdhSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: the delimiter of the last (and only) record, no further padding.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final()]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record, cipher.getAuthTag()]);
}

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const x = keys.publicKey.subarray(1, 33).toString('base64url');
  const y = keys.publicKey.subarray(33, 65).toString('base64url');
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d: keys.privateKey.toString('base64url') },
    format: 'jwk',
  });
}

/** VAPID tokens live 12 hours: the push service refuses more than 24. */
const TOKEN_LIFETIME_S = 12 * 60 * 60;

/**
 * The `Authorization` header of RFC 8292: a JWT signed with the server's key, for the push service of `endpoint`.
 * `subject` is how the push service reaches the sender (a `mailto:` or an https address).
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: Date): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + TOKEN_LIFETIME_S,
    sub: subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKey(keys),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${keys.publicKey.toString('base64url')}`;
}

export type PushOutcome =
  /** Accepted by the push service. */
  | { readonly kind: 'sent' }
  /** The subscription is dead (404, 410): remove it. */
  | { readonly kind: 'gone' }
  /** Worth another try later (429, 5xx, network). */
  | { readonly kind: 'retry'; readonly status: number | null }
  /** Refused for good (400, 403, 413…): a fault of ours, logged, never retried. */
  | { readonly kind: 'refused'; readonly status: number };

export function outcomeOf(status: number): PushOutcome {
  if (status >= 200 && status < 300) return { kind: 'sent' };
  if (status === 404 || status === 410) return { kind: 'gone' };
  if (status === 429 || status >= 500) return { kind: 'retry', status };
  return { kind: 'refused', status };
}

export interface PushRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** The HTTP request that delivers `payload` to one device; sending it is the caller's (fetch, with a timeout). */
export function pushRequest(input: {
  readonly target: PushTarget;
  readonly payload: Buffer;
  readonly keys: VapidKeys;
  readonly subject: string;
  readonly now: Date;
  /** Seconds the push service keeps it for an offline device. */
  readonly ttlSeconds: number;
  readonly urgency: 'very-low' | 'low' | 'normal' | 'high';
}): PushRequest {
  return {
    url: input.target.endpoint,
    headers: {
      Authorization: vapidAuthorization(input.target.endpoint, input.keys, input.subject, input.now),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(input.ttlSeconds),
      Urgency: input.urgency,
    },
    body: encryptPayload(input.target, input.payload),
  };
}
