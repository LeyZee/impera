import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  AuditEntryIdSchema,
  DomainError,
  newId,
  PASSWORD_RESET_LINK_MINUTES,
  PASSWORD_RESET_PAGE,
  PASSWORD_RESET_REQUEST_MINUTES,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  PasswordResetPreviewSchema,
  PasswordResetRequestedSchema,
  PasswordResetTokenBodySchema,
  RedeemPasswordResetBodySchema,
  RequestPasswordResetBodySchema,
  type PasswordResetPreview,
} from '@impera/contracts';
import { and, eq, revokeSignIns, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Auth } from './auth';
import type { Config } from './config';
import { PasswordInvalid, passwordProblem } from './invitation-links';
import type { PasswordBreachCheck } from './password-breaches';

/**
 * « Mot de passe oublié » (SEC-05 lot 3, ADR 0068 §§ 2–5). An account of the agency (owner, or an operator still in
 * the team) asks a new password from the sign-in page; the link goes to its private Telegram chat (lot 2) and nowhere
 * else. The page always gets the same answer, at once: the work runs after it, so neither the body nor the time says
 * whether the account exists or has a chat. The link replaces the password, never the second factor.
 */

/** 256 random bits, base64url: 43 characters. */
const TOKEN_BYTES = 32;
/**
 * Per IP, fail closed (security.md): the request can only send a link to a chat the account linked itself, but a
 * refusal beats a burst while the counters are out of reach. The per-account pace is the 5 minutes below.
 */
const REQUEST_LIMIT = { max: 5, timeWindow: '15 minutes', skipOnError: false };
const INSPECT_LIMIT = { max: 30, timeWindow: '15 minutes', skipOnError: false };
const REDEEM_LIMIT = { max: 10, timeWindow: '15 minutes', skipOnError: false };

/** Unknown, used, replaced or expired: one answer, so it tells nothing about which. */
class PasswordResetLinkNotFound extends DomainError {
  constructor() {
    super('password_reset_link_not_found', 'Ce lien n’est plus valable : demandes-en un nouveau');
  }
}

/** The private chat of an account (the `telegram` module's), as this file needs it. */
interface PrivateChatPort {
  has(userId: string): Promise<boolean>;
  send(userId: string, text: string): Promise<'sent' | 'no_link' | 'failed'>;
}

export interface PasswordResetDeps {
  readonly auth: Auth;
  readonly adminDb: Database;
  readonly config: Pick<Config, 'WEB_ORIGIN'>;
  readonly passwordBreaches: PasswordBreachCheck;
  /** Null when Telegram is off (no encryption key): every request then ends with nothing sent. */
  readonly privateChat: PrivateChatPort | null;
  /** Runs the request's work after the answer has left; tests pass one they can wait for. */
  readonly later?: (work: () => Promise<void>) => void;
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
    ip: string;
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
async function makeLink(adminDb: Database, userId: string, ip: string): Promise<Made> {
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

/** The message of the private chat: what was asked and the link, never an amount, a creator's name or a key. */
function resetMessage(url: string): string {
  return [
    'Un nouveau mot de passe a été demandé pour ton compte Impera.',
    `Si c’est toi, ce lien vaut ${String(PASSWORD_RESET_LINK_MINUTES)} minutes : ${url}`,
    'Sinon, ignore ce message : ton mot de passe ne change pas.',
  ].join('\n\n');
}

/** What runs after the answer: never throws, every outcome is audited, nothing of it reaches the page. */
async function handleRequest(deps: PasswordResetDeps, email: string, ip: string): Promise<void> {
  const userId = await withAdmin(deps.adminDb, (tx) => accountOf(tx, email));
  if (userId === null) {
    // Nobody to name: the typed address is not kept.
    await withAdmin(deps.adminDb, (tx) =>
      audit(tx, { userId: null, action: 'password_reset.request', ip, details: { outcome: 'unknown' } }),
    );
    return;
  }
  if (deps.privateChat === null || !(await deps.privateChat.has(userId))) {
    await withAdmin(deps.adminDb, (tx) =>
      audit(tx, { userId, action: 'password_reset.request', ip, details: { outcome: 'no_channel' } }),
    );
    return;
  }
  const made = await makeLink(deps.adminDb, userId, ip);
  if (made === null) return;
  const url = new URL(PASSWORD_RESET_PAGE, deps.config.WEB_ORIGIN);
  url.hash = `t=${made.token}`;
  const outcome = await deps.privateChat.send(userId, resetMessage(url.toString()));
  await withAdmin(deps.adminDb, (tx) =>
    audit(tx, { userId, action: 'password_reset.send', linkId: made.linkId, ip, details: { outcome } }),
  );
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
    await audit(tx, {
      userId: link.userId,
      action: 'password_reset.redeem',
      linkId: link.id,
      ip: input.ip,
      details: { sessionsEnded: ended.sessions, trustedDevicesEnded: ended.trustedDevices },
    });
  });
}

/** `/v1/auth/password-reset`, open without a session; the table is reached through `withAdmin` only. */
export function createPasswordResetRoutes(deps: PasswordResetDeps): FastifyPluginAsyncZod {
  return (app) => {
    const later =
      deps.later ??
      ((work: () => Promise<void>) => {
        setImmediate(() => void work());
      });
    const guarded = (log: FastifyBaseLogger, work: () => Promise<void>) => {
      later(async () => {
        try {
          await work();
        } catch (error) {
          log.error({ err: error }, 'password reset: the request could not be handled');
        }
      });
    };

    app.post(
      '/auth/password-reset',
      {
        config: { rateLimit: REQUEST_LIMIT },
        schema: { body: RequestPasswordResetBodySchema, response: { 202: PasswordResetRequestedSchema } },
      },
      async (request, reply) => {
        const { email } = request.body;
        const ip = request.ip;
        if (z.email().safeParse(email.trim()).success) {
          guarded(request.log, () => handleRequest(deps, email, ip));
        }
        return reply.code(202).send({ message: PASSWORD_RESET_REQUESTED_MESSAGE });
      },
    );

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
