import {
  AccountsSecuritySchema,
  AuditEntryIdSchema,
  BackupCodesSchema,
  ClosedSessionsSchema,
  deviceOf,
  DomainError,
  networkOf,
  newId,
  OpenSessionsSchema,
  PasskeysSchema,
  ReauthenticateBodySchema,
  RemovedPasskeysSchema,
  UserRoleSchema,
  type AccountsSecurity,
  type ClosedSessions,
  type OpenSessions,
  type PasskeyErrorCode,
  type Passkeys,
  type RemovedPasskeys,
  type SecuritySettingsErrorCode,
} from '@nirvana/contracts';
import {
  and,
  eq,
  removePasskeys,
  revokeSignIns,
  schema,
  sql,
  withAdmin,
  type Database,
  type Transaction,
} from '@nirvana/db';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  authHeaders,
  SESSION_MAX_AGE_MS,
  identityConfirmed,
  ReauthenticationLimited,
  ReauthenticationRefused,
  SessionUnauthenticated,
  sessionOf,
  type Auth,
  type RequireRole,
} from './auth';
import { passkeysOf } from './passkeys';
import { recordRefusal } from './security-alerts';

/**
 * Réglages › Sécurité (ADR 0046 § 7, SEC-04): each person sees and closes their own sessions and gets new backup
 * codes; the owner sees, per account, whether its second factor is active, and closes all its sessions. Closing every
 * other session forgets the trusted devices too (§ 3). Nothing here shows a full address: a network, never more.
 */

/** New backup codes per account: the password and a code each time, a guess stays slow. Bounds of its own. */
const BACKUP_CODES_PER_ACCOUNT = 5;
const BACKUP_CODES_ACCOUNT_WINDOW = '15 minutes';

class SessionNotFound extends DomainError {
  constructor() {
    super('session_not_found' satisfies SecuritySettingsErrorCode, 'Cette session est déjà fermée');
  }
}

/** The session the request came with is closed by signing out, never from the list. */
class CurrentSessionConflict extends DomainError {
  constructor() {
    super(
      'session_current_conflict' satisfies SecuritySettingsErrorCode,
      'C’est la session de cet appareil : déconnecte-toi pour la fermer',
    );
  }
}

/** The owner's own account is closed from the list of its sessions above, never all at once: that would sign him out. */
class OwnAccountConflict extends DomainError {
  constructor() {
    super(
      'account_current_conflict' satisfies SecuritySettingsErrorCode,
      'C’est ton compte : ferme tes autres sessions plus haut',
    );
  }
}

class AccountNotFound extends DomainError {
  constructor() {
    super('account_not_found' satisfies SecuritySettingsErrorCode, 'Ce compte n’existe pas');
  }
}

class PasskeyNotFound extends DomainError {
  constructor() {
    super('passkey_not_found' satisfies PasskeyErrorCode, 'Cette clé d’accès est déjà retirée');
  }
}

const SessionParamsSchema = z.object({ sessionId: z.string().min(1).max(128) });
const PasskeyParamsSchema = z.object({ passkeyId: z.string().min(1).max(128) });
const AccountParamsSchema = z.object({ userId: z.string().min(1).max(128) });

/** Better Auth's answer to new backup codes, read for the codes only. */
const GeneratedSchema = z.object({ backupCodes: z.array(z.string()) });

/** One line of `audit_log` for an act of this screen, in the caller's transaction. */
const audit = (
  tx: Transaction,
  entry: { userId: string; action: string; entityId: string; ip: string; details?: Record<string, unknown> },
) =>
  tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: entry.userId,
    action: entry.action,
    entity: 'user',
    entityId: entry.entityId,
    details: entry.details ?? {},
    ip: entry.ip,
  });

export interface SecuritySettingsDeps {
  readonly auth: Auth;
  readonly db: Database;
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  readonly requireRecentLogin: preValidationAsyncHookHandler;
}

export function createSecuritySettingsRoutes(deps: SecuritySettingsDeps): FastifyPluginAsyncZod {
  const { auth, db, adminDb, requireRole, requireRecentLogin } = deps;
  const anyone = requireRole(...UserRoleSchema.options);

  /** The signed-in account and the id of the session this request came with. */
  const signedIn = async (request: FastifyRequest) => {
    if (request.user === null) throw new SessionUnauthenticated();
    const current = await sessionOf(auth, db, request);
    if (current === null) throw new SessionUnauthenticated();
    return { userId: request.user.id, sessionId: current.session.id };
  };

  return (app) => {
    app.get(
      '/auth/sessions',
      { preValidation: anyone, schema: { response: { 200: OpenSessionsSchema } } },
      async (request): Promise<OpenSessions> => {
        const { userId, sessionId } = await signedIn(request);
        const rows = await withAdmin(adminDb, (tx) =>
          tx
            .select({
              id: schema.session.id,
              userAgent: schema.session.userAgent,
              ipAddress: schema.session.ipAddress,
              createdAt: schema.session.createdAt,
              updatedAt: schema.session.updatedAt,
            })
            .from(schema.session)
            // Alive only: a session past its 7 days (ADR 0046 § 6) is refused at its next request, never shown.
            .where(
              and(
                eq(schema.session.userId, userId),
                sql`${schema.session.expiresAt} > now()`,
                sql`${schema.session.createdAt} > now() - make_interval(secs => ${SESSION_MAX_AGE_MS / 1000})`,
              ),
            )
            .orderBy(sql`${schema.session.updatedAt} desc`),
        );
        return {
          sessions: rows.map((row) => ({
            id: row.id,
            device: deviceOf(row.userAgent),
            network: networkOf(row.ipAddress),
            createdAt: row.createdAt.toISOString(),
            lastActiveAt: row.updatedAt.toISOString(),
            current: row.id === sessionId,
          })),
        };
      },
    );

    // One of one's own sessions, from another device: it is unusable at its next request.
    app.delete(
      '/auth/sessions/:sessionId',
      { preValidation: anyone, schema: { params: SessionParamsSchema } },
      async (request, reply) => {
        const { userId, sessionId } = await signedIn(request);
        if (request.params.sessionId === sessionId) throw new CurrentSessionConflict();
        await withAdmin(adminDb, async (tx) => {
          const closed = await tx
            .delete(schema.session)
            .where(and(eq(schema.session.id, request.params.sessionId), eq(schema.session.userId, userId)))
            .returning({ id: schema.session.id });
          if (closed.length === 0) throw new SessionNotFound();
          await audit(tx, {
            userId,
            action: 'auth.session_closed',
            entityId: userId,
            ip: request.ip,
            details: { sessionId: request.params.sessionId },
          });
        });
        return reply.code(204).send();
      },
    );

    // Every session but this one, and every trusted device: a stolen phone is signed out and asks for the code again.
    app.post(
      '/auth/sessions/close-others',
      { preValidation: anyone, schema: { response: { 200: ClosedSessionsSchema } } },
      async (request): Promise<ClosedSessions> => {
        const { userId, sessionId } = await signedIn(request);
        return withAdmin(adminDb, async (tx) => {
          const closed = await revokeSignIns(tx, userId, { keepSessionId: sessionId });
          await audit(tx, {
            userId,
            action: 'auth.sessions_revoked',
            entityId: userId,
            ip: request.ip,
            details: { scope: 'others', revoked: closed.sessions, trustedDevices: closed.trustedDevices },
          });
          return { sessions: closed.sessions, trustedDevices: closed.trustedDevices };
        });
      },
    );

    // Ten new backup codes (ADR 0046 § 2): the password and a code, as a confirmation, then Better Auth's own route.
    const perAccount = app.createRateLimit({
      max: BACKUP_CODES_PER_ACCOUNT,
      timeWindow: BACKUP_CODES_ACCOUNT_WINDOW,
      keyGenerator: (request) => `backup-codes:${request.user?.id ?? request.ip}`,
      skipOnError: false,
    });
    app.post(
      '/auth/two-factor/generate-backup-codes',
      {
        preValidation: [
          anyone,
          async (request, reply) => {
            const attempt = await perAccount(request);
            if (attempt.isAllowed || !attempt.isExceeded) return;
            void reply.header('retry-after', attempt.ttlInSeconds);
            throw new ReauthenticationLimited();
          },
        ],
        schema: { body: ReauthenticateBodySchema, response: { 200: BackupCodesSchema } },
      },
      async (request) => {
        const { userId } = await signedIn(request);
        const { password, code } = request.body;
        if (!(await identityConfirmed(auth, request, userId, password, code))) {
          // Counted for the alert of repeated refusals; a line that cannot be written never changes the answer.
          try {
            await recordRefusal(adminDb, { userId, action: 'auth.reauthentication_refused', ip: request.ip });
          } catch (error) {
            request.log.warn({ err: error }, 'security: a refusal could not be recorded');
          }
          throw new ReauthenticationRefused();
        }
        const generated = GeneratedSchema.parse(
          await auth.api.generateBackupCodes({ headers: authHeaders(request), body: { password } }),
        );
        await withAdmin(adminDb, (tx) =>
          audit(tx, { userId, action: 'auth.backup_codes_regenerated', entityId: userId, ip: request.ip }),
        );
        return BackupCodesSchema.parse(generated);
      },
    );

    // One's own passkeys (ADR 0053 § 5): the device each was added from, the keychain, when added and last used.
    app.get(
      '/auth/passkeys',
      { preValidation: anyone, schema: { response: { 200: PasskeysSchema } } },
      async (request): Promise<Passkeys> => {
        const { userId } = await signedIn(request);
        return { passkeys: await passkeysOf(db, userId) };
      },
    );

    // Removing one of one's own keys: a sensitive action (the password and the code, or a gesture on another key).
    app.delete(
      '/auth/passkeys/:passkeyId',
      { preValidation: [anyone, requireRecentLogin], schema: { params: PasskeyParamsSchema } },
      async (request, reply) => {
        const { userId } = await signedIn(request);
        await withAdmin(adminDb, async (tx) => {
          const removed = await tx
            .delete(schema.passkey)
            .where(and(eq(schema.passkey.id, request.params.passkeyId), eq(schema.passkey.userId, userId)))
            .returning({ id: schema.passkey.id });
          if (removed.length === 0) throw new PasskeyNotFound();
          await audit(tx, {
            userId,
            action: 'auth.passkey_removed',
            entityId: userId,
            ip: request.ip,
            details: { passkeyId: request.params.passkeyId },
          });
        });
        return reply.code(204).send();
      },
    );

    // For the owner: each account's second factor, how many sessions it has open and how many passkeys it holds; no
    // device, no network.
    app.get(
      '/settings/security/accounts',
      { preValidation: requireRole('owner'), schema: { response: { 200: AccountsSecuritySchema } } },
      async (): Promise<AccountsSecurity> => {
        const rows = await withAdmin(adminDb, (tx) =>
          tx.execute<{
            id: string;
            name: string;
            role: string;
            second_factor: boolean;
            sessions: number;
            passkeys: number;
            last_active_at: Date | string | null;
          }>(sql`
            select u.id, u.name, u.role, u.two_factor_enabled as second_factor,
              count(s.id)::int as sessions, max(s.updated_at) as last_active_at,
              (select count(*)::int from passkey p where p.user_id = u.id) as passkeys
            from "user" u
            left join session s on s.user_id = u.id and s.expires_at > now()
              and s.created_at > now() - make_interval(secs => ${SESSION_MAX_AGE_MS / 1000})
            where not exists (select 1 from team_members m where m.user_id = u.id and m.status = 'left')
            group by u.id
            order by (u.role = 'owner') desc, u.name`),
        );
        return AccountsSecuritySchema.parse({
          accounts: rows.rows.map((row) => ({
            userId: row.id,
            name: row.name,
            role: row.role,
            secondFactor: row.second_factor,
            sessions: row.sessions,
            passkeys: row.passkeys,
            lastActiveAt: row.last_active_at === null ? null : new Date(row.last_active_at).toISOString(),
          })),
        });
      },
    );

    // The owner closes every session of an account, with its trusted devices (ADR 0046 § 7): a sensitive action.
    app.post(
      '/settings/security/accounts/:userId/close-sessions',
      {
        preValidation: [requireRole('owner'), requireRecentLogin],
        schema: { params: AccountParamsSchema, response: { 200: ClosedSessionsSchema } },
      },
      async (request): Promise<ClosedSessions> => {
        const { userId: ownerId } = await signedIn(request);
        const target = request.params.userId;
        if (target === ownerId) throw new OwnAccountConflict();
        return withAdmin(adminDb, async (tx) => {
          const [account] = await tx
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, target));
          if (account === undefined) throw new AccountNotFound();
          const closed = await revokeSignIns(tx, target);
          await audit(tx, {
            userId: ownerId,
            action: 'auth.sessions_revoked',
            entityId: target,
            ip: request.ip,
            details: { scope: 'account', revoked: closed.sessions, trustedDevices: closed.trustedDevices },
          });
          return { sessions: closed.sessions, trustedDevices: closed.trustedDevices };
        });
      },
    );
    // The owner removes every passkey of an account (ADR 0053 § 5), his own included: a sensitive action. Its sessions
    // stay open: closing them is the gesture beside it.
    app.post(
      '/settings/security/accounts/:userId/remove-passkeys',
      {
        preValidation: [requireRole('owner'), requireRecentLogin],
        schema: { params: AccountParamsSchema, response: { 200: RemovedPasskeysSchema } },
      },
      async (request): Promise<RemovedPasskeys> => {
        const { userId: ownerId } = await signedIn(request);
        const target = request.params.userId;
        return withAdmin(adminDb, async (tx) => {
          const [account] = await tx
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, target));
          if (account === undefined) throw new AccountNotFound();
          const removed = await removePasskeys(tx, target);
          await audit(tx, {
            userId: ownerId,
            action: 'auth.passkeys_removed',
            entityId: target,
            ip: request.ip,
            details: { removed },
          });
          return { passkeys: removed };
        });
      },
    );
    return Promise.resolve();
  };
}
