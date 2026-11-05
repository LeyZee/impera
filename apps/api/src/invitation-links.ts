import { createHash, randomBytes } from 'node:crypto';

import {
  AuditEntryIdSchema,
  CreateCreatorInvitationLinkBodySchema,
  CreateInvitationLinkBodySchema,
  CreatorAccountSchema,
  CreatorIdSchema,
  DomainError,
  InspectInvitationLinkBodySchema,
  InvitationLinkCreatedSchema,
  InvitationLinkIdSchema,
  InvitationLinkPreviewSchema,
  InvitationLinkPurposeSchema,
  InvitationLinkTokenSchema,
  MeSchema,
  networkOf,
  newId,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_DISTINCT,
  PASSWORD_MIN_LENGTH,
  TeamMemberIdSchema,
  UserIdSchema,
  type CreateCreatorInvitationLinkBody,
  type InvitationLinkPurpose,
  isPasswordTooPlain,
  type PasswordInvalidReason,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  resetSecondFactor,
  schema,
  sql,
  withAdmin,
  type Database,
  type Transaction,
} from '@impera/db';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authHeaders, meOf, type Auth, type RequireRole } from './auth';
import type { Config } from './config';
import type { PasswordBreachCheck } from './password-breaches';
import { publishSecurityAlert, roleOf } from './security-alerts';

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
      too_plain: `Mot de passe trop simple (${String(PASSWORD_MIN_LENGTH)} caractères hors espaces, dont ${String(PASSWORD_MIN_DISTINCT)} différents au moins)`,
      breached: 'Ce mot de passe circule dans des fuites de données connues, choisis-en un autre',
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
  if (isPasswordTooPlain(password)) return 'too_plain';
  return null;
}

/**
 * A link still usable: not used, not replaced, not expired, and, for a member's, its member has not left. A creator's
 * own account (CR-02) has no member: its link names the account itself (`user_id`), and dies with her archiving
 * (ADR 0071 § 2), which also revokes it.
 */
const usable = sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null
  and ${schema.invitationLinks.expiresAt} > now()
  and (${schema.invitationLinks.memberId} is null or exists (
    select 1 from ${schema.teamMembers} m where m.id = ${schema.invitationLinks.memberId} and m.status <> 'left'))
  and not exists (
    select 1 from ${schema.user} u join ${schema.creators} c on c.id = any(u.creator_ids)
    where u.id = ${schema.invitationLinks.userId} and u.role = 'creator' and c.archived_at is not null)`;

/**
 * Her archiving (ADR 0071 § 2): the live links of her own account are revoked, each audited with the owner. A link
 * out stays dead when she is reopened: her space reopens by a new one. Returns how many were revoked.
 */
export async function revokeCreatorLinksUnscoped(
  adminDb: Database,
  input: { creatorId: string; ownerId: string },
): Promise<number> {
  return withAdmin(adminDb, async (tx) => {
    const revoked = await tx
      .update(schema.invitationLinks)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          sql`${schema.invitationLinks.userId} in (select u.id from ${schema.user} u
            where u.role = 'creator' and u.creator_ids = array[${input.creatorId}]::uuid[])`,
          sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
        ),
      )
      .returning({ id: schema.invitationLinks.id });
    for (const link of revoked) {
      await tx.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId: input.ownerId,
        action: 'invitation_link.revoke',
        entity: 'invitation_link',
        entityId: link.id,
        details: { creatorId: input.creatorId, reason: 'creator_archived' },
      });
    }
    return revoked.length;
  });
}

/** The account a link opens: its member's, or the creator's account it names. */
const accountOfLink = sql<string>`coalesce(${schema.invitationLinks.userId},
  (select m.user_id from ${schema.teamMembers} m where m.id = ${schema.invitationLinks.memberId}))`;

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

class CreatorNotFound extends DomainError {
  constructor() {
    super('creator_not_found', 'Créatrice introuvable');
  }
}

class CreatorAccountNotFound extends DomainError {
  constructor() {
    super('creator_account_not_found', 'Elle n’a pas encore de compte : envoie-lui d’abord une invitation');
  }
}

class CreatorAccountConflict extends DomainError {
  constructor() {
    super('creator_account_conflict', 'Elle a déjà un compte, avec une autre adresse e-mail');
  }
}

class AccountEmailConflict extends DomainError {
  constructor() {
    super('account_email_conflict', 'Un compte existe déjà avec cet e-mail');
  }
}

/**
 * `POST /v1/creators/:creatorId/invitation-link` (owner, recent sign-in; CR-02, ADR 0042 § 1): the link of her own
 * account, made the first time with the e-mail given (role `creator`, this creator only, her name as the account's),
 * replacing a live link of that account, if any. The token leaves the server once, in the URL it answers.
 */
async function createCreatorLinkUnscoped(
  adminDb: Database,
  input: {
    creatorId: string;
    body: CreateCreatorInvitationLinkBody;
    ownerId: string;
    ip: string;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return withAdmin(adminDb, async (tx) => {
    // Her row is the lock: two links asked at once, or two accounts made at once, follow one another.
    const [creator] = await tx
      .select({ displayName: schema.creators.displayName, archivedAt: schema.creators.archivedAt })
      .from(schema.creators)
      .where(eq(schema.creators.id, input.creatorId))
      .for('update');
    // An archived creator has no space to open (ADR 0071 § 2): reopened first, then a new link.
    if (creator?.archivedAt !== null) throw new CreatorNotFound();
    const [existing] = await tx
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(
        and(
          eq(schema.user.role, 'creator'),
          sql`${schema.user.creatorIds} = array[${input.creatorId}]::uuid[]`,
        ),
      );
    const { body } = input;
    // Written as Better Auth looks it up at sign-in, trimmed and in lower case (Bilan, #473).
    const email = body.purpose === 'invitation' ? body.email.trim().toLowerCase() : null;
    let userId: string;
    if (existing !== undefined) {
      if (email !== null && existing.email.trim().toLowerCase() !== email) throw new CreatorAccountConflict();
      userId = existing.id;
    } else {
      if (email === null) throw new CreatorAccountNotFound();
      const [taken] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.email}) = ${email}`);
      if (taken !== undefined) throw new AccountEmailConflict();
      userId = newId(UserIdSchema);
      await tx.insert(schema.user).values({
        id: userId,
        name: creator.displayName,
        email,
        role: 'creator',
        creatorIds: [input.creatorId],
      });
      await tx.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId: input.ownerId,
        action: 'creator_account.create',
        entity: 'user',
        entityId: userId,
        ip: input.ip,
        details: { creatorId: input.creatorId },
      });
    }
    const replaced = await tx
      .update(schema.invitationLinks)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(schema.invitationLinks.userId, userId),
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
        details: { creatorId: input.creatorId },
      });
    }
    const id = newId(InvitationLinkIdSchema);
    const [created] = await tx
      .insert(schema.invitationLinks)
      .values({
        id,
        userId,
        purpose: body.purpose,
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
      details: { purpose: body.purpose, creatorId: input.creatorId, replaced: replaced.length },
    });
    return { token, expiresAt: created.expiresAt };
  });
}

/**
 * `GET /v1/creators/:creatorId/account` (owner; CR-02): her own account, whether her password is chosen, and when the
 * link out stops working. Read by the admin role, as the links are: `account` is Better Auth's table.
 */
async function creatorAccountUnscoped(adminDb: Database, creatorId: string) {
  return withAdmin(adminDb, async (tx) => {
    const [creator] = await tx
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId));
    if (creator === undefined) throw new CreatorNotFound();
    const [own] = await tx
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(
        and(eq(schema.user.role, 'creator'), sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`),
      );
    if (own === undefined) return CreatorAccountSchema.parse({ account: null });
    // Better Auth's password account: none until her invitation link is used (EQ-10).
    const [password] = await tx
      .select({ userId: schema.account.userId })
      .from(schema.account)
      .where(and(eq(schema.account.userId, own.id), eq(schema.account.providerId, 'credential')));
    const [link] = await tx
      .select({ expiresAt: schema.invitationLinks.expiresAt })
      .from(schema.invitationLinks)
      .where(
        and(
          eq(schema.invitationLinks.userId, own.id),
          sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
        ),
      )
      // One live link per account (0089's unique index); the latest one even so.
      .orderBy(sql`${schema.invitationLinks.createdAt} desc`)
      .limit(1);
    return CreatorAccountSchema.parse({
      account: {
        email: own.email,
        invitationPending: password === undefined,
        invitationExpiresAt: link?.expiresAt.toISOString() ?? null,
      },
    });
  });
}

/** `POST /v1/invitation-links/inspect`: what the page shows before the link is used; reading does not use it. */
async function inspectLinkUnscoped(adminDb: Database, token: string) {
  const [row] = await withAdmin(adminDb, (tx) =>
    tx
      .select({
        purpose: schema.invitationLinks.purpose,
        email: schema.user.email,
        // The member's display name; for a creator's own account, her creator's (CR-02).
        displayName: sql<string>`coalesce(${schema.teamMembers.displayName}, ${schema.creators.displayName}, ${schema.user.name})`,
        country: schema.teamMembers.country,
        memberId: schema.teamMembers.id,
        expiresAt: schema.invitationLinks.expiresAt,
      })
      .from(schema.invitationLinks)
      .leftJoin(schema.teamMembers, eq(schema.teamMembers.id, schema.invitationLinks.memberId))
      .innerJoin(
        schema.user,
        sql`${schema.user.id} = coalesce(${schema.teamMembers.userId}, ${schema.invitationLinks.userId})`,
      )
      .leftJoin(
        schema.creators,
        sql`${schema.user.role} = 'creator' and ${schema.creators.id} = ${schema.user.creatorIds}[1]`,
      )
      .where(and(eq(schema.invitationLinks.tokenHash, hashOf(token)), usable)),
  );
  if (row === undefined) throw new InvitationLinkNotFound();
  const common = {
    purpose: row.purpose,
    email: row.email,
    displayName: row.displayName,
    expiresAt: row.expiresAt.toISOString(),
  };
  // A link names a member or an account, never both (`invitation_links_target_check`).
  return InvitationLinkPreviewSchema.parse(
    row.memberId === null
      ? { ...common, account: 'creator' }
      : { ...common, account: 'member', country: row.country },
  );
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
 * cannot both succeed), sets the member's password, ends all his sessions and trusted devices, and puts his second
 * factor back to zero (ADR 0046 § 2: a lost phone is what a reset link is for). A refused password changes nothing.
 */
async function redeemLinkUnscoped(
  adminDb: Database,
  input: { token: string; passwordHash: string; ip: string },
): Promise<AccountRow> {
  return withAdmin(adminDb, async (tx) => {
    const [link] = await tx
      .update(schema.invitationLinks)
      .set({ usedAt: sql`now()` })
      .where(and(eq(schema.invitationLinks.tokenHash, hashOf(input.token)), usable))
      .returning({
        id: schema.invitationLinks.id,
        purpose: schema.invitationLinks.purpose,
        userId: accountOfLink,
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
    const reset = await resetSecondFactor(tx, link.userId);
    await audit(tx, {
      userId: link.userId,
      action: 'invitation_link.redeem',
      linkId: link.id,
      ip: input.ip,
      details: {
        purpose: InvitationLinkPurposeSchema.parse(link.purpose),
        sessionsEnded: reset.sessions,
        trustedDevicesEnded: reset.trustedDevices,
        passkeysRemoved: reset.passkeys,
        secondFactorReset: reset.hadSecondFactor,
      },
    });
    // A second factor that was active, put back to zero by the link: told to the urgent groups (ADR 0046 § 8).
    if (reset.hadSecondFactor) {
      await publishSecurityAlert(tx, null, {
        reason: 'second_factor_reset',
        userId: link.userId,
        role: await roleOf(tx, link.userId),
        network: networkOf(input.ip),
        via: 'invitation_link',
      });
    }
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
      rows.flatMap((row) =>
        row.memberId === null
          ? []
          : [
              [
                row.memberId,
                { purpose: InvitationLinkPurposeSchema.parse(row.purpose), expiresAt: row.expiresAt },
              ] as const,
            ],
      ),
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
  readonly passwordBreaches: PasswordBreachCheck;
}

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
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

/**
 * The routes of the invitation links (EQ-10), a member's and a creator's own account's (CR-02). The table is reached
 * through `withAdmin` only.
 */
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

    app.get(
      '/creators/:creatorId/account',
      {
        preValidation: deps.requireRole('owner'),
        schema: { params: CreatorParamsSchema, response: { 200: CreatorAccountSchema } },
      },
      (request) => creatorAccountUnscoped(deps.adminDb, request.params.creatorId),
    );

    app.post(
      '/creators/:creatorId/invitation-link',
      {
        preValidation: [deps.requireRole('owner'), deps.recentLogin],
        schema: {
          params: CreatorParamsSchema,
          body: CreateCreatorInvitationLinkBodySchema,
          response: { 200: InvitationLinkCreatedSchema },
        },
      },
      async (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const { token, expiresAt } = await createCreatorLinkUnscoped(deps.adminDb, {
          creatorId: request.params.creatorId,
          body: request.body,
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
        // A dead link says so before the password is sent anywhere; the transaction below checks it again.
        await inspectLinkUnscoped(deps.adminDb, token);
        if (await deps.passwordBreaches(password)) throw new PasswordInvalid('breached');
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
