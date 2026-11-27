import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  AuditEntryIdSchema,
  DomainError,
  newId,
  PASSWORD_RESET_LINK_MINUTES,
  PASSWORD_RESET_PAGE,
  PASSWORD_RESET_REQUEST_MINUTES,
  PasswordResetPreviewSchema,
  PasswordResetTokenBodySchema,
  RedeemPasswordResetBodySchema,
  type PasswordResetPreview,
} from '@impera/contracts';
import {
  and,
  eq,
  revokeExtensionLinks,
  revokeSignIns,
  schema,
  sql,
  withAdmin,
  type Database,
  type Transaction,
} from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Auth } from './auth';
import { PasswordInvalid, passwordProblem } from './invitation-links';
import type { PasswordBreachCheck } from './password-breaches';

/**
 * « Mot de passe oublié » (SEC-05 lot 3, ADR 0068 §§ 2–5, amended 27/11/2026). The private Telegram chats are gone
 * (Telegram serves the creators' channels only), so nothing is asked from the sign-in page any more: a member gets a
 * reset link from Équipe (EQ-10), an owner from `pnpm ops:password-reset-link` on the server, where whoever runs it
 * already holds everything. The link replaces the password, never the second factor.
 */

/** 256 random bits, base64url: 43 characters. */
const TOKEN_BYTES = 32;
/** Per IP, fail closed (security.md): a refusal beats a burst while the counters are out of reach. */
const INSPECT_LIMIT = { max: 30, timeWindow: '15 minutes', skipOnError: false };
const REDEEM_LIMIT = { max: 10, timeWindow: '15 minutes', skipOnError: false };

/** Unknown, used, replaced or expired: one answer, so it tells nothing about which. */
class PasswordResetLinkNotFound extends DomainError {
  constructor() {
    super('password_reset_link_not_found', 'Ce lien n’est plus valable : demandes-en un nouveau');
  }
}

export interface PasswordResetDeps {
  readonly auth: Auth;
  readonly adminDb: Database;
  readonly passwordBreaches: PasswordBreachCheck;
}

/** Only the SHA-256 of a token is stored or compared. */
const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** A link still usable, of an account that may still use it. */
const usable = sql`${schema.passwordResetLinks.usedAt} is null and ${schema.passwordResetLinks.revokedAt} is null
  and ${schema.passwordResetLinks.expiresAt} > now()`;

/** Owner, or an operator whose team member has not left (ADR 0068 § 5): a creator keeps her own space's way back. */
const mayReset = sql`exists (select 1 from ${schema.user} u where u.id = ${schema.passwordResetLinks.userId}
  and (u.role = 'owner' or (u.role = 'operator' and exists (
    select 1 from ${schema.teamMembers} m where m.user_id = u.id and m.status <> 'left'))))`;

async function audit(
  tx: Transaction,
  entry: {
    userId: string | null;
    action: string;
    linkId?: string;
    /** Null from the server's command line. */
    ip: string | null;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: entry.userId,
    action: entry.action,
    entity: 'password_reset_link',
    entityId: entry.linkId ?? null,
    ip: entry.ip,
    details: entry.details,
  });
}

/** The account an e-mail names, if it may ask (ADR 0068 § 5); case and spaces ignored. */
async function accountOf(tx: Transaction, email: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      sql`lower(${schema.user.email}) = ${email.trim().toLowerCase()}
        and (${schema.user.role} = 'owner' or (${schema.user.role} = 'operator' and exists (
          select 1 from ${schema.teamMembers} m where m.user_id = ${schema.user.id} and m.status <> 'left')))`,
    );
  return row?.id ?? null;
}

type Made = { readonly userId: string; readonly linkId: string; readonly token: string } | null;

/**
 * In one transaction, the account's row locked: a new link replacing a live one, unless one was made in the last
 * 5 minutes. Null, audited with its reason, when nothing is made.
 */
async function makeLink(adminDb: Database, userId: string, ip: string | null): Promise<Made> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return withAdmin(adminDb, async (tx) => {
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for('update');
    const [recent] = await tx
      .select({ id: schema.passwordResetLinks.id })
      .from(schema.passwordResetLinks)
      .where(
        and(
          eq(schema.passwordResetLinks.userId, userId),
          sql`${schema.passwordResetLinks.createdAt} > now() - make_interval(mins => ${PASSWORD_RESET_REQUEST_MINUTES})`,
        ),
      )
      .limit(1);
    if (recent !== undefined) {
      await audit(tx, { userId, action: 'password_reset.request', ip, details: { outcome: 'too_soon' } });
      return null;
    }
    await tx
      .update(schema.passwordResetLinks)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(schema.passwordResetLinks.userId, userId),
          sql`${schema.passwordResetLinks.usedAt} is null and ${schema.passwordResetLinks.revokedAt} is null`,
        ),
      );
    const linkId = randomUUID();
    await tx.insert(schema.passwordResetLinks).values({
      id: linkId,
      userId,
      tokenHash: hashOf(token),
      expiresAt: sql`now() + make_interval(mins => ${PASSWORD_RESET_LINK_MINUTES})`,
    });
    await audit(tx, { userId, action: 'password_reset.request', linkId, ip, details: { outcome: 'made' } });
    return { userId, linkId, token };
  });
}

/**
 * `pnpm ops:password-reset-link` (27/11/2026): a link for an account of the agency, owner included, made on the server
 * and printed there, never sent anywhere. Audited like the page's requests were, with no IP.
 */
export async function issuePasswordResetLink(
  adminDb: Database,
  email: string,
  webOrigin: string,
): Promise<
  | { readonly kind: 'made'; readonly url: string; readonly minutes: number }
  | { readonly kind: 'unknown' | 'too_soon' }
> {
  const userId = await withAdmin(adminDb, (tx) => accountOf(tx, email));
  if (userId === null) {
    await withAdmin(adminDb, (tx) =>
      audit(tx, {
        userId: null,
        action: 'password_reset.request',
        ip: null,
        details: { outcome: 'unknown' },
      }),
    );
    return { kind: 'unknown' };
  }
  const made = await makeLink(adminDb, userId, null);
  if (made === null) return { kind: 'too_soon' };
  const url = new URL(PASSWORD_RESET_PAGE, webOrigin);
  url.hash = `t=${made.token}`;
  return { kind: 'made', url: url.toString(), minutes: PASSWORD_RESET_LINK_MINUTES };
}

async function inspect(adminDb: Database, token: string): Promise<PasswordResetPreview> {
  const [row] = await withAdmin(adminDb, (tx) =>
    tx
      .select({ email: schema.user.email, expiresAt: schema.passwordResetLinks.expiresAt })
      .from(schema.passwordResetLinks)
      .innerJoin(schema.user, eq(schema.user.id, schema.passwordResetLinks.userId))
      .where(and(eq(schema.passwordResetLinks.tokenHash, hashOf(token)), usable, mayReset)),
  );
  if (row === undefined) throw new PasswordResetLinkNotFound();
  return { email: row.email, expiresAt: row.expiresAt.toISOString() };
}

/**
 * In one transaction: uses the link (an atomic update, so two requests at once cannot both succeed), sets the
 * password and ends every session and trusted device of the account. The second factor stays as it is: the code is
 * asked at the next sign-in (ADR 0068 § 3).
 */
async function redeem(
  adminDb: Database,
  input: { token: string; passwordHash: string; ip: string },
): Promise<void> {
  await withAdmin(adminDb, async (tx) => {
    const [link] = await tx
      .update(schema.passwordResetLinks)
      .set({ usedAt: sql`now()` })
      .where(and(eq(schema.passwordResetLinks.tokenHash, hashOf(input.token)), usable, mayReset))
      .returning({ id: schema.passwordResetLinks.id, userId: schema.passwordResetLinks.userId });
    if (link === undefined) throw new PasswordResetLinkNotFound();
    const changed = await tx
      .update(schema.account)
      .set({ password: input.passwordHash, updatedAt: sql`now()` })
      .where(and(eq(schema.account.userId, link.userId), eq(schema.account.providerId, 'credential')))
      .returning({ id: schema.account.id });
    // An account of the agency always has a password: without one, the link opens nothing.
    if (changed.length === 0) throw new PasswordResetLinkNotFound();
    const ended = await revokeSignIns(tx, link.userId);
    await revokeExtensionLinks(tx, link.userId);
    await audit(tx, {
      userId: link.userId,
      action: 'password_reset.redeem',
      linkId: link.id,
      ip: input.ip,
      details: { sessionsEnded: ended.sessions, trustedDevicesEnded: ended.trustedDevices },
    });
  });
}

/** `/v1/auth/password-reset/*`, open without a session; the table is reached through `withAdmin` only. */
export function createPasswordResetRoutes(deps: PasswordResetDeps): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      '/auth/password-reset/inspect',
      {
        config: { rateLimit: INSPECT_LIMIT },
        schema: { body: PasswordResetTokenBodySchema, response: { 200: PasswordResetPreviewSchema } },
      },
      (request) => inspect(deps.adminDb, request.body.token),
    );

    app.post(
      '/auth/password-reset/redeem',
      {
        config: { rateLimit: REDEEM_LIMIT },
        schema: { body: RedeemPasswordResetBodySchema, response: { 204: z.null() } },
      },
      async (request, reply) => {
        const { token, password } = request.body;
        const problem = passwordProblem(password);
        if (problem !== null) throw new PasswordInvalid(problem);
        // A dead link says so before the password is sent anywhere; the transaction below checks it again.
        await inspect(deps.adminDb, token);
        if (await deps.passwordBreaches(password)) throw new PasswordInvalid('breached');
        // Hashed before the transaction: scrypt is slow, and the link's row stays locked only for the writes.
        const passwordHash = await (await deps.auth.$context).password.hash(password);
        await redeem(deps.adminDb, { token, passwordHash, ip: request.ip });
        return reply.code(204).send(null);
      },
    );
    return Promise.resolve();
  };
}
