import {
  ApiErrorSchema,
  ArchivedCreatorListSchema,
  ArchivedCreatorSchema,
  CreatorAccountSchema,
  CreatorListSchema,
  CreatorSummarySchema,
  MyPersonaSchema,
  PersonaOverviewSchema,
  REAUTHENTICATION_ERROR_CODE,
  InvitationLinkCreatedSchema,
  CreatorPlannedSchema,
  type ArchivedCreator,
  type CreateCreatorInvitationLinkBody,
  type CreatorAccount,
  type CreatorErrorCode,
  type CreatorId,
  type CreatorPersonaSheet,
  type CreatorPlanned,
  type CreatorSummary,
  type InvitationLinkErrorCode,
} from '@impera/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import type { LinkOutcome } from '@/screens/team/ShareLink';

/** `GET /v1/creators`: the creators the signed-in user may open, parsed with the contract. */
export async function fetchCreators(): Promise<CreatorSummary[]> {
  const response = await fetch('/v1/creators', { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/creators: ${String(response.status)}`);
  return CreatorListSchema.parse(await response.json()).creators;
}

/**
 * How the creators are read, by every reader of `['creators']` (the screens and the bar's pill): one retry, not
 * three, so that « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton (CREA-30). A
 * reader with other options would set them for all, the first one rendered winning.
 */
export const creatorsQuery = queryOptions({
  queryKey: ['creators'],
  queryFn: fetchCreators,
  retry: 1,
  retryDelay: 400,
});

/** The creators, read once and shared by every screen that lists them (Créatrices, Suivi). */
export function useCreators(): UseQueryResult<CreatorSummary[]> {
  return useQuery(creatorsQuery);
}

/** `GET /v1/creators/:id/persona/mine`: her sheet in force as she reads it, `null` while the agency has none active. */
async function fetchMyPersona(creatorId: CreatorId): Promise<CreatorPersonaSheet | null> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona/mine`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`GET persona/mine: ${String(response.status)}`);
  return MyPersonaSchema.parse(await response.json()).sheet;
}

/** The key of her own sheet, for what will change it (« Proposer une correction », CREA-01 b). */
export const myPersonaKey = (creatorId: CreatorId): readonly unknown[] => ['my-persona', creatorId];

/** Her own sheet (Moi › Persona, recette CREA-01). */
export function useMyPersona(creatorId: CreatorId): UseQueryResult<CreatorPersonaSheet | null> {
  return useQuery({ queryKey: myPersonaKey(creatorId), queryFn: () => fetchMyPersona(creatorId), retry: 1 });
}

export type CreateResult =
  | { readonly kind: 'created'; readonly creator: CreatorSummary }
  /** 400 on her zone: the browser offered it, the server does not know it. */
  | { readonly kind: 'unknown_zone' }
  /** Any other 400: what was typed is not taken as it is. */
  | { readonly kind: 'invalid' }
  /** 409 `creator_conflict`: this form's id already made a creator under another name. */
  | { readonly kind: 'conflict' }
  /** 409 `creator_name_conflict`: another creator has this name, case, accents and spaces aside. */
  | { readonly kind: 'name_taken' }
  /** 401: the session ended, signing in again is the way out. */
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/** `details` of a 400 `request_invalid`, as the API's error handler writes it. */
const RefusedFieldsSchema = z.object({ fields: z.array(z.object({ path: z.string() })) });

/**
 * `POST /v1/creators` (owner only): a new creator, her persona still to write. `id` is chosen once per form: sent twice
 * (double click, retry), the server answers the creator it already made.
 */
export async function createCreator(
  id: CreatorId,
  displayName: string,
  timezone: string,
): Promise<CreateResult> {
  const response = await fetch('/v1/creators', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, displayName, timezone }),
  });
  if (response.status === 201) {
    return { kind: 'created', creator: CreatorSummarySchema.parse(await response.json()) };
  }
  if (response.status === 401) return { kind: 'expired' };
  if (response.status !== 400 && response.status !== 409) return { kind: 'failed' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (response.status === 409) {
    return error.data?.error.code === ('creator_name_conflict' satisfies CreatorErrorCode)
      ? { kind: 'name_taken' }
      : { kind: 'conflict' };
  }
  // `request_invalid` names each refused field by its path (`/timezone`).
  const fields = RefusedFieldsSchema.safeParse(error.data?.error.details);
  const onZone = fields.success && fields.data.fields.some((field) => field.path === '/timezone');
  return onZone ? { kind: 'unknown_zone' } : { kind: 'invalid' };
}

export type MoveResult =
  | { readonly kind: 'moved'; readonly creator: CreatorSummary }
  /** 400: the server does not know this zone. */
  | { readonly kind: 'unknown_zone' }
  /** 403 `reauthentication_forbidden`: the sign-in is over 10 minutes old, the password is asked again. */
  | { readonly kind: 'reauth' }
  /** Any other 403: only the owner moves a creator. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * `PATCH /v1/creators/:creatorId` (owner only, a recent sign-in): her zone, nothing else. Answers her as stored, the
 * zone spelled as the runtime spells it. Nothing behind her is computed again.
 */
export async function moveCreator(creatorId: string, timezone: string): Promise<MoveResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone }),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const creator = CreatorSummarySchema.safeParse(await response.json().catch(() => null));
    return creator.success ? { kind: 'moved', creator: creator.data } : { kind: 'failed' };
  }
  if (response.status === 400) return { kind: 'unknown_zone' };
  if (response.status === 401) return { kind: 'expired' };
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 403) {
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    return error.data?.error.code === REAUTHENTICATION_ERROR_CODE
      ? { kind: 'reauth' }
      : { kind: 'forbidden' };
  }
  return { kind: 'failed' };
}

export type RenameResult =
  | { readonly kind: 'renamed'; readonly creator: CreatorSummary }
  /** 400: the name is not taken as it is (no letter). */
  | { readonly kind: 'invalid' }
  /** 409 `creator_name_conflict`: another creator has this name, case, accents and spaces aside. */
  | { readonly kind: 'name_taken' }
  /** 403 `reauthentication_forbidden`: the sign-in is over 10 minutes old, the password is asked again. */
  | { readonly kind: 'reauth' }
  /** Any other 403: only the owner renames a creator. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * `PATCH /v1/creators/:creatorId` with her name (owner only, a recent sign-in, ADR 0071 § 1): only her name changes,
 * never her platform handles nor her persona. Answers her as stored.
 */
export async function renameCreator(creatorId: string, displayName: string): Promise<RenameResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const creator = CreatorSummarySchema.safeParse(await response.json().catch(() => null));
    return creator.success ? { kind: 'renamed', creator: creator.data } : { kind: 'failed' };
  }
  if (response.status === 400) return { kind: 'invalid' };
  if (response.status === 401) return { kind: 'expired' };
  if (response.status === 404) return { kind: 'not_found' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = error.data?.error.code;
  if (response.status === 409 && code === ('creator_name_conflict' satisfies CreatorErrorCode)) {
    return { kind: 'name_taken' };
  }
  if (response.status === 403) {
    return code === REAUTHENTICATION_ERROR_CODE ? { kind: 'reauth' } : { kind: 'forbidden' };
  }
  return { kind: 'failed' };
}

/** `GET /v1/creators/archived` (owner only, ADR 0071 § 2): the archived creators, the most recent first. */
async function fetchArchivedCreators(): Promise<ArchivedCreator[]> {
  const response = await fetch('/v1/creators/archived', { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/creators/archived: ${String(response.status)}`);
  return ArchivedCreatorListSchema.parse(await response.json()).creators;
}

/** Under `['creators']`: whatever refreshes the creators refreshes the archived ones too. */
export function useArchivedCreators(enabled: boolean): UseQueryResult<ArchivedCreator[]> {
  return useQuery({ queryKey: ['creators', 'archived'], queryFn: fetchArchivedCreators, enabled, retry: 1 });
}

/** The refusals shared by archiving and reopening; her state is unchanged on every one. */
type ArchiveRefusal =
  /** 403 `reauthentication_forbidden`: the sign-in is over 10 minutes old, the password is asked again. */
  | { readonly kind: 'reauth' }
  /** Any other 403: only the owner archives or reopens a creator. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

export type ArchiveResult =
  | { readonly kind: 'archived'; readonly creator: ArchivedCreator }
  /** 409 `creator_planned_conflict`: still planned, with how many shifts ahead and weekly shifts running. */
  | { readonly kind: 'planned'; readonly planned: CreatorPlanned }
  | ArchiveRefusal;

export type RestoreResult = { readonly kind: 'restored'; readonly creator: CreatorSummary } | ArchiveRefusal;

/** The refusal a non-OK answer of `/archive` or `/restore` means. */
async function refusalOf(
  response: Response,
): Promise<ArchiveRefusal | { kind: 'planned'; planned: CreatorPlanned }> {
  if (response.status === 401) return { kind: 'expired' };
  if (response.status === 404) return { kind: 'not_found' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = error.data?.error.code;
  if (response.status === 409 && code === ('creator_planned_conflict' satisfies CreatorErrorCode)) {
    const planned = CreatorPlannedSchema.safeParse(error.data?.error.details);
    return planned.success ? { kind: 'planned', planned: planned.data } : { kind: 'failed' };
  }
  if (response.status === 403) {
    return code === REAUTHENTICATION_ERROR_CODE ? { kind: 'reauth' } : { kind: 'forbidden' };
  }
  return { kind: 'failed' };
}

async function post(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { method: 'POST', credentials: 'include' });
  } catch {
    return null;
  }
}

/**
 * `POST /v1/creators/:creatorId/archive` (owner only, a recent sign-in, ADR 0071 § 2): nothing of hers is deleted;
 * she leaves every list, her agent stops and her space closes. Refused while she is still planned.
 */
export async function archiveCreator(creatorId: string): Promise<ArchiveResult> {
  const response = await post(`/v1/creators/${encodeURIComponent(creatorId)}/archive`);
  if (response === null) return { kind: 'failed' };
  if (response.ok) {
    const creator = ArchivedCreatorSchema.safeParse(await response.json().catch(() => null));
    return creator.success ? { kind: 'archived', creator: creator.data } : { kind: 'failed' };
  }
  return refusalOf(response);
}

/** `POST /v1/creators/:creatorId/restore` (owner only, a recent sign-in): listed again, her agent still off. */
export async function restoreCreator(creatorId: string): Promise<RestoreResult> {
  const response = await post(`/v1/creators/${encodeURIComponent(creatorId)}/restore`);
  if (response === null) return { kind: 'failed' };
  if (response.ok) {
    const creator = CreatorSummarySchema.safeParse(await response.json().catch(() => null));
    return creator.success ? { kind: 'restored', creator: creator.data } : { kind: 'failed' };
  }
  const refusal = await refusalOf(response);
  return refusal.kind === 'planned' ? { kind: 'failed' } : refusal;
}

/** Her own account, for the Accès tab of her sheet (CR-02): the owner's alone. */
export const creatorAccountKey = (creatorId: CreatorId) => ['creators', creatorId, 'account'] as const;

/** `GET /v1/creators/:creatorId/account` (owner): her account, `null` before her first invitation. */
export function useCreatorAccount(creatorId: CreatorId): UseQueryResult<CreatorAccount['account']> {
  return useQuery({
    queryKey: creatorAccountKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/account`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET /v1/creators/:id/account: ${String(response.status)}`);
      return CreatorAccountSchema.parse(await response.json()).account;
    },
    retry: 1,
  });
}

/** What the owner reads when her link is refused, in the sheet's words. */
const LINK_REFUSALS: Partial<Record<InvitationLinkErrorCode, string>> = {
  creator_not_found: 'Cette créatrice n’existe plus. Recharge la page.',
  creator_account_not_found: 'Elle n’a pas encore de compte : crée d’abord son lien d’invitation.',
  creator_account_conflict:
    'Elle a déjà choisi son mot de passe avec son e-mail : il ne se change plus d’ici.',
  account_email_conflict: 'Un autre compte utilise déjà cet e-mail.',
};

/**
 * `POST /v1/creators/:creatorId/invitation-link` (owner, recent sign-in): her own account made with her e-mail the
 * first time, then a link of 72 h; a new one cancels the one before.
 */
export async function createCreatorLink(
  creatorId: CreatorId,
  body: CreateCreatorInvitationLinkBody,
): Promise<LinkOutcome> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/invitation-link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', value: InvitationLinkCreatedSchema.parse(await response.json()) };
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!error.success) return { kind: 'failed' };
    const { code } = error.data.error;
    if (code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
    const message = Object.entries(LINK_REFUSALS).find(([known]) => known === code)?.[1];
    return message === undefined ? { kind: 'failed' } : { kind: 'refused', message };
  } catch {
    return { kind: 'failed' };
  }
}

/** How many versions of her persona were ever stored, for « Pour démarrer » on her sheet (CRM-07 b2): the owner's. */
export const personaVersionsKey = (creatorId: CreatorId) =>
  ['creators', creatorId, 'persona-versions'] as const;

export function usePersonaVersionCount(creatorId: CreatorId): UseQueryResult<number> {
  return useQuery({
    queryKey: personaVersionsKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET /v1/creators/:id/persona: ${String(response.status)}`);
      return PersonaOverviewSchema.parse(await response.json()).versions.length;
    },
    retry: 1,
  });
}
