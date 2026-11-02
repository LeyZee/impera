import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DeliveryRead, DeliveryRequest } from '../../domain/sales-feed';

import { RevealDeliverySchema } from './wire';

/** Reveal's documentation: a delivery signed more than 5 minutes away from now is refused. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** `t=<seconds>,v1=<hex>[,v1=<hex>…]` → its time and its signatures; `null` when the header cannot be one. */
function signatureHeader(header: string | undefined): { at: number; signatures: string[] } | null {
  if (header === undefined || header.length > 1024) return null;
  let at: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [name, value] = part.trim().split('=', 2);
    if (value === undefined) continue;
    if (name === 't' && /^\d{1,12}$/.test(value)) at = Number(value);
    if (name === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return at === null || signatures.length === 0 ? null : { at, signatures };
}

/**
 * Checks a delivery of Reveal's webhooks (ADR 0050 § 3): `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`, over the raw
 * bytes as they came (never a re-serialised JSON), compared in constant time, `t` within 5 minutes of now either way.
 * Only then is the body parsed, for its delivery id and its position in the register.
 */
export function readRevealDelivery(request: DeliveryRequest): DeliveryRead {
  const header = signatureHeader(request.headers['x-reveal-signature']);
  if (header === null) return { ok: false, reason: 'unsigned' };
  if (Math.abs(request.now.getTime() / 1000 - header.at) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const expected = createHmac('sha256', request.secret)
    .update(`${String(header.at)}.`)
    .update(request.rawBody)
    .digest();
  const signed = header.signatures.some((signature) => {
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!signed) return { ok: false, reason: 'bad_signature' };
  let json: unknown;
  try {
    json = JSON.parse(request.rawBody.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = RevealDeliverySchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    deliveryId: parsed.data.id,
    event: parsed.data.event.slice(0, 64),
    position: parsed.data.data.cursor,
  };
}
