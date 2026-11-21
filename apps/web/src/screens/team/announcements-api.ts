import {
  AnnouncementListSchema,
  AnnouncementReaderListSchema,
  AnnouncementReadSchema,
  AnnouncementSchema,
  ApiErrorSchema,
  type Announcement,
  type AnnouncementRead,
  type AnnouncementReader,
  type CreateAnnouncementBody,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/team/announcements` (EQ-12): what Aujourd'hui shows each member and what Équipe › Annonces shows the owner and
 * the managers. Every answer is parsed with the contract.
 */

export const ANNOUNCEMENTS_KEY = ['team', 'announcements'] as const;

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

export function useAnnouncements(enabled = true): UseQueryResult<Announcement[]> {
  return useQuery({
    queryKey: ANNOUNCEMENTS_KEY,
    queryFn: () => read('/v1/team/announcements', (body) => AnnouncementListSchema.parse(body).announcements),
    enabled,
    retry: 1,
  });
}

/** Who it is addressed to and when each read it, asked when the author opens the list. */
export function useReaders(id: string, enabled: boolean): UseQueryResult<AnnouncementReader[]> {
  return useQuery({
    queryKey: [...ANNOUNCEMENTS_KEY, id, 'readers'],
    queryFn: () =>
      read(
        `/v1/team/announcements/${id}/readers`,
        (body) => AnnouncementReaderListSchema.parse(body).readers,
      ),
    enabled,
    retry: 1,
  });
}

/** The refusals the screens say in their own words; anything else is a server that did not answer. */
const REFUSALS = {
  announcement_not_found: 'Cette annonce a été retirée.',
  announcement_creator_forbidden: 'Tu n’écris qu’aux membres des créatrices de ta liste.',
  announcement_withdraw_forbidden: 'Seuls son auteur et le propriétaire retirent une annonce.',
  role_forbidden: 'Ton accès a changé : recharge la page.',
} as const;

const isRefusal = (code: string): code is keyof typeof REFUSALS => code in REFUSALS;

export type Sent<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly said: string };

async function send<T>(
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
  failed: string,
): Promise<Sent<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok)
      return { ok: true, value: parse(response.status === 204 ? null : await response.json()) };
    const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = refusal.success ? refusal.data.error.code : null;
    const said = code !== null && isRefusal(code) ? REFUSALS[code] : failed;
    return { ok: false, said };
  } catch {
    return { ok: false, said: failed };
  }
}

export const createAnnouncement = (body: CreateAnnouncementBody): Promise<Sent<Announcement>> =>
  send(
    '/v1/team/announcements',
    body,
    (json) => AnnouncementSchema.parse(json),
    'L’annonce n’est pas partie : le serveur ne répond pas.',
  );

export const markRead = (id: string): Promise<Sent<AnnouncementRead>> =>
  send(
    `/v1/team/announcements/${id}/read`,
    {},
    (json) => AnnouncementReadSchema.parse(json),
    '« Lu » n’a pas été noté : le serveur ne répond pas.',
  );

export const withdrawAnnouncement = (id: string): Promise<Sent<null>> =>
  send(
    `/v1/team/announcements/${id}/withdraw`,
    {},
    () => null,
    'L’annonce n’a pas été retirée : le serveur ne répond pas.',
  );
