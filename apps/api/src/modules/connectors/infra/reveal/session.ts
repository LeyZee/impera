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

/** What the claims of a JWT bearer say, as far as we read them (spec § 2, V1: `userId`, `exp`). Never logged. */
function claimsOf(bearer: string): { readonly exp?: number; readonly userId?: string } {
  const payload = bearer.split('.')[1];
  if (payload === undefined) return {};
  try {
    const parsed = z
      .object({ exp: z.number().optional(), userId: z.string().optional() })
      .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success) return {};
    const { exp, userId } = parsed.data;
    return { ...(exp === undefined ? {} : { exp }), ...(userId === undefined ? {} : { userId }) };
  } catch {
    return {};
  }
}

/** `exp` of a JWT bearer, when the token is one (spec § 2, V2); `null` otherwise. Reads the expiry only, never logs. */
export function revealTokenExpiry(bearer: string): Date | null {
  const { exp } = claimsOf(bearer);
  return exp === undefined ? null : new Date(exp * 1_000);
}

/**
 * `null` for anything that is not a Reveal session of this shape: the route refuses it before storing. A token that
 * names another member than the session says is `'member_mismatch'` (ADR 0147 § 4): the member pinned is the token's.
 */
export const revealSessionShape: SessionShape = (raw) => {
  const session = parseRevealSession(raw);
  if (session === null) return null;
  const { userId } = claimsOf(session.bearer);
  if (userId !== undefined && userId !== session.userId) return 'member_mismatch';
  return {
    owner: session.modelId,
    member: session.userId,
    expiresAt: revealTokenExpiry(session.bearer),
    memberInToken: userId !== undefined,
  };
};
