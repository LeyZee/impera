import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  encryptPayload,
  generateVapidKeys,
  MAX_PAYLOAD_BYTES,
  outcomeOf,
  pushRequest,
  vapidAuthorization,
} from '../web-push';

const b64 = (value: string): Buffer => Buffer.from(value, 'base64url');

/** RFC 8291, Appendix A: the example message, keys and salt, and the body it must give (public test values). */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaShared: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** The device's side of RFC 8291, written apart from the sender's: what a browser does on receipt. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();
  const expand = (salt: Buffer, ikm: Buffer, info: string | Buffer, length: number): Buffer =>
    hmac(hmac(salt, ikm), Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length);
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + keyLength);
  const record = body.subarray(21 + keyLength);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const secret = ua.computeSecret(asPublic);
  const ikm = expand(
    auth,
    secret,
    Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]),
    32,
  );
  const decipher = createDecipheriv(
    'aes-128-gcm',
    expand(salt, ikm, 'Content-Encoding: aes128gcm\0', 16),
    expand(salt, ikm, 'Content-Encoding: nonce\0', 12),
  );
  decipher.setAuthTag(record.subarray(-16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString();
}

describe('Web Push encryption (RFC 8291)', () => {
  it('gives the body of the RFC’s example, byte for byte', () => {
    const body = encryptPayload(
      { p256dh: b64(RFC.uaPublic), auth: b64(RFC.uaShared) },
      Buffer.from(RFC.plaintext),
      { ephemeralPrivateKey: b64(RFC.asPrivate), salt: b64(RFC.salt) },
    );
    expect(body.toString('base64url')).toBe(RFC.body);
  });

  it('is read back by the device, with fresh keys and salt each time', () => {
    const device = createECDH('prime256v1');
    device.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const target = { p256dh: device.getPublicKey(), auth };
    const one = encryptPayload(target, Buffer.from('{"title":"Nouvelle vente"}'));
    const two = encryptPayload(target, Buffer.from('{"title":"Nouvelle vente"}'));
    expect(one.equals(two)).toBe(false);
    expect(decrypt(one, device.getPrivateKey(), auth)).toBe('{"title":"Nouvelle vente"}');
  });

  it('refuses a payload that does not fit in one record', () => {
    const target = { p256dh: b64(RFC.uaPublic), auth: b64(RFC.uaShared) };
    expect(() => encryptPayload(target, Buffer.alloc(MAX_PAYLOAD_BYTES + 1))).toThrow(
      'push_payload_too_large',
    );
    expect(() => encryptPayload(target, Buffer.alloc(MAX_PAYLOAD_BYTES))).not.toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a 12-hour token for the push service’s origin, checked with the public key it names', () => {
    const keys = generateVapidKeys();
    const now = new Date('2026-11-02T20:00:00Z');
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      'mailto:ops@example.test',
      now,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/u.exec(header);
    expect(match).not.toBeNull();
    const [, head = '', claims = '', signature = '', k = ''] = match ?? [];
    expect(JSON.parse(b64(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64(claims).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: 'mailto:ops@example.test',
    });
    expect(b64(k).equals(keys.publicKey)).toBe(true);
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: keys.publicKey.subarray(1, 33).toString('base64url'),
        y: keys.publicKey.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    const valid = verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      b64(signature),
    );
    expect(valid).toBe(true);
  });

  it('builds the request a push service expects', () => {
    const device = createECDH('prime256v1');
    device.generateKeys();
    const request = pushRequest({
      target: {
        endpoint: 'https://web.push.apple.com/QGuQyavXutnMH',
        p256dh: device.getPublicKey(),
        auth: Buffer.alloc(16, 1),
      },
      payload: Buffer.from('{}'),
      keys: generateVapidKeys(),
      subject: 'mailto:ops@example.test',
      now: new Date('2026-11-02T20:00:00Z'),
      ttlSeconds: 3600,
      urgency: 'high',
    });
    expect(request.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    });
    expect(request.headers['Authorization']).toMatch(/^vapid t=.+, k=.+$/u);
  });

  it('reads the push service’s answer: dead subscription, retry, or our fault', () => {
    expect(outcomeOf(201)).toEqual({ kind: 'sent' });
    expect(outcomeOf(410)).toEqual({ kind: 'gone' });
    expect(outcomeOf(404)).toEqual({ kind: 'gone' });
    expect(outcomeOf(429)).toEqual({ kind: 'retry', status: 429 });
    expect(outcomeOf(503)).toEqual({ kind: 'retry', status: 503 });
    expect(outcomeOf(413)).toEqual({ kind: 'refused', status: 413 });
  });
});
