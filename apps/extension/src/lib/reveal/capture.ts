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

/** What the requests seen so far told; each field is filled by the first request that carries it. */
export interface SessionParts {
  readonly bearer: string | null;
  readonly modelId: string | null;
  readonly userId: string | null;
}

export const NO_PARTS: SessionParts = { bearer: null, modelId: null, userId: null };

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
  return {
    bearer: parts.bearer ?? bearer,
    modelId: parts.modelId ?? modelOf(parsed),
    userId: parts.userId ?? userOf(parsed),
  };
}

/**
 * The session once the bearer, the model and the member are known; null before. The member is the one the bearer's
 * claims name, as the server checks it; a route's member only when the bearer names none (19/11: the tab read another
 * member's profile, and `/users/me/…`, before its own routes).
 */
export function sessionOf(parts: SessionParts, userAgent: string, now: Date): RevealSession | null {
  if (parts.bearer === null || parts.modelId === null) return null;
  const userId = memberOfBearer(parts.bearer) ?? parts.userId;
  if (userId === null) return null;
  return {
    v: 1,
    bearer: parts.bearer,
    userId,
    modelId: parts.modelId,
    userAgent: userAgent.slice(0, 512),
    capturedAt: now.toISOString(),
  };
}
