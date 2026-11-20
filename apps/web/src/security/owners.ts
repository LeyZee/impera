import {
  ApiErrorSchema,
  OWNER_ERROR_CODES,
  OwnersSchema,
  REAUTHENTICATION_ERROR_CODE,
  type OwnerCandidateRefusal,
  type OwnerErrorCode,
  type Owners,
} from '@impera/contracts';

import { SECURITY_ERROR_MESSAGES, SecurityError } from './api';

/**
 * The owners (ADR 0096), in Réglages › Sécurité: who they are, the member who may become the second one, and the
 * removal that waits for its 72 hours. A refusal of the rule itself is said with the server's own sentence; anything
 * else is a `SecurityError`, as for the rest of the screen.
 */

/** A refusal of the rule (two owners already, a removal waiting…): the server's sentence, in French. */
export class OwnerRefusal extends Error {
  readonly code: OwnerErrorCode;

  constructor(code: OwnerErrorCode, message: string) {
    super(message);
    this.name = 'OwnerRefusal';
    this.code = code;
  }
}

const ownerCodeOf = (code: string): OwnerErrorCode | null =>
  OWNER_ERROR_CODES.find((known) => known === code) ?? null;

async function owners(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<Owners> {
  const response = await fetch(`/v1/settings/security/owners${path}`, {
    method,
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }).catch(() => null);
  if (response === null) throw new SecurityError('unavailable');
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = OwnersSchema.safeParse(json);
    if (!parsed.success) throw new SecurityError('unavailable');
    return parsed.data;
  }
  const refusal = ApiErrorSchema.safeParse(json);
  const code = refusal.success ? refusal.data.error.code : null;
  if (code === REAUTHENTICATION_ERROR_CODE) throw new SecurityError('reauth_required');
  const ownerCode = code === null ? null : ownerCodeOf(code);
  if (refusal.success && ownerCode !== null) throw new OwnerRefusal(ownerCode, refusal.data.error.message);
  if (response.status === 401) throw new SecurityError('session_expired');
  if (response.status === 429) throw new SecurityError('too_many_attempts');
  throw new SecurityError('unavailable');
}

export const fetchOwners = (): Promise<Owners> => owners('', 'GET');

/** Makes a member of the team the second owner (a sensitive action). */
export const addOwner = (userId: string): Promise<Owners> => owners('', 'POST', { userId });

/** Asks for the other owner's removal: it takes effect after the notice, unless that owner cancels it. */
export const requestOwnerRemoval = (userId: string): Promise<Owners> =>
  owners(`/${encodeURIComponent(userId)}/removal`, 'POST');

/** The owner a removal is about cancels it. */
export const cancelOwnerRemoval = (): Promise<Owners> => owners('/removal', 'DELETE');

export const ownerMessageOf = (error: unknown): string =>
  error instanceof OwnerRefusal || error instanceof SecurityError
    ? error.message
    : SECURITY_ERROR_MESSAGES.unavailable;

/** Why a member cannot be chosen yet, said beside his name; `full` never shows (the list is empty then). */
export const CANDIDATE_REFUSALS: Readonly<Record<OwnerCandidateRefusal, string>> = {
  full: 'Il y a déjà deux propriétaires',
  not_a_member: 'Pas actif dans l’équipe en ce moment',
  second_factor_missing: 'Doit d’abord se connecter et activer son code à 6 chiffres',
  removal_pending: 'Un retrait attend la fin de son préavis',
};

/** « dimanche 23 novembre à 14 h 05 », in the reader's own zone: when a removal takes effect. */
export function effectiveText(at: string): string {
  const date = new Date(at);
  const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${day} à ${two(date.getHours())}\u00a0h\u00a0${two(date.getMinutes())}`;
}

/** « dans 71 h », « dans 40 min », « d’un instant à l’autre »: what is left of the notice. */
export function remainingText(at: string, now: Date): string {
  const minutes = Math.ceil((new Date(at).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'd’un instant à l’autre';
  if (minutes < 60) return `dans\u00a0${String(minutes)}\u00a0min`;
  return `dans\u00a0${String(Math.floor(minutes / 60))}\u00a0h`;
}
