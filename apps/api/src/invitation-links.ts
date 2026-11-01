import { createHash, randomBytes } from 'node:crypto';

import {
  AuditEntryIdSchema,
  CreateInvitationLinkBodySchema,
  DomainError,
  InspectInvitationLinkBodySchema,
  InvitationLinkCreatedSchema,
  InvitationLinkIdSchema,
  InvitationLinkPreviewSchema,
  InvitationLinkPurposeSchema,
  InvitationLinkTokenSchema,
  MeSchema,
  newId,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  TeamMemberIdSchema,
  UserIdSchema,
  type InvitationLinkPurpose,
  type PasswordInvalidReason,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authHeaders, meOf, type Auth, type RequireRole } from './auth';
import type { Config } from './config';

/** A link is valid 72 hours (EQ-10). */
const LINK_LIFETIME = '72 hours';
/** 256 random bits, base64url: 43 characters. */
const TOKEN_BYTES = 32;
/**
 * Per IP, each route its own counter. They fail closed (security.md): a link opens an account, so a refusal beats a
 * burst of guesses while the counters are out of reach.
 */
const INSPECT_LIMIT = { max: 30, timeWindow: '15 minutes', skipOnError: false };
const REDEEM_LIMIT = { max: 10, timeWindow: '15 minutes', skipOnError: false };
/** Where the web app reads the token, in the fragment: never sent to a server, never in a `Referer`. */
const PAGE_OF: Record<InvitationLinkPurpose, string> = {
  invitation: '/bienvenue',
  reset: '/nouveau-mot-de-passe',
};

/** Unknown, used, replaced, expired, or the member left: one answer, so it tells nothing about which. */
class InvitationLinkNotFound extends DomainError {
  constructor() {
    super(
      'invitation_link_not_found',
      'Ce lien n’est plus valable : demande-en un nouveau à ton responsable',
    );
  }
}

class PasswordInvalid extends DomainError {
  constructor(reason: PasswordInvalidReason) {
    const message: Record<PasswordInvalidReason, string> = {
      too_short: `Mot de passe trop court (${String(PASSWORD_MIN_LENGTH)} caractères au moins)`,
      too_long: `Mot de passe trop long (${String(PASSWORD_MAX_LENGTH)} caractères au plus)`,
      refused: 'Ce mot de passe n’est pas accepté, choisis-en un autre',
    };
    super('password_invalid', message[reason], { details: { reason } });
  }
}

class MemberNotFound extends DomainError {
  constructor() {
    super('member_not_found', 'Membre introuvable');
  }
}

class MemberLeft extends DomainError {
  constructor() {
    super('member_left_conflict', 'Ce membre a quitté l’équipe : sa fiche ne change plus');
  }
}

/** Only the SHA-256 of a token is stored or compared. */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function passwordProblem(password: string): PasswordInvalidReason | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  return null;
}

/** A link still usable: not used, not replaced, not expired, and its member has not left. */
const usable = sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null
  and ${schema.invitationLinks.expiresAt} > now() and ${schema.teamMembers.status} <> 'left'`;

async function audit(
  tx: Transaction,
  entry: { userId: string; action: string; linkId: string; ip: string; details: Record<string, unknown> },
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: entry.userId,
    action: entry.action,
    entity: 'invitation_link',
    entityId: entry.linkId,
    ip: entry.ip,
    details: entry.details,
  });
}

/**
 * `POST /v1/team/members/:memberId/invitation-link` (owner, recent sign-in): replaces the member's live link, if any,
 * by a new one valid 72 h. The token leaves the server once, in the URL it answers.
 */
async function createLinkUnscoped(
  adminDb: Database,
  input: { memberId: string; purpose: InvitationLinkPurpose; ownerId: string; ip: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return withAdmin(adminDb, async (tx) => {
    // The member's row is the lock: two links asked at once are made one after the other.
    const [member] = await tx
      .select({ status: schema.teamMembers.status })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, input.memberId))
      .for('update');
    if (member === undefined) throw new MemberNotFound();
    if (member.status === 'left') throw new MemberLeft();
    const replaced = await tx
      .update(schema.invitationLinks)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(schema.invitationLinks.memberId, input.memberId),
          sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
        ),
      )
      .returning({ id: schema.invitationLinks.id });
    for (const link of replaced) {
      await audit(tx, {
        userId: input.ownerId,
        action: 'invitation_link.revoke',
        linkId: link.id,
        ip: input.ip,
        details: { memberId: input.memberId },
      });
    }
    const id = newId(InvitationLinkIdSchema);
    const [created] = await tx
      .insert(schema.invitationLinks)
      .values({
        id,
        memberId: input.memberId,
        purpose: input.purpose,
        tokenHash: hashOf(token),
        createdBy: input.ownerId,
        expiresAt: sql`now() + ${LINK_LIFETIME}::interval`,
      })
      .returning({ expiresAt: schema.invitationLinks.expiresAt });
    if (created === undefined) throw new Error('invitation link not created');
    await audit(tx, {
      userId: input.ownerId,
      action: 'invitation_link.create',
      linkId: id,
      ip: input.ip,
      details: { purpose: input.purpose, memberId: input.memberId, replaced: replaced.length },
    });
    return { token, expiresAt: created.expiresAt };
  });
}

/** `POST /v1/invitation-links/inspect`: what the page shows before the link is used; reading does not use it. */
async function inspectLinkUnscoped(adminDb: Database, token: string) {
  const [row] = await withAdmin(adminDb, (tx) =>
    tx
      .select({
        purpose: schema.invitationLinks.purpose,
        email: schema.user.email,
        displayName: schema.teamMembers.displayName,
        country: schema.teamMembers.country,
        expiresAt: schema.invitationLinks.expiresAt,
      })
      .from(schema.invitationLinks)
      .innerJoin(schema.teamMembers, eq(schema.teamMembers.id, schema.invitationLinks.memberId))
      .innerJoin(schema.user, eq(schema.user.id, schema.teamMembers.userId))
      .where(and(eq(schema.invitationLinks.tokenHash, hashOf(token)), usable)),
  );
  if (row === undefined) throw new InvitationLinkNotFound();
  return InvitationLinkPreviewSchema.parse({ ...row, expiresAt: row.expiresAt.toISOString() });
}

const accountColumns = {
  id: schema.user.id,
  email: schema.user.email,
  name: schema.user.name,
  role: schema.user.role,
  creatorIds: schema.user.creatorIds,
};
type AccountRow = Pick<typeof schema.user.$inferSelect, keyof typeof accountColumns>;

/**
 * `POST /v1/invitation-links/redeem`, in one transaction: uses the link (an atomic update, so two requests at once
 * cannot both succeed), sets the member's password and ends all his sessions. A refused password changes nothing.
 */
async function redeemLinkUnscoped(
  adminDb: Database,
  input: { token: string; passwordHash: string; ip: string },
): Promise<AccountRow> {
  return withAdmin(adminDb, async (tx) => {
    const [link] = await tx
      .update(schema.invitationLinks)
      .set({ usedAt: sql`now()` })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.id, schema.invitationLinks.memberId),
          eq(schema.invitationLinks.tokenHash, hashOf(input.token)),
          usable,
        ),
      )
      .returning({
        id: schema.invitationLinks.id,
        purpose: schema.invitationLinks.purpose,
        userId: schema.teamMembers.userId,
      });
    if (link === undefined) throw new InvitationLinkNotFound();
    const [account] = await tx
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(and(eq(schema.account.userId, link.userId), eq(schema.account.providerId, 'credential')));
    if (account === undefined) {
      // Better Auth's own shape for a password account (`createOwner` makes the same through its adapter).
      await tx.insert(schema.account).values({
        id: newId(UserIdSchema),
        accountId: link.userId,
        providerId: 'credential',
        userId: link.userId,
        password: input.passwordHash,
      });
    } else {
      await tx
        .update(schema.account)
        .set({ password: input.passwordHash, updatedAt: sql`now()` })
        .where(eq(schema.account.id, account.id));
    }
    const ended = await tx
      .delete(schema.session)
      .where(eq(schema.session.userId, link.userId))
      .returning({ id: schema.session.id });
    await audit(tx, {
      userId: link.userId,
      action: 'invitation_link.redeem',
      linkId: link.id,
      ip: input.ip,
      details: { purpose: InvitationLinkPurposeSchema.parse(link.purpose), sessionsEnded: ended.length },
    });
    const [member] = await tx.select(accountColumns).from(schema.user).where(eq(schema.user.id, link.userId));
    if (member === undefined) throw new InvitationLinkNotFound();
    return member;
  });
}

/** A member's link still out: not used and not replaced, whether or not it has expired. */
export interface LiveInvitationLink {
  readonly purpose: InvitationLinkPurpose;
  readonly expiresAt: Date;
}

/**
 * The live link of each member asked for, for the team's list (« Lien valable jusqu'à… », « Lien expiré »): at most
 * one per member (unique index). A member with no link out, or whose last link was used, is absent. Through `withAdmin`,
 * as every read of the table: the team module receives this function, never the table.
 */
export function liveInvitationLinksUnscoped(
  adminDb: Database,
  memberIds: readonly string[],
): Promise<ReadonlyMap<string, LiveInvitationLink>> {
  if (memberIds.length === 0) return Promise.resolve(new Map());
  return withAdmin(adminDb, async (tx) => {
    const rows = await tx
      .select({
        memberId: schema.invitationLinks.memberId,
        purpose: schema.invitationLinks.purpose,
        expiresAt: schema.invitationLinks.expiresAt,
      })
      .from(schema.invitationLinks)
      .where(
        and(
          inArray(schema.invitationLinks.memberId, [...memberIds]),
          sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
        ),
      );
    return new Map(
      rows.map((row) => [
        row.memberId,
        { purpose: InvitationLinkPurposeSchema.parse(row.purpose), expiresAt: row.expiresAt },
      ]),
    );
  });
}

export interface InvitationLinkRoutesDeps {
  readonly auth: Auth;
  readonly db: Database;
  readonly adminDb: Database;
  readonly config: Pick<Config, 'WEB_ORIGIN'>;
  readonly requireRole: RequireRole;
  readonly recentLogin: preValidationAsyncHookHandler;
}

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });
/**
 * The contract bounds the password; read here as a plain string so that a password out of bounds answers
 * `password_invalid` with its reason, as the page expects, rather than a validation error. Bounded all the same.
 */
const RedeemBodySchema = z.object({
  token: InvitationLinkTokenSchema,
  password: z.string().max(4 * PASSWORD_MAX_LENGTH),
});

/** Opens the member's session through Better Auth itself, so the cookie is the one every sign-in sets. */
async function openSession(
  auth: Auth,
  request: FastifyRequest,
  reply: FastifyReply,
  credentials: { email: string; password: string },
): Promise<void> {
  const { headers } = await auth.api.signInEmail({
    body: credentials,
    headers: authHeaders(request),
    returnHeaders: true,
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) void reply.header('set-cookie', cookies);
}

/** The three routes of the invitation links (EQ-10). The table is reached through `withAdmin` only. */
export function createInvitationLinkRoutes(deps: InvitationLinkRoutesDeps): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      '/team/members/:memberId/invitation-link',
      {
        preValidation: [deps.requireRole('owner'), deps.recentLogin],
        schema: {
          params: MemberParamsSchema,
          body: CreateInvitationLinkBodySchema,
          response: { 200: InvitationLinkCreatedSchema },
        },
      },
      async (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const { token, expiresAt } = await createLinkUnscoped(deps.adminDb, {
          memberId: request.params.memberId,
          purpose: request.body.purpose,
          ownerId: request.user.id,
          ip: request.ip,
        });
        const url = new URL(PAGE_OF[request.body.purpose], deps.config.WEB_ORIGIN);
        url.hash = `t=${token}`;
        return { url: url.toString(), expiresAt: expiresAt.toISOString() };
      },
    );

    app.post(
      '/invitation-links/inspect',
      {
        config: { rateLimit: INSPECT_LIMIT },
        schema: { body: InspectInvitationLinkBodySchema, response: { 200: InvitationLinkPreviewSchema } },
      },
      (request) => inspectLinkUnscoped(deps.adminDb, request.body.token),
    );

    app.post(
      '/invitation-links/redeem',
      {
        config: { rateLimit: REDEEM_LIMIT },
        schema: { body: RedeemBodySchema, response: { 200: MeSchema } },
      },
      async (request, reply) => {
        const { token, password } = request.body;
        const problem = passwordProblem(password);
        if (problem !== null) throw new PasswordInvalid(problem);
        // Hashed before the transaction: scrypt is slow, and the link's row stays locked only for the writes.
        const passwordHash = await (await deps.auth.$context).password.hash(password);
        const account = await redeemLinkUnscoped(deps.adminDb, { token, passwordHash, ip: request.ip });
        await openSession(deps.auth, request, reply, { email: account.email, password });
        const me = await meOf(deps.db, account);
        if (me === null) throw new Error('redeemed account does not validate');
        return me;
      },
    );
    return Promise.resolve();
  };
}
