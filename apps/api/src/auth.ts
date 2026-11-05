import { passkey } from '@better-auth/passkey';
import {
  AuditEntryIdSchema,
  CurrentUserSchema,
  DomainError,
  isBackupCode,
  MeSchema,
  newId,
  PASSKEY_ADD_WINDOW_MINUTES,
  PasskeyConfirmOptionsBodySchema,
  PasskeyGestureBodySchema,
  PasskeySchema,
  REAUTHENTICATION_ERROR_CODE,
  ReauthenticateBodySchema,
  SECOND_FACTOR_ERROR_CODE,
  SecondFactorEnableBodySchema,
  SecondFactorVerifyBodySchema,
  SignInAnswerSchema,
  TeamMembershipSchema,
  UserIdSchema,
  UserRoleSchema,
  type CurrentUser,
  type Me,
  type PasskeyErrorCode,
  type SecondFactorCode,
  type UserRole,
} from '@impera/contracts';
import { and, eq, schema, sql, withMember, type Database } from '@impera/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Config } from './config';
import type { Logger } from './logger';
import {
  alertOwnerPasskeySignIn,
  confirmationOptions,
  confirmGesture,
  credentialIdOf,
  deviceName,
  markPasskeyUsed,
  passkeyOf,
  passkeyOwnerOf,
  recordPasskeyAdded,
  takeBackPasskey,
  requireUserVerification,
} from './passkeys';
import type { PasswordBreachCheck } from './password-breaches';
import { forgetCount } from './rate-limit-store';
import { alertOwnerSignIn, recordRefusal, type RefusalAction } from './security-alerts';

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
/**
 * Attempts per minute and per IP on `/v1/auth/*`, tighter than the API-wide limit, wide enough for a team behind one
 * address at a change of shift: ten sign-ins, password and code, and their pages (recette SEC-11).
 */
const AUTH_RATE_LIMIT_PER_MINUTE = 60;
/**
 * Sign-in limits (ADR 0046 § 5), password and code each with its own counters: 10 tries per quarter of an hour for an
 * account from one address, so that someone else's tries never lock its holder out; 100 for an account from all
 * addresses, against a guess spread over many. A sign-in from a trusted device does not count in the second.
 */
const SIGN_IN_PER_ACCOUNT_ADDRESS = 10;
const SIGN_IN_PER_ACCOUNT = 100;
const SIGN_IN_ACCOUNT_WINDOW = '15 minutes';
const SIGN_IN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
/** The cookies of Better Auth's `two-factor` plugin: the code step of a sign-in, and a trusted device. */
const TWO_FACTOR_COOKIE = 'two_factor';
const TRUST_DEVICE_COOKIE = 'trust_device';
/** However much it is used, a session opened more than 7 days ago is refused at its next request (ADR 0046 § 6). */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * The client IP as Fastify resolved it (`trustProxy`, TRUST_PROXY_HOPS), handed to Better Auth under a header of
 * our own: it never reads `x-forwarded-for`, which any client can write.
 */
const CLIENT_IP_HEADER = 'x-impera-client-ip';
const MIN_PASSWORD_LENGTH = 12;
/** A sensitive action needs the password and the code given on the session less than this ago (ADR 0046 § 3). */
const RECENT_LOGIN_MS = 10 * 60 * 1000;
/**
 * Confirmations per account, whatever the address: a code guessed from a stolen session stays slow. Bounds of its own:
 * two limiters with the same bounds would share their counters (`rate-limit-store.ts` refuses to start).
 */
const REAUTHENTICATE_PER_ACCOUNT = 10;
const REAUTHENTICATE_ACCOUNT_WINDOW = '10 minutes';
/** A device trusted after a right code skips the code at sign-in for 30 days (ADR 0046 § 3). */
const TRUSTED_DEVICE_SECONDS = 30 * 24 * 60 * 60;
/** The code step of a sign-in: 10 minutes, then the sign-in starts over. */
const SIGN_IN_CODE_SECONDS = 10 * 60;
/** The code of our own refusal of a gesture made without user verification (ADR 0053 § 1). */
const USER_NOT_VERIFIED = 'USER_NOT_VERIFIED';
/** Ten wrong codes in a row lock the account's code for 15 minutes (the plugin's own count, across sign-ins). */
const CODE_LOCK = { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 };

export class SessionUnauthenticated extends DomainError {
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

export class ReauthenticationRequired extends DomainError {
  constructor() {
    super(REAUTHENTICATION_ERROR_CODE, 'Mot de passe et code à confirmer pour cette action');
  }
}

/** Every route but the activation's, for an account whose second factor is not active yet (ADR 0046 § 1). */
class SecondFactorRequired extends DomainError {
  constructor() {
    super(SECOND_FACTOR_ERROR_CODE, 'Active d’abord la validation en deux étapes');
  }
}

class SecondFactorAlreadyActive extends DomainError {
  constructor() {
    super('second_factor_conflict', 'La validation en deux étapes est déjà active sur ce compte');
  }
}

class WrongCode extends DomainError {
  constructor() {
    super('second_factor_unauthenticated', 'Code incorrect');
  }
}

class CodeStepExpired extends DomainError {
  constructor() {
    super('second_factor_challenge_unauthenticated', 'La vérification a expiré : reconnecte-toi');
  }
}

class CodeLocked extends DomainError {
  constructor() {
    super('second_factor_limited', 'Trop de codes faux : réessaie dans un quart d’heure');
  }
}

class WrongPassword extends DomainError {
  constructor() {
    super('password_unauthenticated', 'Ce n’est pas le bon mot de passe');
  }
}

/** A wrong password or a wrong code on the confirmation: one answer, it does not tell which. */
export class ReauthenticationRefused extends DomainError {
  constructor() {
    super('reauthentication_unauthenticated', 'Mot de passe ou code incorrect');
  }
}

/** A gesture the server refused (ADR 0053 § 6): unknown key, wrong signature, counter, origin, no user verification. */
class PasskeyRefused extends DomainError {
  constructor() {
    super('passkey_unauthenticated' satisfies PasskeyErrorCode, 'Cette clé d’accès n’a pas été reconnue');
  }
}

class PasskeyChallengeExpired extends DomainError {
  constructor() {
    super('passkey_challenge_unauthenticated' satisfies PasskeyErrorCode, 'Le geste a expiré : recommence');
  }
}

class NoPasskey extends DomainError {
  constructor() {
    super('passkey_not_found' satisfies PasskeyErrorCode, 'Aucune clé d’accès sur ce compte');
  }
}

class PasskeyConflict extends DomainError {
  constructor() {
    super('passkey_conflict' satisfies PasskeyErrorCode, 'Cette clé d’accès est déjà sur un compte');
  }
}

/**
 * The plugin's refusals of a gesture, by its error code (ours for a gesture without user verification). A member who
 * left is refused by the session hook (`UNABLE_TO_CREATE_SESSION`): the same refusal as an unknown key.
 */
const PASSKEY_REFUSED_CODES: ReadonlySet<string> = new Set([
  'PASSKEY_NOT_FOUND',
  'AUTHENTICATION_FAILED',
  'FAILED_TO_VERIFY_REGISTRATION',
  'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY',
  'UNABLE_TO_CREATE_SESSION',
  USER_NOT_VERIFIED,
]);

function passkeyRefusal(code: string | undefined): DomainError | undefined {
  if (code === undefined) return undefined;
  if (code === 'CHALLENGE_NOT_FOUND') return new PasskeyChallengeExpired();
  if (code === 'PREVIOUSLY_REGISTERED') return new PasskeyConflict();
  return PASSKEY_REFUSED_CODES.has(code) ? new PasskeyRefused() : undefined;
}

export class ReauthenticationLimited extends DomainError {
  constructor() {
    super('reauthentication_limited', 'Trop d’essais : réessaie dans quelques minutes');
  }
}

/**
 * Better Auth's refusals on the routes of the second factor, by its own error code: its body is English and of another
 * shape. A code it has no reason to send falls to `refusalOf`.
 */
function secondFactorRefusal(code: string | undefined): DomainError | undefined {
  switch (code) {
    case 'INVALID_CODE':
    case 'INVALID_BACKUP_CODE':
      return new WrongCode();
    case 'INVALID_TWO_FACTOR_COOKIE':
    case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
      return new CodeStepExpired();
    case 'ACCOUNT_TEMPORARILY_LOCKED':
      return new CodeLocked();
    case 'INVALID_PASSWORD':
      return new WrongPassword();
    case 'TOTP_ALREADY_ENABLED':
      return new SecondFactorAlreadyActive();
    case undefined:
    default:
      return undefined;
  }
}

const BetterAuthErrorSchema = z.object({ code: z.string() });

/**
 * Better Auth on the Drizzle tables of `schema/auth.ts` (data-model.md): email and password, no public sign-up
 * (`createOwner` makes the first account), sessions in the database, cookies `HttpOnly` and `SameSite=Lax`,
 * `Secure` in production. The tables are out of RLS and reached with the application role, which is enough.
 */
// Better Auth infers its API type (with our additional fields) from these options; writing it out would lose them.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuth(config: Config, db: Database, logger: Logger) {
  return betterAuth({
    appName: 'Impera',
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
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
      },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    user: {
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        creatorIds: { type: 'string[]', input: false, required: false },
      },
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      additionalFields: {
        reauthenticatedAt: { type: 'date', input: false, required: false },
        codeConfirmedAt: { type: 'date', input: false, required: false },
        confirmedPasskeyId: { type: 'string', input: false, required: false },
      },
    },
    // ADR 0046: an authenticator code for every account. The secret and the backup codes are encrypted with the
    // Better Auth secret; a trusted device is a signed cookie and a `verification` row, revoked with the sessions.
    plugins: [
      twoFactor({
        issuer: 'Impera',
        trustDeviceMaxAge: TRUSTED_DEVICE_SECONDS,
        twoFactorCookieMaxAge: SIGN_IN_CODE_SECONDS,
        backupCodeOptions: { amount: 10, storeBackupCodes: 'encrypted' },
        accountLockout: CODE_LOCK,
      }),
      // ADR 0053: a passkey is worth the password and the code. The plugin asks the browser for user verification
      // only as « preferred » at sign-in and never checks it: both hooks refuse a gesture made without Face ID, a
      // fingerprint or the phone's code. Keys are bound to the dashboard's host; the origin is checked at each gesture.
      // Its routes are reached only through ours (`createAuthRoutes`), which require the session, the recent
      // confirmation and the limits; `requireSession: false` only spares the plugin's own « fresh session » rule
      // (a session opened less than a day ago), which ours replaces.
      passkey({
        rpID: new URL(config.WEB_ORIGIN).hostname,
        rpName: 'Impera',
        origin: config.WEB_ORIGIN,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          requireSession: false,
          resolveUser: () => {
            throw new APIError('UNAUTHORIZED', { message: 'session required' });
          },
          afterVerification: ({ verification }) => {
            if (verification.registrationInfo?.userVerified !== true) {
              throw new APIError('BAD_REQUEST', {
                code: USER_NOT_VERIFIED,
                message: 'user verification required',
              });
            }
            return Promise.resolve(undefined);
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError('UNAUTHORIZED', {
                code: USER_NOT_VERIFIED,
                message: 'user verification required',
              });
            }
            return Promise.resolve();
          },
        },
      }),
    ],
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
            // The password step of an account with an active second factor: this session is dropped at once unless
            // the device is trusted, which the sign-in route alone knows; it writes that login itself.
            if (context?.path === '/sign-in/email' && (await secondFactorActive(db, session.userId))) return;
            await recordLogin(db, logger, session, context?.path);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

interface OpenedSession {
  readonly id: string;
  readonly userId: string;
  readonly ipAddress?: string | null | undefined;
}

/** The `auth.login` line of a session that opened (security.md § 6), whatever the way in. */
async function recordLogin(
  db: Database,
  logger: Logger,
  session: OpenedSession,
  path?: string,
): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: session.userId,
    action: 'auth.login',
    entity: 'session',
    entityId: session.id,
    ip: session.ipAddress ?? null,
  });
  logger.info({ userId: session.userId, path }, 'user signed in');
}

async function secondFactorActive(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: schema.user.twoFactorEnabled })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.enabled === true;
}

/** The request's headers for Better Auth, with the client IP we resolved in place of any the client sent. */
export function authHeaders(request: FastifyRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

const SignInBodySchema = z.looseObject({ email: z.string().min(1) });
/** The passkey the plugin has just stored, read for its id only (the rest never reaches the page). */
const AddedPasskeySchema = z.object({ id: z.string().min(1) });
/** The session token in Better Auth's answer to a code, read to stamp that session and never sent on. */
const SessionTokenSchema = z.object({ token: z.string().min(1) });

/** The account a sign-in targets, for its own limits; a body without an email counts against the IP. */
function signInAccountKey(request: FastifyRequest): string {
  const parsed = SignInBodySchema.safeParse(request.body);
  return parsed.success ? `sign-in:${parsed.data.email.trim().toLowerCase()}` : `ip:${request.ip}`;
}

/** The value of a cookie of the request, or `undefined`. */
function cookieOf(request: FastifyRequest, name: string): string | undefined {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) return decodeURIComponent(pair.slice(at + 1).trim());
  }
  return undefined;
}

/**
 * The session of a request, as Better Auth reads it (12 hours without activity), refused past 7 days from its creation
 * whatever its use (ADR 0046 § 6): the row goes, and the request is answered as without a session.
 */
export async function sessionOf(
  auth: Auth,
  db: Database,
  request: FastifyRequest,
  now: Date = new Date(),
): Promise<Awaited<ReturnType<Auth['api']['getSession']>>> {
  const result = await auth.api.getSession({ headers: authHeaders(request) });
  if (result === null) return null;
  if (now.getTime() - result.session.createdAt.getTime() <= SESSION_MAX_AGE_MS) return result;
  await db.delete(schema.session).where(eq(schema.session.id, result.session.id));
  return null;
}

/**
 * The signed-in user of a request, or `null`; the role and creators come from our columns, validated. A team member
 * whose scope is `self` (a chatter, a manager who is not active) reads a creator only through the conversations
 * routed to him: his creators move to `routedCreatorIds`, so every route that checks `creatorIds` refuses him at once.
 * A member who is not `active` keeps none (ADR 0024: a suspended member reads no fan and no conversation).
 */
async function currentUser(
  auth: Auth,
  db: Database,
  request: FastifyRequest,
): Promise<{ user: CurrentUser; membership: Membership | null; secondFactorEnabled: boolean } | null> {
  const result = await sessionOf(auth, db, request);
  if (result === null) return null;
  const signedIn = await userOf(db, result.user);
  if (signedIn === null) return null;
  return { ...signedIn, secondFactorEnabled: result.user.twoFactorEnabled === true };
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
  // Away (on leave, sick, travelling, suspended), he reads no conversation at all, not even one still routed to him:
  // the job `conversation.release_unavailable` hands those back within the minute (EQ-13, Charles's « oui » of 01/11).
  const routedCreatorIds = member.team.status === 'active' ? user.creatorIds : [];
  return { user: { ...user, creatorIds: [], routedCreatorIds }, membership: member };
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

/**
 * Route guard: no session → 401; an account whose second factor is not active yet → 403 `second_factor_forbidden`,
 * whatever its role (ADR 0046 § 1: the activation is the only way in); a session with another role → 403
 * (security.md §6).
 */
export function createRequireRole(auth: Auth, db: Database): RequireRole {
  return (...roles) =>
    async (request) => {
      const session = await currentUser(auth, db, request);
      if (session === null) throw new SessionUnauthenticated();
      if (!session.secondFactorEnabled) throw new SecondFactorRequired();
      if (!roles.includes(session.user.role)) throw new RoleForbidden();
      request.user = session.user;
      request.membership = session.membership;
    };
}

/**
 * Route guard for sensitive actions, after `requireRole` (ADR 0016, ADR 0046 § 3): the password and the code must have
 * been given on this session less than 10 minutes ago (a sign-in through the code, `POST /v1/auth/reauthenticate`, or a
 * passkey gesture on `POST /v1/auth/passkey/confirm`, ADR 0053 § 4), otherwise 403 `reauthentication_forbidden` and the
 * page asks again. A session's age says nothing: a sign-in from a trusted device or by a passkey asked for none.
 */
export function createRequireRecentLogin(
  auth: Auth,
  db: Database,
  now: () => Date = () => new Date(),
): preValidationAsyncHookHandler {
  return createRequireConfirmedWithin(auth, db, RECENT_LOGIN_MS, 'reauthenticatedAt', now);
}

/**
 * The same guard with its own window and stamp: adding a passkey asks for the password and the code themselves within
 * the last 5 minutes, a gesture on another key never counts (ADR 0053 § 2).
 */
function createRequireConfirmedWithin(
  auth: Auth,
  db: Database,
  withinMs: number,
  stamp: 'reauthenticatedAt' | 'codeConfirmedAt',
  now: () => Date = () => new Date(),
): preValidationAsyncHookHandler {
  return async (request) => {
    const result = await sessionOf(auth, db, request, now());
    if (result === null) throw new SessionUnauthenticated();
    const confirmedAt = result.session[stamp];
    if (confirmedAt === null || confirmedAt === undefined) throw new ReauthenticationRequired();
    if (now().getTime() - confirmedAt.getTime() > withinMs) throw new ReauthenticationRequired();
  };
}

/** Whether the password is the account's, checked against its credential the way Better Auth's sign-in does. */
async function passwordMatches(auth: Auth, userId: string, password: string): Promise<boolean> {
  const context = await auth.$context;
  const accounts = await context.internalAdapter.findAccounts(userId);
  const hash = accounts.find((account) => account.providerId === 'credential')?.password;
  if (hash === null || hash === undefined) return false;
  return context.password.verify({ hash, password });
}

/**
 * Whether the code is the account's, on the signed-in session: the authenticator's, or a backup code, which is then
 * used up. Better Auth's refusals are a wrong code; anything else (the database, the secret) is an error.
 */
async function codeMatches(auth: Auth, request: FastifyRequest, code: SecondFactorCode): Promise<boolean> {
  const headers = authHeaders(request);
  try {
    if (isBackupCode(code))
      await auth.api.verifyBackupCode({ headers, body: { code, disableSession: true } });
    else await auth.api.verifyTOTP({ headers, body: { code } });
    return true;
  } catch (error) {
    if (isAPIError(error)) return false;
    throw error;
  }
}

/**
 * The password, then a code, of the signed-in account (ADR 0046 § 3): the password first, so a wrong one never uses up a
 * backup code. False when either is wrong.
 */
export async function identityConfirmed(
  auth: Auth,
  request: FastifyRequest,
  userId: string,
  password: string,
  code: SecondFactorCode,
): Promise<boolean> {
  return (await passwordMatches(auth, userId, password)) && (await codeMatches(auth, request, code));
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
  adminDb: Database,
  config: Config,
  requireRole: RequireRole,
  logger: Logger,
): FastifyPluginAsyncZod {
  return (app) => {
    app.decorateRequest('user', null);
    app.decorateRequest('membership', null);

    // Both fail closed (security.md): if the counters cannot be read, a refusal (503) beats a burst of passwords.
    const perIp = {
      rateLimit: { max: AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', skipOnError: false },
    };
    // Their own counters: the per-IP limiter has already run on this request, `rateLimit()` would stand down. Each
    // request names the account it counts against (`limitKeys`): the e-mail of a sign-in, the account of a code step.
    const limitKeys = new WeakMap<FastifyRequest, string>();
    const accountKeyOf = (request: FastifyRequest) => limitKeys.get(request) ?? `ip:${request.ip}`;
    const perAccountAddress = app.createRateLimit({
      max: SIGN_IN_PER_ACCOUNT_ADDRESS,
      timeWindow: SIGN_IN_ACCOUNT_WINDOW,
      keyGenerator: (request) => `${accountKeyOf(request)}@${request.ip}`,
      skipOnError: false,
    });
    const perAccount = app.createRateLimit({
      max: SIGN_IN_PER_ACCOUNT,
      timeWindow: SIGN_IN_ACCOUNT_WINDOW,
      keyGenerator: accountKeyOf,
      skipOnError: false,
    });
    /**
     * A sign-in step that succeeded gives its tries back, on both limits (recette SEC-11): only refusals bring an account
     * near its lock, and ten good sign-ins in a quarter of an hour (phone, computer, extension) never reach it. A failure
     * to forget is only logged: the count then stays as it was.
     */
    const forgive = async (request: FastifyRequest) => {
      const key = accountKeyOf(request);
      try {
        await forgetCount(
          db,
          { max: SIGN_IN_PER_ACCOUNT_ADDRESS, timeWindowMs: SIGN_IN_ACCOUNT_WINDOW_MS },
          `${key}@${request.ip}`,
        );
        await forgetCount(db, { max: SIGN_IN_PER_ACCOUNT, timeWindowMs: SIGN_IN_ACCOUNT_WINDOW_MS }, key);
      } catch (error) {
        logger.warn({ err: error }, 'sign-in tries not forgotten');
      }
    };
    /** Counts one try against both limits, the account's own unless `trusted`; whether one is spent. */
    const exceeded = async (request: FastifyRequest, reply: FastifyReply, key: string, trusted: boolean) => {
      limitKeys.set(request, key);
      for (const limit of trusted ? [perAccountAddress] : [perAccountAddress, perAccount]) {
        const attempt = await limit(request);
        if (!attempt.isAllowed && attempt.isExceeded) {
          void reply.header('retry-after', attempt.ttlInSeconds);
          return true;
        }
      }
      return false;
    };

    /**
     * Whether the browser holds a trusted device of the account this e-mail names (ADR 0046 § 5): its cookie names a
     * `trust-device-…` row of that account, unexpired. Only spares the limit for all addresses; Better Auth still
     * checks the cookie's signature before it skips the code.
     */
    const trustedDeviceOf = async (request: FastifyRequest): Promise<boolean> => {
      const asked = SignInBodySchema.safeParse(request.body);
      if (!asked.success) return false;
      const context = await auth.$context;
      const cookie = cookieOf(request, context.createAuthCookie(TRUST_DEVICE_COOKIE).name);
      // `<token>!<identifier>.<signature>`: the identifier is the row's, random, never shown but in this cookie.
      const identifier = cookie?.split('!')[1]?.split('.')[0];
      if (identifier?.startsWith('trust-device-') !== true) return false;
      const [row] = await db
        .select({ id: schema.verification.id })
        .from(schema.verification)
        .innerJoin(schema.user, eq(schema.user.id, schema.verification.value))
        .where(
          and(
            eq(schema.verification.identifier, identifier),
            sql`lower(${schema.user.email}) = ${asked.data.email.trim().toLowerCase()}`,
            sql`${schema.verification.expiresAt} > now()`,
          ),
        )
        .limit(1);
      return row !== undefined;
    };

    /**
     * The account of a code step: the signed-in one (activation), or the one the sign-in's `two_factor` cookie names;
     * null when neither is known.
     */
    const codeAccountOf = async (
      request: FastifyRequest,
      signedIn: string | null,
    ): Promise<string | null> => {
      if (signedIn !== null) return signedIn;
      const context = await auth.$context;
      // `<identifier>.<signature>`: the row the plugin wrote for this sign-in, worth nothing once used or expired.
      const identifier = cookieOf(request, context.createAuthCookie(TWO_FACTOR_COOKIE).name)?.split('.')[0];
      if (identifier === undefined || identifier === '') return null;
      const [row] = await db
        .select({ userId: schema.verification.value })
        .from(schema.verification)
        .where(eq(schema.verification.identifier, identifier))
        .limit(1);
      return row?.userId ?? null;
    };
    const codeAccountKey = (request: FastifyRequest, account: string | null): string =>
      account === null ? `ip:${request.ip}` : `code:${account}`;

    /**
     * A refusal counted for the security alerts (ADR 0046 § 8): never a condition of the answer, which stays the
     * refusal it was if the line cannot be written.
     */
    const refused = async (request: FastifyRequest, userId: string | null, action: RefusalAction) => {
      if (userId === null) return;
      try {
        await recordRefusal(adminDb, { userId, action, ip: request.ip });
      } catch (error) {
        request.log.warn({ err: error }, 'auth: a refusal could not be recorded');
      }
    };
    /** The same for a sign-in the owner just made: a lost alert never fails the sign-in. */
    const told = async (request: FastifyRequest, userId: string) => {
      try {
        await alertOwnerSignIn(adminDb, userId, request.ip);
      } catch (error) {
        request.log.warn({ err: error }, 'auth: a sign-in alert could not be written');
      }
    };
    /**
     * A sign-in by a passkey: its last use is written, and the owner hears of a key never used before (ADR 0053 § 7).
     * Never a condition of the sign-in, which has already opened.
     */
    const usedForSignIn = async (request: FastifyRequest, credentialId: string) => {
      try {
        const first = await markPasskeyUsed(adminDb, credentialId);
        if (first !== null) await alertOwnerPasskeySignIn(adminDb, first, request.ip);
      } catch (error) {
        request.log.warn({ err: error }, 'auth: a passkey sign-in could not be recorded');
      }
    };
    const forward = async (
      request: FastifyRequest,
      reply: FastifyReply,
      options: {
        readonly onUnauthorized: () => DomainError;
        /** Names a refusal by Better Auth's own error code first (the routes of the second factor). */
        readonly refusal?: (code: string | undefined) => DomainError | undefined;
        /** Run on success with Better Auth's JSON body, before the reply leaves. */
        readonly onSuccess?: (json: unknown) => Promise<void>;
        /** Run on a refusal with its status and Better Auth's error code, before it is thrown. */
        readonly onRefused?: (status: number, code: string | undefined) => Promise<void>;
        /** The body Better Auth receives in place of the request's (ours, completed by the server). */
        readonly body?: unknown;
        /** What the page receives in place of Better Auth's JSON body, after `onSuccess`. */
        readonly answer?: (json: unknown) => Promise<unknown>;
      },
    ) => {
      const sent = options.body ?? request.body;
      const body = sent === undefined || sent === null ? undefined : JSON.stringify(sent);
      const response = await auth.handler(
        new Request(new URL(request.url, config.AUTH_BASE_URL), {
          method: request.method,
          headers: authHeaders(request),
          ...(body === undefined ? {} : { body }),
        }),
      );
      if (response.status >= 400) {
        const answer = BetterAuthErrorSchema.safeParse(await response.json().catch(() => null));
        const code = answer.success ? answer.data.code : undefined;
        await options.onRefused?.(response.status, code);
        throw options.refusal?.(code) ?? refusalOf(response.status, options.onUnauthorized);
      }
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
      if (isJson && options.answer !== undefined) return reply.send(await options.answer(JSON.parse(text)));
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
      const asked = SignInBodySchema.safeParse(request.body);
      return async (json: unknown) => {
        if (previous === null) return;
        const signedIn = SignInAnswerSchema.safeParse(json);
        if (!signedIn.success) return;
        // A sign-in waiting for its code has already dropped the old cookie; the same account's session goes too.
        const sameAccount =
          'user' in signedIn.data
            ? signedIn.data.user.id === previous.user.id
            : asked.success && asked.data.email.trim().toLowerCase() === previous.user.email.toLowerCase();
        if (!sameAccount) return;
        try {
          const context = await auth.$context;
          await context.internalAdapter.deleteSession(previous.session.token);
        } catch (error) {
          request.log.warn({ err: error }, 'sign-in: the replaced session could not be closed');
        }
      };
    };

    // Sign-in has three limits: per IP like the rest of `/auth`, then per account from this address and per account
    // from all addresses (after the body is read).
    app.route({
      method: 'POST',
      url: '/auth/sign-in/email',
      config: perIp,
      preValidation: async (request, reply) => {
        if (await exceeded(request, reply, signInAccountKey(request), await trustedDeviceOf(request))) {
          throw new SignInLimited();
        }
      },
      // Better Auth's 401s (unknown e-mail, wrong password, a member who left) all become one French refusal.
      handler: async (request, reply) => {
        const closeReplaced = await closeReplacedSession(request);
        return forward(request, reply, {
          onUnauthorized: () => new SignInRefused(),
          onSuccess: async (json) => {
            await forgive(request);
            await closeReplaced(json);
            await recordPasswordLogin(request, json);
          },
          // A wrong password for an account that exists; an unknown e-mail is nobody's to warn.
          onRefused: async (status) => {
            if (status === 401) await refused(request, await accountOfEmail(request), 'auth.sign_in_refused');
          },
        });
      },
    });
    // Sign-in with a passkey (ADR 0053 § 1): one gesture opens the session, no password, no code. The options carry
    // no account (the key says whose it is), and ask for user verification, which the plugin's hook then requires.
    app.get('/auth/passkey/generate-authenticate-options', { config: perIp }, (request, reply) =>
      forward(request, reply, {
        onUnauthorized: () => new SessionUnauthenticated(),
        answer: (json) => Promise.resolve(requireUserVerification(json)),
      }),
    );
    // Same limits as a password (ADR 0053 § 6): per address, then per account once the key names one; only refusals
    // the server checked count toward the alert, a cancelled Face ID never reaches it.
    app.route({
      method: 'POST',
      url: '/auth/passkey/verify-authentication',
      config: perIp,
      schema: { body: PasskeyGestureBodySchema },
      preValidation: async (request, reply) => {
        const account = await passkeyOwnerOf(db, credentialIdOf(request.body));
        if (
          await exceeded(request, reply, account === null ? `ip:${request.ip}` : `passkey:${account}`, false)
        ) {
          throw new SignInLimited();
        }
      },
      handler: async (request, reply) => {
        const credentialId = request.body.response.id;
        const closeReplaced = await closeReplacedSession(request);
        return forward(request, reply, {
          onUnauthorized: () => new PasskeyRefused(),
          refusal: passkeyRefusal,
          onRefused: async (_status, code) => {
            if (code === 'AUTHENTICATION_FAILED' || code === USER_NOT_VERIFIED) {
              await refused(request, await passkeyOwnerOf(db, credentialId), 'auth.passkey_refused');
            }
          },
          onSuccess: async (json) => {
            await forgive(request);
            await closeReplaced(json);
            await usedForSignIn(request, credentialId);
          },
        });
      },
    });

    // Only what the dashboard calls: the rest of Better Auth (get-session and list-sessions with their tokens,
    // update-user renaming an account) stays unreachable and answers 404 like any unknown route. Signing out without
    // a session succeeds: there is nothing to close.
    app.post('/auth/sign-out', { config: perIp }, (request, reply) =>
      forward(request, reply, { onUnauthorized: () => new SessionUnauthenticated() }),
    );

    /**
     * Stamps the session a code has just opened (ADR 0046 § 3): the password and the code were both given, so a
     * sensitive action needs no confirmation for 10 minutes. Better Auth's answer carries the new session's token,
     * which never reaches the page (`withoutToken`).
     */
    const stampSignIn = (request: FastifyRequest) => async (json: unknown) => {
      await forgive(request);
      const opened = SessionTokenSchema.safeParse(json);
      if (!opened.success) return;
      const [session] = await db
        .update(schema.session)
        .set({ reauthenticatedAt: sql`now()`, codeConfirmedAt: sql`now()`, confirmedPasskeyId: null })
        .where(eq(schema.session.token, opened.data.token))
        .returning({ userId: schema.session.userId });
      // A code was asked: no trusted device spared it, which the owner hears of (ADR 0046 § 8).
      if (session !== undefined) await told(request, session.userId);
    };

    /** The account a sign-in's e-mail names, null if none. */
    const accountOfEmail = async (request: FastifyRequest): Promise<string | null> => {
      const asked = SignInBodySchema.safeParse(request.body);
      if (!asked.success) return null;
      const [row] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.email}) = ${asked.data.email.trim().toLowerCase()}`)
        .limit(1);
      return row?.id ?? null;
    };

    /**
     * A session the password opened. With an active second factor, its device was trusted, so no code was asked (ADR
     * 0046 § 3): the database hook leaves this login to here, the only place that sees it kept. Without one (not set
     * up yet), nothing spared the device: the owner hears of it (§ 8).
     */
    const recordPasswordLogin = async (request: FastifyRequest, json: unknown) => {
      const opened = SessionTokenSchema.safeParse(json);
      if (!opened.success) return;
      const [session] = await db
        .select({
          id: schema.session.id,
          userId: schema.session.userId,
          ipAddress: schema.session.ipAddress,
          secondFactor: schema.user.twoFactorEnabled,
        })
        .from(schema.session)
        .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
        .where(eq(schema.session.token, opened.data.token));
      if (session === undefined) return;
      if (session.secondFactor) await recordLogin(db, logger, session, '/sign-in/email');
      else await told(request, session.userId);
    };

    const audit = (request: FastifyRequest, userId: string, action: string) =>
      db.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId,
        action,
        entity: 'user',
        entityId: userId,
        ip: request.ip,
      });

    // The activation (ADR 0046 § 1), for a signed-in account whose second factor is not active yet: the password once
    // more, then a secret and ten backup codes, shown once. Asking again before the first code restarts it.
    app.post(
      '/auth/two-factor/enable',
      {
        config: perIp,
        // Signed in before the body is read: an anonymous call gets 401, never the list of fields (recette SEC-17).
        preValidation: async (request) => {
          if ((await currentUser(auth, db, request)) === null) throw new SessionUnauthenticated();
        },
        schema: { body: SecondFactorEnableBodySchema },
      },
      async (request, reply) => {
        const session = await currentUser(auth, db, request);
        if (session === null) throw new SessionUnauthenticated();
        if (session.secondFactorEnabled) throw new SecondFactorAlreadyActive();
        return forward(request, reply, {
          onUnauthorized: () => new SessionUnauthenticated(),
          refusal: secondFactorRefusal,
        });
      },
    );

    // The code: at sign-in (no session yet, the `two_factor` cookie of the sign-in), or to finish the activation (the
    // session of an account not yet active). Never on an active account's session: that would answer whether a code is
    // right without the password and without Better Auth's lock, which only counts at sign-in.
    app.post(
      '/auth/two-factor/verify-totp',
      { config: perIp, schema: { body: SecondFactorVerifyBodySchema } },
      async (request, reply) => {
        const session = await currentUser(auth, db, request);
        if (session?.secondFactorEnabled === true) throw new SecondFactorAlreadyActive();
        const account = await codeAccountOf(request, session?.user.id ?? null);
        if (await exceeded(request, reply, codeAccountKey(request, account), false)) {
          throw new CodeLocked();
        }
        const startedAt = new Date();
        return forward(request, reply, {
          onUnauthorized: () => new CodeStepExpired(),
          refusal: secondFactorRefusal,
          onRefused: async (_status, code) => {
            if (code === 'INVALID_CODE') await refused(request, account, 'auth.code_refused');
          },
          onSuccess:
            session === null
              ? stampSignIn(request)
              : async () => {
                  // The password and a first code were both just given: the session the plugin opens in place of
                  // this one counts as confirmed, so a sensitive action right after does not ask again. Its answer
                  // names the session it replaced, so the new one is found as the account's session opened since.
                  await db
                    .update(schema.session)
                    .set({
                      reauthenticatedAt: sql`now()`,
                      codeConfirmedAt: sql`now()`,
                      confirmedPasskeyId: null,
                    })
                    .where(
                      and(
                        eq(schema.session.userId, session.user.id),
                        sql`${schema.session.createdAt} >= ${startedAt}`,
                      ),
                    );
                  await audit(request, session.user.id, 'auth.second_factor_enabled');
                },
        });
      },
    );

    // A backup code, at sign-in only: it is used up.
    app.post(
      '/auth/two-factor/verify-backup-code',
      { config: perIp, schema: { body: SecondFactorVerifyBodySchema } },
      async (request, reply) => {
        if ((await currentUser(auth, db, request)) !== null) throw new SecondFactorAlreadyActive();
        const account = await codeAccountOf(request, null);
        if (await exceeded(request, reply, codeAccountKey(request, account), false)) throw new CodeLocked();
        return forward(request, reply, {
          onUnauthorized: () => new CodeStepExpired(),
          refusal: secondFactorRefusal,
          onRefused: async (_status, code) => {
            if (code === 'INVALID_BACKUP_CODE') await refused(request, account, 'auth.code_refused');
          },
          onSuccess: stampSignIn(request),
        });
      },
    );

    // The confirmation before a sensitive action (ADR 0046 § 3): the password, then a code, on this session. The
    // password is checked first, so a wrong one never uses up a backup code. Its own limit per account.
    const perAccountConfirmation = app.createRateLimit({
      max: REAUTHENTICATE_PER_ACCOUNT,
      timeWindow: REAUTHENTICATE_ACCOUNT_WINDOW,
      keyGenerator: (request) => `reauthenticate:${request.user?.id ?? request.ip}`,
      skipOnError: false,
    });
    app.post(
      '/auth/reauthenticate',
      {
        config: perIp,
        preValidation: [
          requireRole(...UserRoleSchema.options),
          async (request, reply) => {
            const attempt = await perAccountConfirmation(request);
            if (attempt.isAllowed || !attempt.isExceeded) return;
            void reply.header('retry-after', attempt.ttlInSeconds);
            throw new ReauthenticationLimited();
          },
        ],
        schema: { body: ReauthenticateBodySchema },
      },
      async (request, reply) => {
        if (request.user === null) throw new SessionUnauthenticated();
        const { password, code } = request.body;
        if (!(await identityConfirmed(auth, request, request.user.id, password, code))) {
          await refused(request, request.user.id, 'auth.reauthentication_refused');
          throw new ReauthenticationRefused();
        }
        const result = await sessionOf(auth, db, request);
        if (result === null) throw new SessionUnauthenticated();
        await db
          .update(schema.session)
          .set({ reauthenticatedAt: sql`now()`, codeConfirmedAt: sql`now()`, confirmedPasskeyId: null })
          .where(eq(schema.session.id, result.session.id));
        await audit(request, request.user.id, 'auth.reauthenticated');
        return reply.code(204).send();
      },
    );

    // A sensitive action confirmed by a gesture (ADR 0053 § 4): a fresh challenge for this session, a key of this
    // account, user verification; it stamps the session like the password and the code. The same limit per account.
    const relying = { rpID: new URL(config.WEB_ORIGIN).hostname, origin: config.WEB_ORIGIN };
    const anyRole = requireRole(...UserRoleSchema.options);
    const signedInSession = async (request: FastifyRequest) => {
      if (request.user === null) throw new SessionUnauthenticated();
      const current = await sessionOf(auth, db, request);
      if (current === null) throw new SessionUnauthenticated();
      return { userId: request.user.id, sessionId: current.session.id };
    };
    // `excluding` names the key being removed: a gesture on another key, or the password and the code (ADR 0053 § 5).
    app.post(
      '/auth/passkey/confirm-options',
      { config: perIp, preValidation: anyRole, schema: { body: PasskeyConfirmOptionsBodySchema } },
      async (request) => {
        const options = await confirmationOptions(db, relying, {
          ...(await signedInSession(request)),
          excluding: request.body?.excluding ?? null,
        });
        if (options === null) throw new NoPasskey();
        return options;
      },
    );
    app.post(
      '/auth/passkey/confirm',
      {
        config: perIp,
        preValidation: [
          anyRole,
          async (request, reply) => {
            const attempt = await perAccountConfirmation(request);
            if (attempt.isAllowed || !attempt.isExceeded) return;
            void reply.header('retry-after', attempt.ttlInSeconds);
            throw new ReauthenticationLimited();
          },
        ],
        schema: { body: PasskeyGestureBodySchema },
      },
      async (request, reply) => {
        const target = await signedInSession(request);
        const checked = await confirmGesture(db, relying, { ...target, response: request.body.response });
        if (checked.outcome !== 'confirmed') {
          if (checked.outcome === 'expired') throw new PasskeyChallengeExpired();
          await refused(request, target.userId, 'auth.reauthentication_refused');
          throw new PasskeyRefused();
        }
        await db
          .update(schema.session)
          .set({ reauthenticatedAt: sql`now()`, confirmedPasskeyId: checked.passkeyId })
          .where(eq(schema.session.id, target.sessionId));
        await db.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: target.userId,
          action: 'auth.reauthenticated',
          entity: 'user',
          entityId: target.userId,
          details: { via: 'passkey' },
          ip: request.ip,
        });
        return reply.code(204).send();
      },
    );

    // Adding a passkey (ADR 0053 § 2): only on a session whose password and code were confirmed within 5 minutes,
    // never by a trusted device, and always to the session's own account (the plugin reads it from the session). The
    // key is named by the device it was added from, read here, never by the page.
    const addingWindow = createRequireConfirmedWithin(
      auth,
      db,
      PASSKEY_ADD_WINDOW_MINUTES * 60_000,
      'codeConfirmedAt',
    );
    app.get(
      '/auth/passkey/generate-register-options',
      { config: perIp, preValidation: [anyRole, addingWindow] },
      (request, reply) => forward(request, reply, { onUnauthorized: () => new SessionUnauthenticated() }),
    );
    app.post(
      '/auth/passkey/verify-registration',
      { config: perIp, preValidation: [anyRole, addingWindow], schema: { body: PasskeyGestureBodySchema } },
      async (request, reply) => {
        const { userId } = await signedInSession(request);
        let added: string | null = null;
        return forward(request, reply, {
          body: { response: request.body.response, name: deviceName(request.headers['user-agent']) },
          onUnauthorized: () => new SessionUnauthenticated(),
          refusal: passkeyRefusal,
          onSuccess: async (json) => {
            const passkeyId = AddedPasskeySchema.parse(json).id;
            try {
              await recordPasskeyAdded(adminDb, { userId, passkeyId, ip: request.ip });
            } catch (failure) {
              // No audit line, no alert: no key either (the page answers 500 and may try again).
              await takeBackPasskey(db, passkeyId);
              throw failure;
            }
            added = passkeyId;
          },
          answer: async () => {
            const view = added === null ? null : await passkeyOf(db, userId, added);
            return PasskeySchema.parse(view);
          },
        });
      },
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
 * audit line, in that order. Refuses an email that already exists, and a password known from a data breach when a
 * check is given (`pnpm owner:create` always gives the app's). The account activates its second factor at its first
 * sign-in (ADR 0046).
 */
export async function createOwner(
  auth: Auth,
  db: Database,
  owner: NewOwner,
  passwordBreaches?: PasswordBreachCheck,
): Promise<{ userId: string }> {
  if (owner.password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'password_invalid',
      `Mot de passe trop court (${String(MIN_PASSWORD_LENGTH)} minimum)`,
    );
  }
  if (passwordBreaches !== undefined && (await passwordBreaches(owner.password))) {
    throw new DomainError(
      'password_invalid',
      'Ce mot de passe circule dans des fuites de données connues, choisis-en un autre',
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
