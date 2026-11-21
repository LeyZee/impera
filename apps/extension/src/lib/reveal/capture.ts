import { z } from 'zod';

/**
 * The Reveal session the « Sync » sends (reveal-connector-spec.md § 2), read from the requests the open Reveal tab
 * makes to `api.reveal.me`: the bearer from their `Authorization` header, the model from the routes that name her,
 * the « bot » member from the bearer’s own claims (a route’s `/users/:id/…` when it names none). Pure: the service
 * worker hands each request over and sends what comes out, then forgets it. Nothing here is stored nor logged.
 */

export const REVEAL_API_PATTERN = 'https://api.reveal.me/*';

const API_ORIGIN = 'https://api.reveal.me';
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const BEARER = /^Bearer\s+(\S{16,8192})$/iu;

/**
 * What the requests seen so far told; the bearer and the member are filled by the first request that carries them.
 * Every model the tab named is kept, in order (19/11: a tab that reads several creators named first another one than
 * the account's, and the CRM refused the session, 409).
 */
export interface SessionParts {
  readonly bearer: string | null;
  readonly models: readonly string[];
  readonly userId: string | null;
}

export const NO_PARTS: SessionParts = { bearer: null, models: [], userId: null };

/**
 * A bound on what a tab can make the worker hold, far above an agency's roster: the account's model is never left out
 * because others came first (relecture de Bilan sur 750a3ad2).
 */
const MAX_MODELS = 64;

export interface RequestHeader {
  readonly name: string;
  readonly value?: string | undefined;
}

/** The session as the server's `RevealSessionSchema` reads it. */
export interface RevealSession {
  readonly v: 1;
  readonly bearer: string;
  readonly userId: string;
  readonly modelId: string;
  readonly userAgent: string;
  readonly capturedAt: string;
}

function idOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && ID.test(value) ? value : null;
}

/** The model a route names: `?modelId=`, `/models/:id…`, or `/<kind>/model/:id` (scripts, sequences, transactions). */
function modelOf(url: URL): string | null {
  const query = idOf(url.searchParams.get('modelId'));
  if (query !== null) return query;
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments[0] === 'models') return idOf(segments[1]);
  if (segments.length >= 3 && segments[1] === 'model') return idOf(segments[2]);
  return null;
}

/** Words a route puts where an id goes (`/users/me/context`, seen on 19/11): they name no one. */
const NOT_AN_ID = new Set(['me', 'self', 'current']);

/**
 * The member a route names: `/users/:id/…`. A fallback only (sessionOf): the tab also reads other members' profiles,
 * and `/users/me/…` names whoever is signed in without saying who.
 */
function userOf(url: URL): string | null {
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments[0] !== 'users') return null;
  const id = idOf(segments[1]);
  return id === null || NOT_AN_ID.has(id.toLowerCase()) ? null : id;
}

const ClaimsSchema = z.object({ userId: z.string() });

/**
 * The member a JWT bearer names in its own claims (`userId`, reveal-connector-spec.md § 2), the one the server checks
 * the session against; null when the bearer is not a JWT or names no one. Read in memory, never kept nor logged.
 */
export function memberOfBearer(bearer: string): string | null {
  const payload = bearer.split('.')[1];
  if (payload === undefined || payload === '') return null;
  try {
    const base64 = payload.replace(/-/gu, '+').replace(/_/gu, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const claims = ClaimsSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return claims.success ? idOf(claims.data.userId) : null;
  } catch {
    return null;
  }
}

/** Adds what one request tells to what was already seen. A request to any other host tells nothing. */
export function readRequest(
  parts: SessionParts,
  url: string,
  headers: readonly RequestHeader[] | undefined,
): SessionParts {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return parts;
  }
  if (parsed.origin !== API_ORIGIN) return parts;
  const authorization = headers?.find((header) => header.name.toLowerCase() === 'authorization')?.value;
  const bearer = authorization === undefined ? null : (BEARER.exec(authorization.trim())?.[1] ?? null);
  const model = modelOf(parsed);
  const models =
    model === null || parts.models.includes(model) || parts.models.length >= MAX_MODELS
      ? parts.models
      : [...parts.models, model];
  return { bearer: parts.bearer ?? bearer, models, userId: parts.userId ?? userOf(parsed) };
}

/**
 * The model the session speaks for: the account's own when the tab named it (the CRM's `modelId`, or the model of this
 * account's last « Sync »), else the only one the tab named; `several` when it named more and none is the account's,
 * null while it named none.
 */
export type ModelChoice = { readonly state: 'one'; readonly modelId: string } | { readonly state: 'several' };

export function modelFor(models: readonly string[], expected: string | null): ModelChoice | null {
  if (expected !== null && models.includes(expected)) return { state: 'one', modelId: expected };
  const [only, ...others] = models;
  if (only === undefined) return null;
  return others.length === 0 ? { state: 'one', modelId: only } : { state: 'several' };
}

/** A session read, or a tab that named several creators and none is this account's. */
export type Captured =
  { readonly state: 'session'; readonly session: RevealSession } | { readonly state: 'several' };

/**
 * The session once the bearer, a model and the member are known; null before. The member is the one the bearer's
 * claims name, as the server checks it; a route's member only when the bearer names none (19/11: the tab read another
 * member's profile, and `/users/me/…`, before its own routes). The model is chosen by `modelFor`.
 */
export function sessionOf(
  parts: SessionParts,
  expected: string | null,
  userAgent: string,
  now: Date,
): Captured | null {
  if (parts.bearer === null) return null;
  const userId = memberOfBearer(parts.bearer) ?? parts.userId;
  if (userId === null) return null;
  const model = modelFor(parts.models, expected);
  if (model === null) return null;
  if (model.state === 'several') return model;
  return {
    state: 'session',
    session: {
      v: 1,
      bearer: parts.bearer,
      userId,
      modelId: model.modelId,
      userAgent: userAgent.slice(0, 512),
      capturedAt: now.toISOString(),
    },
  };
}
