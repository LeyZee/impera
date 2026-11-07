import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  SalesFeedCheckReportSchema,
  SalesFeedErrorCodeSchema,
  SalesFeedImportResultSchema,
  SalesFeedLastCheckSchema,
  SalesFeedListSchema,
  SalesFeedNewModelsSchema,
  SalesFeedOverviewSchema,
  SalesFeedRefusalBodySchema,
  SalesFeedStatusSchema,
  TEAM_MEMBER_ERROR_CODES,
  TeamImportCountsSchema,
  TeamImportInvitationResultSchema,
  TeamImportLinksResultSchema,
  TeamImportOverviewSchema,
  refusalOf,
  type ImportSalesFeedModelsBody,
  type Platform,
  type SalesFeedCheckBody,
  type SalesFeedCheckReport,
  type SalesFeedImportResult,
  type SalesFeedLastCheck,
  type SalesFeedNewModels,
  type SalesFeedOverview,
  type SalesFeedRefusal,
  type SalesFeedStatus,
  type TeamImportCounts,
  type TeamImportInvitationBody,
  type TeamImportLinksBody,
  type TeamImportLinksResult,
  type TeamImportOverview,
  type TeamMember,
  type TeamMemberErrorCode,
} from '@impera/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ReauthRequired, ServicesError } from '@/settings/services/api';

/**
 * `/v1/settings/sales-feeds` (CRM-01, ADR 0050 § 4). The key goes up once, in the body of `PUT …/key`; no answer ever
 * brings it back, even masked. Every answer is parsed with the contract: a shape the page does not expect is an
 * error, not a guess. The failures read as the Services page reads them (`ServicesError`, `ReauthRequired`), so
 * both pages say the same sentence for the same thing.
 */

const BASE = '/v1/settings/sales-feeds';
const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * A refusal the server words itself (`sales_feed_*`: a model already linked elsewhere, no HTTPS address, the vault
 * missing…): its French sentence is the one to show, as it is.
 */
export class SalesFeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesFeedRefused';
  }
}

async function apiError(response: Response): Promise<{ code: string; message: string } | null> {
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return body.success ? { code: body.data.error.code, message: body.data.error.message } : null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const what = `${init.method ?? 'GET'} ${path}`;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ServicesError('unavailable', `${what}: réseau`);
  }
  if (response.ok) return response;
  const detail = `${what}: ${String(response.status)}`;
  if (response.status === 401) throw new ServicesError('session_expired', detail);
  if (response.status === 429) throw new ServicesError('rate_limited', detail);
  // A 422 is either the platform's refusal of the key or webhook (its kind in `details`, read by the caller) or a
  // refusal of ours: told apart by the body, read on a copy.
  if (response.status === 422) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (SalesFeedRefusalBodySchema.safeParse(body).success) return response;
    const error = ApiErrorSchema.safeParse(body);
    if (error.success && SalesFeedErrorCodeSchema.safeParse(error.data.error.code).success) {
      throw new SalesFeedRefused(error.data.error.message);
    }
    throw new ServicesError('unavailable', detail);
  }
  // The check's refusal by the platform (its statistics or its models) is a 502 with its kind too.
  if (response.status === 502) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (SalesFeedRefusalBodySchema.safeParse(body).success) return response;
  }
  const error = await apiError(response);
  if (response.status === 403) {
    if (error?.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    if (error?.code === 'role_forbidden') throw new ServicesError('forbidden', detail);
  }
  if (error !== null && SalesFeedErrorCodeSchema.safeParse(error.code).success) {
    throw new SalesFeedRefused(error.message);
  }
  throw new ServicesError('unavailable', detail);
}

/** An answer the contract refuses reads as « Le serveur ne répond pas », like any answer the page cannot use. */
async function parsed<T>(response: Response, parse: (body: unknown) => T): Promise<T> {
  try {
    return parse(await response.json());
  } catch {
    throw new ServicesError('unavailable', `réponse inattendue (${String(response.status)})`);
  }
}

/** The feeds the server knows, one line each (Reveal's CRM API alone for now). */
export async function fetchFeeds(): Promise<SalesFeedStatus[]> {
  return parsed(await call(''), (body) => SalesFeedListSchema.parse(body).feeds);
}

export async function fetchOverview(platform: Platform): Promise<SalesFeedOverview> {
  return parsed(await call(`/${platform}`), (body) => SalesFeedOverviewSchema.parse(body));
}

/**
 * How many models the platforms listed last with no link and not set aside (CRM-07 b2, ADR 0069 § 5): the count on
 * Réglages › Ventes. Read in the base, never at the platform; a failure shows no count rather than a wrong one.
 */
export async function fetchNewModels(): Promise<SalesFeedNewModels> {
  return parsed(await call('/new-models'), (body) => SalesFeedNewModelsSchema.parse(body));
}

export const newModelsQuery = queryOptions({
  queryKey: ['sales-feeds', 'new-models'],
  queryFn: fetchNewModels,
  retry: false,
  staleTime: 60_000,
});

export type FeedResult = { ok: true; status: SalesFeedStatus } | { ok: false; refusal: SalesFeedRefusal };

async function statusOrRefusal(response: Response): Promise<FeedResult> {
  return parsed(response, (body): FeedResult =>
    response.status === 422
      ? { ok: false, refusal: refusalOf(SalesFeedRefusalBodySchema.parse(body)) }
      : { ok: true, status: SalesFeedStatusSchema.parse(body) },
  );
}

/** Checked at the platform before it is kept (ADR 0050 § 4): a key it refuses comes back as a refusal, never saved. */
export async function connectKey(platform: Platform, key: string): Promise<FeedResult> {
  return statusOrRefusal(
    await call(`/${platform}/key`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key }) }),
  );
}

/** Removes the key, and the webhook with it (the server takes the webhook off first). */
export async function disconnect(platform: Platform): Promise<SalesFeedStatus> {
  return parsed(await call(`/${platform}`, { method: 'DELETE' }), (body) =>
    SalesFeedStatusSchema.parse(body),
  );
}

/**
 * Registers the webhook at the platform, or registers it again (a new secret; the old one is taken off after). No
 * body, so no JSON content type: Fastify refuses an empty body announced as JSON.
 */
export async function connectWebhook(platform: Platform): Promise<FeedResult> {
  return statusOrRefusal(await call(`/${platform}/webhook`, { method: 'PUT' }));
}

export async function disconnectWebhook(platform: Platform): Promise<SalesFeedStatus> {
  return parsed(await call(`/${platform}/webhook`, { method: 'DELETE' }), (body) =>
    SalesFeedStatusSchema.parse(body),
  );
}

/** `null` unlinks: the model's next sales wait in quarantine again. */
export async function linkModel(
  platform: Platform,
  platformModelId: string,
  platformAccountId: string | null,
): Promise<SalesFeedOverview> {
  const response = await call(`/${platform}/models/${encodeURIComponent(platformModelId)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ platformAccountId }),
  });
  return parsed(response, (body) => SalesFeedOverviewSchema.parse(body));
}

export type CheckResult =
  { ok: true; report: SalesFeedCheckReport } | { ok: false; refusal: SalesFeedRefusal };

/**
 * The reliability check (CRM-02, ADR 0050 § 8): the register against the platform's statistics and the export,
 * read for this answer and kept nowhere. The platform's refusal comes back as one (502); an export the server cannot
 * read, or days not over, as its own sentence (`SalesFeedRefused`).
 */
export async function runCheck(platform: Platform, body: SalesFeedCheckBody): Promise<CheckResult> {
  const response = await call(`/${platform}/check`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return parsed(response, (json): CheckResult =>
    response.ok
      ? { ok: true, report: SalesFeedCheckReportSchema.parse(json) }
      : { ok: false, refusal: refusalOf(SalesFeedRefusalBodySchema.parse(json)) },
  );
}

/**
 * The latest report kept (CRM-03), `last: null` before any check: the screen shows it again on return, and says
 * whether the switch to the platform's net can rest on it (`clean`, decided by the server).
 */
export async function fetchLastCheck(platform: Platform): Promise<SalesFeedLastCheck> {
  return parsed(await call(`/${platform}/check`), (body) => SalesFeedLastCheckSchema.parse(body));
}

/**
 * « Importer la sélection » (CRM-07, ADR 0069): only the models' identifiers and the owner's choices go up; the server
 * reads the platform's list again and answers line by line, with the overview after. A sign-in too old for it is a
 * `ReauthRequired`; a list the platform does not give, `SalesFeedRefused` with the server's sentence.
 */
export async function importModels(
  platform: Platform,
  body: ImportSalesFeedModelsBody,
): Promise<SalesFeedImportResult> {
  const response = await call(`/${platform}/import`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return parsed(response, (json) => SalesFeedImportResultSchema.parse(json));
}

/** Dismisses a model from the import (`true`), or takes it back (`false`): it then shows among the others again. */
export async function setDismissal(
  platform: Platform,
  platformModelId: string,
  dismissed: boolean,
): Promise<SalesFeedOverview> {
  const response = await call(`/${platform}/models/${encodeURIComponent(platformModelId)}/dismissal`, {
    method: dismissed ? 'PUT' : 'DELETE',
  });
  return parsed(response, (body) => SalesFeedOverviewSchema.parse(body));
}

/**
 * The platform's team reviewed by the owner or an active manager (ADR 0076): each account with its link, its
 * proposal and what this viewer may do on it. Reads the platform's list live; the links stay without it.
 */
export async function fetchTeamImport(platform: Platform): Promise<TeamImportOverview> {
  return parsed(await call(`/${platform}/team`), (body) => TeamImportOverviewSchema.parse(body));
}

/** The badges alone (§ 5, § 6), read in the base: no call to the platform. */
export async function fetchTeamImportCounts(platform: Platform): Promise<TeamImportCounts> {
  return parsed(await call(`/${platform}/team/counts`), (body) => TeamImportCountsSchema.parse(body));
}

export const teamImportKey = (platform: Platform): readonly ['team-import', Platform] => [
  'team-import',
  platform,
];
export const teamImportCountsKey = (platform: Platform): readonly ['team-import', Platform, 'counts'] => [
  'team-import',
  platform,
  'counts',
];

export function useTeamImport(platform: Platform): UseQueryResult<TeamImportOverview> {
  return useQuery({
    queryKey: teamImportKey(platform),
    queryFn: () => fetchTeamImport(platform),
    retry: false,
  });
}

/** A chatter or a creator reads a 403 here: no tab, no badge. Never retried, the page stands without it. */
export function useTeamImportCounts(platform: Platform, enabled = true): UseQueryResult<TeamImportCounts> {
  return useQuery({
    queryKey: teamImportCountsKey(platform),
    queryFn: () => fetchTeamImportCounts(platform),
    retry: false,
    enabled,
  });
}

/**
 * « Confirmer la sélection » (§ 1): the rows ticked, each with its link. Each row answers on its own (a manager's own
 * record, a provider's account); the others go through, and the overview comes after.
 */
export async function linkTeam(
  platform: Platform,
  body: TeamImportLinksBody,
): Promise<TeamImportLinksResult> {
  const response = await call(`/${platform}/team/links`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return parsed(response, (json) => TeamImportLinksResultSchema.parse(json));
}

/** Sets an account aside (`true`), or takes it back (`false`). */
export async function setChatterDismissal(
  platform: Platform,
  platformChatterId: string,
  dismissed: boolean,
): Promise<TeamImportOverview> {
  const response = await call(`/${platform}/team/${encodeURIComponent(platformChatterId)}/dismissal`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ dismissed }),
  });
  return parsed(response, (json) => TeamImportOverviewSchema.parse(json));
}

/** How an invitation from a row ends; the dialog says each in its own words. */
export type InviteOutcome =
  | { readonly kind: 'ok'; readonly member: TeamMember }
  | { readonly kind: 'reauth' }
  /** `member_conflict`: the e-mail is another member's, or the account was linked meanwhile. */
  | { readonly kind: 'conflict' }
  /** `role_forbidden`: outside what a manager may give, or no longer a manager. */
  | { readonly kind: 'bounds' }
  | { readonly kind: 'team'; readonly code: TeamMemberErrorCode }
  /** The server's own sentence (`sales_feed_*`: a provider's account, no longer listed, the list down). */
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'session' }
  | { readonly kind: 'failed' };

const isTeamCode = (code: string): code is TeamMemberErrorCode =>
  TEAM_MEMBER_ERROR_CODES.some((known) => known === code);

/**
 * « Inviter » (§ 3), one row at a time, the password asked again: the member and the link in one transaction. Played
 * again for the same account, the same member.
 */
export async function inviteFromPlatform(
  platform: Platform,
  platformChatterId: string,
  body: TeamImportInvitationBody,
): Promise<InviteOutcome> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${platform}/team/${encodeURIComponent(platformChatterId)}/invitation`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const member = TeamImportInvitationResultSchema.safeParse(await response.json().catch(() => null));
    return member.success ? { kind: 'ok', member: member.data } : { kind: 'failed' };
  }
  if (response.status === 401) return { kind: 'session' };
  const error = await apiError(response);
  if (error === null) return { kind: 'failed' };
  if (error.code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
  if (error.code === 'member_conflict') return { kind: 'conflict' };
  if (error.code === 'role_forbidden') return { kind: 'bounds' };
  if (isTeamCode(error.code)) return { kind: 'team', code: error.code };
  if (SalesFeedErrorCodeSchema.safeParse(error.code).success)
    return { kind: 'refused', message: error.message };
  return { kind: 'failed' };
}
