import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import type { PasskeyCredential } from '@impera/contracts';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { z } from 'zod';

/**
 * A phone's passkey, in memory: a P-256 key pair, the authenticator data and the signature a real authenticator makes
 * (WebAuthn § 6.1), attestation `none`. Invented keys only; nothing here reaches a device.
 */

const ORIGIN = 'http://localhost:5173';
const RP_ID = 'localhost';

/** Flags of the authenticator data: user present, user verified, attested credential data. */
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const ATTESTED = 0x40;

const OptionsSchema = z.object({ challenge: z.string().min(1) });

const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();
const counterBytes = (counter: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
};
const clientData = (type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) =>
  Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

interface Gesture {
  /** Face ID, a fingerprint or the phone's code: false makes a gesture with the user present only. */
  readonly verified?: boolean;
  /** The page's origin as the browser writes it. */
  readonly origin?: string;
}

export class FakePasskey {
  readonly credentialId = isoBase64URL.fromBuffer(new Uint8Array(randomBytes(32)));
  private readonly privateKey: KeyObject;
  private readonly cose: Uint8Array;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = z.object({ x: z.string(), y: z.string() }).parse(publicKey.export({ format: 'jwk' }));
    this.cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x)],
        [-3, isoBase64URL.toBuffer(jwk.y)],
      ]),
    );
  }

  private flags(gesture: Gesture): number {
    return USER_PRESENT | (gesture.verified === false ? 0 : USER_VERIFIED);
  }

  /** The browser's answer to registration options (`navigator.credentials.create`). */
  register(options: unknown, gesture: Gesture = {}): PasskeyCredential {
    const { challenge } = OptionsSchema.parse(options);
    const id = isoBase64URL.toBuffer(this.credentialId);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(id.length);
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([this.flags(gesture) | ATTESTED]),
      counterBytes(this.counter),
      Buffer.alloc(16),
      idLength,
      id,
      this.cose,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, string> | Uint8Array>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, string>()],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(
          new Uint8Array(clientData('webauthn.create', challenge, gesture.origin ?? ORIGIN)),
        ),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** The browser's answer to authentication options (`navigator.credentials.get`); the counter moves on each time. */
  assert(options: unknown, gesture: Gesture & { readonly forge?: boolean } = {}): PasskeyCredential {
    const { challenge } = OptionsSchema.parse(options);
    this.counter += 1;
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([this.flags(gesture)]),
      counterBytes(this.counter),
    ]);
    const data = clientData('webauthn.get', challenge, gesture.origin ?? ORIGIN);
    const signed = Buffer.concat([authData, sha256(data)]);
    const signature = sign(
      'sha256',
      gesture.forge === true ? Buffer.from('another message') : signed,
      this.privateKey,
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(data)),
        authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
