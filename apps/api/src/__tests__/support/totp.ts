import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Bytes(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The secret an authenticator app would read from an `otpauth://` address. */
export function secretOf(totpUri: string): string {
  const secret = new URL(totpUri).searchParams.get('secret');
  if (secret === null) throw new Error('otpauth address without a secret');
  return secret;
}

/** The 6-digit code an authenticator app shows now (RFC 6238: SHA-1, 30 s), `offset` periods away. */
export function totpCode(secret: string, offset = 0, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000) + offset));
  const hmac = createHmac('sha1', base32Bytes(secret)).update(counter).digest();
  const start = (hmac.at(-1) ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(start) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}
