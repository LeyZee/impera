import {
  ApiErrorSchema,
  CommissionPresetListSchema,
  CommissionRateHistorySchema,
  CommissionRateSchema,
  InvitationLinkCreatedSchema,
  REAUTHENTICATION_ERROR_CODE,
  TEAM_MEMBER_ERROR_CODES,
  TeamMemberListSchema,
  TeamMemberNoteListSchema,
  TeamMemberNoteSchema,
  TeamMemberSchema,
  type CommissionPreset,
  type CommissionRate,
  type CreateTeamMemberBody,
  type InvitationLinkCreated,
  type InvitationLinkPurpose,
  type SetCommissionRateBody,
  type TeamMember,
  type TeamMemberErrorCode,
  type TeamMemberNote,
  type TeamMemberStatus,
  type UpdateTeamMemberBody,
} from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { TeamRefusalCode } from './model';

/**
 * `/v1/team` as Équipe › Membres reads it (EQ-01, EQ-10). Every answer is parsed with the contract: a shape the page
 * does not expect is an error, not a guess.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

export const fetchMembers = (): Promise<TeamMember[]> =>
  read('/v1/team/members', (body) => TeamMemberListSchema.parse(body).members);

export const fetchPresets = (): Promise<CommissionPreset[]> =>
  read('/v1/team/commission-presets', (body) => CommissionPresetListSchema.parse(body).presets);

export const fetchNotes = (memberId: string): Promise<TeamMemberNote[]> =>
  read(`/v1/team/members/${memberId}/notes`, (body) => TeamMemberNoteListSchema.parse(body).notes);

export const MEMBERS_KEY = ['team', 'members'] as const;

/** The team as the agency reads it; `enabled` false for a member, who does not read it. */
export function useMembers(enabled = true): UseQueryResult<TeamMember[]> {
  // One retry: a silent server is said in about a second (EQ-22).
  return useQuery({ queryKey: MEMBERS_KEY, queryFn: fetchMembers, enabled, retry: 1 });
}

/** The presets are the owner's settings: a manager who cannot read them sees the figures alone. */
export function usePresets(): UseQueryResult<CommissionPreset[]> {
  return useQuery({ queryKey: ['team', 'presets'], queryFn: fetchPresets, retry: false });
}

export const fetchRates = (memberId: string): Promise<CommissionRate[]> =>
  read(`/v1/team/members/${memberId}/commission`, (body) => CommissionRateHistorySchema.parse(body).rates);

/** Every rate of a member, ahead ones included; under the team's key, so a write that reads the team reads them too. */
export function useRates(memberId: string, enabled = true): UseQueryResult<CommissionRate[]> {
  return useQuery({
    queryKey: [...MEMBERS_KEY, memberId, 'rates'],
    queryFn: () => fetchRates(memberId),
    enabled,
    retry: 1,
  });
}

export function useNotes(memberId: string): UseQueryResult<TeamMemberNote[]> {
  return useQuery({ queryKey: ['team', 'notes', memberId], queryFn: () => fetchNotes(memberId) });
}

/** A refusal the screen says in its own words, or a server that does not answer. */
export type Refusal =
  | { readonly kind: 'refused'; readonly code: TeamRefusalCode }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'failed' };

export type Outcome<T> = { readonly kind: 'ok'; readonly value: T } | Refusal;

const isTeamCode = (code: string): code is TeamMemberErrorCode =>
  TEAM_MEMBER_ERROR_CODES.some((known) => known === code);

async function refusalOf(response: Response): Promise<Refusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'failed' };
  const { code } = parsed.data.error;
  if (code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
  // A manager whose status changed since the page opened: the role guard, not a server down.
  if (code === 'role_forbidden') return { kind: 'refused', code };
  return isTeamCode(code) ? { kind: 'refused', code } : { kind: 'failed' };
}

async function send<T>(
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
  method: 'POST' | 'PATCH' | 'PUT' = 'POST',
): Promise<Outcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

/** `POST /v1/team/members` (owner): the account, the record and the first rate; the link comes next. */
export const createMember = (body: CreateTeamMemberBody): Promise<Outcome<TeamMember>> =>
  send('/v1/team/members', body, (json) => TeamMemberSchema.parse(json));

/** `POST /v1/team/members/:memberId/invitation-link` (owner, recent sign-in): a new link cancels the one before. */
export const createInvitationLink = (
  memberId: string,
  purpose: InvitationLinkPurpose,
): Promise<Outcome<InvitationLinkCreated>> =>
  send(`/v1/team/members/${memberId}/invitation-link`, { purpose }, (json) =>
    InvitationLinkCreatedSchema.parse(json),
  );

/** `POST /v1/team/members/:memberId/notes` (owner, active manager). */
export const addNote = (memberId: string, body: string): Promise<Outcome<TeamMemberNote>> =>
  send(`/v1/team/members/${memberId}/notes`, { body }, (json) => TeamMemberNoteSchema.parse(json));

/** `PATCH /v1/team/members/:memberId` (owner): the team name, the colour, the creators (EQ-10). */
export const updateMember = (memberId: string, body: UpdateTeamMemberBody): Promise<Outcome<TeamMember>> =>
  send(`/v1/team/members/${memberId}`, body, (json) => TeamMemberSchema.parse(json), 'PATCH');

/** `PUT /v1/team/members/:memberId/status` (owner): `left` takes his creators and ends his sessions, for good. */
export const changeStatus = (memberId: string, status: TeamMemberStatus): Promise<Outcome<TeamMember>> =>
  send(`/v1/team/members/${memberId}/status`, { status }, (json) => TeamMemberSchema.parse(json), 'PUT');

/** `POST /v1/team/members/:memberId/commission` (owner): a new rate from the 1st or the 16th, never before today. */
export const setCommission = (
  memberId: string,
  body: SetCommissionRateBody,
): Promise<Outcome<CommissionRate>> =>
  send(`/v1/team/members/${memberId}/commission`, body, (json) => CommissionRateSchema.parse(json));
