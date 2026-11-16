import { z } from 'zod';

import type { SessionShape } from '../../domain/ports';

/**
 * The Reveal session the extension's « Sync » sends (reveal-connector-spec.md § 2): the bot member's bearer token, read
 * from the dashboard's own calls to api.reveal.me, with who it is and for which creator. Opaque to the core; only this
 * adapter reads it. Never logged.
 */
const RevealSessionSchema = z.strictObject({
  v: z.literal(1),
  bearer: z.string().min(16).max(8_192),
  /** The team member the token belongs to (the « bot » member). */
  userId: z.string().min(1).max(64),
  /** The creator the account speaks for: one platform account = one Reveal model. */
  modelId: z.string().min(1).max(64),
  /** The capturing browser's, replayed as is (connectors.md, règles de bonne conduite). */
  userAgent: z.string().min(1).max(512),
  capturedAt: z.iso.datetime(),
});

export type RevealSession = z.infer<typeof RevealSessionSchema>;

/** The session, or `null` for anything that is not a Reveal session of this shape. Never logs what it read. */
export function parseRevealSession(raw: string): RevealSession | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = RevealSessionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** `exp` of a JWT bearer, when the token is one (spec § 2, V2); `null` otherwise. Reads the expiry only, never logs. */
export function revealTokenExpiry(bearer: string): Date | null {
  const payload = bearer.split('.')[1];
  if (payload === undefined) return null;
  try {
    const parsed = z
      .object({ exp: z.number().int().positive() })
      .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success ? new Date(parsed.data.exp * 1_000) : null;
  } catch {
    return null;
  }
}

/** `null` for anything that is not a Reveal session of this shape: the route refuses it before storing. */
export const revealSessionShape: SessionShape = (raw) => {
  const session = parseRevealSession(raw);
  return session === null
    ? null
    : { owner: session.modelId, member: session.userId, expiresAt: revealTokenExpiry(session.bearer) };
};
