import {
  AuditEntryIdSchema,
  CurrentUserSchema,
  DomainError,
  MeSchema,
  newId,
  REAUTHENTICATION_ERROR_CODE,
  TeamMembershipSchema,
  UserIdSchema,
  UserRoleSchema,
  type CurrentUser,
  type Me,
  type UserRole,
} from '@nirvana/contracts';
import { eq, schema, withMember, type Database } from '@nirvana/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Config } from './config';
import type { Logger } from './logger';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireRole` once the session is checked; `null` on routes that do not require one. */
    user: CurrentUser | null;
    /** The team membership `requireRole` already read for an operator, so `/v1/me` does not read it twice. */
    membership: Membership | null;
  }
}

/** Dashboard sessions are short (security.md §6): 12 h, refreshed at most once an hour while in use. */
const SESSION_SECONDS = 12 * 60 * 60;
const SESSION_REFRESH_SECONDS = 60 * 60;
/** Attempts per minute and per IP on `/v1/auth/*`, tighter than the API-wide limit. */
const AUTH_RATE_LIMIT_PER_MINUTE = 20;
/** Sign-in attempts per account, whatever the IP: guessing one password from many addresses stays slow. */
const SIGN_IN_PER_ACCOUNT = 10;
const SIGN_IN_ACCOUNT_WINDOW = '15 minutes';
/**
 * The client IP as Fastify resolved it (`trustProxy`, TRUST_PROXY_HOPS), handed to Better Auth under a header of
 * our own: it never reads `x-forwarded-for`, which any client can write.
 */
const CLIENT_IP_HEADER = 'x-nirvana-client-ip';
const MIN_PASSWORD_LENGTH = 12;
/** A sensitive action needs a sign-in younger than this (ADR 0016). */
const RECENT_LOGIN_MS = 10 * 60 * 1000;

class SessionUnauthenticated extends DomainError {
  constructor() {
    super('session_unauthenticated', 'Connexion requise');
  }
}

class RoleForbidden extends DomainError {
  constructor() {
    super('role_forbidden', 'Action réservée à un autre rôle');
  }
}

/** Too many sign-ins on one account (security.md §6), whatever the addresses they came from. */
class SignInLimited extends DomainError {
  constructor() {
    super('sign_in_limited', 'Trop de tentatives sur ce compte : réessaie dans quelques minutes');
  }
}

/**
 * Any refused sign-in: a wrong e-mail, a wrong password, or a member who left the team (ADR 0023). One answer for all,
 * so the page never tells whether the account exists or whether the password was right.
 */
class SignInRefused extends DomainError {
  constructor() {
    super('sign_in_unauthenticated', 'E-mail ou mot de passe incorrect');
  }
}

/**
 * Better Auth's own refusals on the two routes it still serves, in the common error format and in French (api.md
 * § Erreurs): its body is English and of another shape. A 401 is the caller's to name (sign-in has its own); a status
 * it has no reason to send is an internal error, logged by the central handler.
 */
function refusalOf(status: number, onUnauthorized: () => DomainError): Error {
  if (status === 400) return new DomainError('request_invalid', 'Requête invalide');
  if (status === 401) return onUnauthorized();
  // Its origin and callback checks; ours has already refused a foreign origin.
  if (status === 403) return new DomainError('origin_forbidden', 'Origine non autorisée');
  return new Error(`Better Auth answered ${String(status)}`);
}

/** What a sign-in answers about its account, read to close the session it replaces. */
const SignedInSchema = z.object({ user: z.object({ id: z.string() }) });

class ReauthenticationRequired extends DomainError {
  constructor() {
    super(REAUTHENTICATION_ERROR_CODE, 'Mot de passe à confirmer pour cette action');
  }
}

/**
 * Better Auth on the Drizzle tables of `schema/auth.ts` (data-model.md): email and password, no public sign-up
 * (`createOwner` makes the first account), sessions in the database, cookies `HttpOnly` and `SameSite=Lax`,
 * `Secure` in production. The tables are out of RLS and reached with the application role, which is enough.
 */
// Better Auth infers its API type (with our additional fields) from these options; writing it out would lose them.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuth(config: Config, db: Database, logger: Logger) {
  return betterAuth({
    appName: 'Nirvana',
    baseURL: config.AUTH_BASE_URL,
    basePath: '/v1/auth',
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    user: {
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        creatorIds: { type: 'string[]', input: false, required: false },
      },
    },
    session: { expiresIn: SESSION_SECONDS, updateAge: SESSION_REFRESH_SECONDS },
    advanced: {
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // UUID v7 like every other id (ADR 0011), so `human:<userId>` actors validate. Also used for sessions.
      database: { generateId: () => newId(UserIdSchema) },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    // The API-wide limiter (and the tighter one on these routes) already applies; no anonymous telemetry.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    databaseHooks: {
      session: {
        create: {
          // A member who left opens no session (ADR 0023): Better Auth then answers 401, which the sign-in route turns
          // into the same refusal as a wrong password.
          before: async (session) => ((await hasLeftTeam(db, session.userId)) ? false : undefined),
          after: async (session, context) => {
            await db.insert(schema.auditLog).values({
              id: newId(AuditEntryIdSchema),
              userId: session.userId,
              action: 'auth.login',
              entity: 'session',
              entityId: session.id,
              ip: session.ipAddress ?? null,
            });
            logger.info({ userId: session.userId, path: context?.path }, 'user signed in');
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The request's headers for Better Auth, with the client IP we resolved in place of any the client sent. */
export function authHeaders(request: FastifyRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

const SignInBodySchema = z.looseObject({ email: z.string().min(1) });

/** The account a sign-in targets, for its own limit; a body without an email counts against the IP. */
function signInAccountKey(request: FastifyRequest): string {
  const parsed = SignInBodySchema.safeParse(request.body);
  return parsed.success ? `account:${parsed.data.email.trim().toLowerCase()}` : `ip:${request.ip}`;
}

/**
 * The signed-in user of a request, or `null`; the role and creators come from our columns, validated. A team member
 * whose scope is `self` (a chatter, a manager who is not active) reads a creator only through the conversations
 * routed to him: his creators move to `routedCreatorIds`, so every route that checks `creatorIds` refuses him at once.
 */
async function currentUser(
  auth: Auth,
  db: Database,
  request: FastifyRequest,
): Promise<{ user: CurrentUser; membership: Membership | null } | null> {
  const result = await auth.api.getSession({ headers: authHeaders(request) });
  if (result === null) return null;
  return userOf(db, result.user);
}

/** The columns of `user` that `/v1/me` starts from. */
interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role?: string | null | undefined;
  readonly creatorIds?: readonly string[] | null | undefined;
}

async function userOf(
  db: Database,
  row: AccountRow,
): Promise<{ user: CurrentUser; membership: Membership | null } | null> {
  const parsed = CurrentUserSchema.safeParse({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    creatorIds: row.creatorIds ?? [],
  });
  // A row that does not validate (unknown role) gets no access rather than a guessed one.
  if (!parsed.success) return null;
  const user = parsed.data;
  if (user.role !== 'operator') return { user, membership: null };
  const member = await membership(db, user.id);
  // A session still open when the member left is refused at its next request (ADR 0023), even before it is revoked.
  if (member.team?.status === 'left') return null;
  if (member.team === null || member.teamScope !== 'self') return { user, membership: member };
  return { user: { ...user, creatorIds: [], routedCreatorIds: user.creatorIds }, membership: member };
}

/**
 * Better Auth also returns the session token in the JSON body of sign-in (every `token` key is dropped, at any depth);
 * the cookie is all the dashboard needs, and a token readable by the page's JavaScript is what that cookie flag exists to
 * prevent.
 */
function withoutToken(json: string): string {
  if (json.trim() === '') return json;
  return JSON.stringify(JSON.parse(json), (key, value: unknown) => (key === 'token' ? undefined : value));
}

export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** Route guard: no session → 401, a session with another role → 403 (security.md §6). */
export function createRequireRole(auth: Auth, db: Database): RequireRole {
  return (...roles) =>
    async (request) => {
      const session = await currentUser(auth, db, request);
      if (session === null) throw new SessionUnauthenticated();
      if (!roles.includes(session.user.role)) throw new RoleForbidden();
      request.user = session.user;
      request.membership = session.membership;
    };
}

/**
 * Route guard for sensitive actions, after `requireRole` (ADR 0016: connecting, replacing or removing an AI key): the
 * session must have been opened less than 10 minutes ago, otherwise 403 `reauthentication_forbidden` and the page
 * asks for the password again. Signing in again opens a fresh session.
 */
export function createRequireRecentLogin(
  auth: Auth,
  now: () => Date = () => new Date(),
): preValidationAsyncHookHandler {
  return async (request) => {
    const result = await auth.api.getSession({ headers: authHeaders(request) });
    if (result === null) throw new SessionUnauthenticated();
    if (now().getTime() - result.session.createdAt.getTime() > RECENT_LOGIN_MS)
      throw new ReauthenticationRequired();
  };
}

type Membership = Pick<Me, 'team' | 'teamScope'>;

/**
 * The account's team role and scope (ADR 0024), read through `withMember`: the scope is the one the database policies
 * apply, never a second computation. No row, no membership; a row that does not validate has already failed
 * `withMember`, like here.
 */
function membership(db: Database, userId: string): Promise<Membership> {
  return withMember(db, userId, async (tx, teamScope) => {
    const [row] = await tx
      .select({ role: schema.teamMembers.teamRole, status: schema.teamMembers.status })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId));
    return { team: row === undefined ? null : TeamMembershipSchema.parse(row), teamScope };
  });
}

/** Whether the account is a team member marked `left`; the owner and an account without a team row never are. */
async function hasLeftTeam(db: Database, userId: string): Promise<boolean> {
  const { team } = await membership(db, userId);
  return team?.status === 'left';
}

/**
 * What `/v1/me` answers for an account, read without a request: the redeem of an invitation link (EQ-10) answers it for
 * the session it has just opened. `null` for a row that does not validate, as for a session.
 */
export async function meOf(db: Database, row: AccountRow): Promise<Me | null> {
  const signedIn = await userOf(db, row);
  if (signedIn === null) return null;
  return { ...signedIn.user, ...(signedIn.membership ?? (await membership(db, signedIn.user.id))) };
}

/** Mounts Better Auth's own handler under `/v1/auth/*` and adds `GET /v1/me`. */
export function createAuthRoutes(
  auth: Auth,
  db: Database,
  config: Config,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    app.decorateRequest('user', null);
    app.decorateRequest('membership', null);

    // Both fail closed (security.md): if the counters cannot be read, a refusal (503) beats a burst of passwords.
    const perIp = {
      rateLimit: { max: AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', skipOnError: false },
    };
    // Its own counter: the per-IP limiter has already run on this request, `rateLimit()` would stand down.
    const perAccount = app.createRateLimit({
      max: SIGN_IN_PER_ACCOUNT,
      timeWindow: SIGN_IN_ACCOUNT_WINDOW,
      keyGenerator: signInAccountKey,
      skipOnError: false,
    });
    const forward = async (
      request: FastifyRequest,
      reply: FastifyReply,
      options: {
        readonly onUnauthorized: () => DomainError;
        /** Run on success with Better Auth's JSON body, before the reply leaves. */
        readonly onSuccess?: (json: unknown) => Promise<void>;
      },
    ) => {
      const body =
        request.body === undefined || request.body === null ? undefined : JSON.stringify(request.body);
      const response = await auth.handler(
        new Request(new URL(request.url, config.AUTH_BASE_URL), {
          method: request.method,
          headers: authHeaders(request),
          ...(body === undefined ? {} : { body }),
        }),
      );
      if (response.status >= 400) throw refusalOf(response.status, options.onUnauthorized);
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (!['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding'].includes(key)) {
          reply.header(key, value);
        }
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      if (response.body === null) return reply.send(null);
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('json') === true;
      if (isJson && options.onSuccess !== undefined) await options.onSuccess(JSON.parse(text));
      return reply.send(isJson ? withoutToken(text) : text);
    };

    /**
     * A sign-in from a browser that already holds a session of the same account (the password confirmed again before
     * a sensitive action, ADR 0016) closes that session: its cookie is replaced, it would otherwise stay open, unused,
     * until it expires. Another account's session is left to its own sign-out. A cleanup, never a condition of the
     * sign-in: if reading or closing the old session fails, it is logged and the sign-in still answers 200 with its
     * cookie, so that the new session is never left in the base without its cookie.
     */
    const closeReplacedSession = async (request: FastifyRequest) => {
      const previous = await auth.api
        .getSession({ headers: authHeaders(request) })
        .catch((error: unknown) => {
          request.log.warn({ err: error }, 'sign-in: the session being replaced could not be read');
          return null;
        });
      return async (json: unknown) => {
        const signedIn = SignedInSchema.safeParse(json);
        if (previous === null || !signedIn.success || signedIn.data.user.id !== previous.user.id) return;
        try {
          const context = await auth.$context;
          await context.internalAdapter.deleteSession(previous.session.token);
        } catch (error) {
          request.log.warn({ err: error }, 'sign-in: the replaced session could not be closed');
        }
      };
    };

    // Sign-in has both limits: per IP like the rest of `/auth`, and per account (after the body is read).
    app.route({
      method: 'POST',
      url: '/auth/sign-in/email',
      config: perIp,
      preValidation: async (request, reply) => {
        const attempt = await perAccount(request);
        if (attempt.isAllowed || !attempt.isExceeded) return;
        void reply.header('retry-after', attempt.ttlInSeconds);
        throw new SignInLimited();
      },
      // Better Auth's 401s (unknown e-mail, wrong password, a member who left) all become one French refusal.
      handler: async (request, reply) =>
        forward(request, reply, {
          onUnauthorized: () => new SignInRefused(),
          onSuccess: await closeReplacedSession(request),
        }),
    });
    // Only what the dashboard calls: the rest of Better Auth (get-session and list-sessions with their tokens,
    // update-user renaming an account) stays unreachable and answers 404 like any unknown route. Signing out without
    // a session succeeds: there is nothing to close.
    app.post('/auth/sign-out', { config: perIp }, (request, reply) =>
      forward(request, reply, { onUnauthorized: () => new SessionUnauthenticated() }),
    );

    app.get(
      '/me',
      {
        preValidation: requireRole(...UserRoleSchema.options),
        schema: { response: { 200: MeSchema } },
      },
      async (request) => {
        if (request.user === null) throw new SessionUnauthenticated();
        return { ...request.user, ...(request.membership ?? (await membership(db, request.user.id))) };
      },
    );
    return Promise.resolve();
  };
}

export interface NewOwner {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/**
 * Creates an `owner` account (there is no public sign-up): the user, its password account, the role, and the
 * audit line, in that order. Refuses an email that already exists.
 */
export async function createOwner(auth: Auth, db: Database, owner: NewOwner): Promise<{ userId: string }> {
  if (owner.password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'password_invalid',
      `Mot de passe trop court (${String(MIN_PASSWORD_LENGTH)} minimum)`,
    );
  }
  const context = await auth.$context;
  const email = owner.email.toLowerCase();
  if ((await context.internalAdapter.findUserByEmail(email)) !== null) {
    throw new DomainError('user_conflict', 'Un compte existe déjà avec cet email');
  }
  const user = await context.internalAdapter.createUser(
    { email, name: owner.name, emailVerified: true },
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await context.password.hash(owner.password),
  });
  await db.update(schema.user).set({ role: 'owner' }).where(eq(schema.user.id, user.id));
  await db.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: null,
    action: 'user.role_changed',
    entity: 'user',
    entityId: user.id,
    details: { role: 'owner', via: 'owner:create' },
  });
  return { userId: user.id };
}
