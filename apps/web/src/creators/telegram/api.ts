import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  TelegramChannelRefusalBodySchema,
  TelegramChannelViewSchema,
  refusalOf,
  type TelegramChannelConfig,
  type TelegramChannelView,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ReauthRequired } from '@/settings/services/api';

/**
 * `/v1/creators/:id/telegram-channel` (ADR 0080 § 6), the owner's alone. Every answer is parsed with the contract: a
 * shape the page does not expect reads as « Le serveur ne répond pas ». A change asks for a sign-in under 10 minutes
 * (ADR 0016): `ReauthRequired`, then the page asks for the password and saves again.
 */

export type ChannelErrorKind = 'session_expired' | 'forbidden' | 'not_found' | 'rejected' | 'unavailable';

export const CHANNEL_ERRORS: Readonly<Record<ChannelErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire règle le canal Telegram.',
  not_found: 'Cette créatrice n’existe plus.',
  rejected: 'Le serveur a refusé ce réglage : recharge la page et vérifie chaque ligne.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class ChannelError extends Error {
  readonly kind: ChannelErrorKind;

  constructor(kind: ChannelErrorKind, detail: string) {
    super(`${CHANNEL_ERRORS[kind]} (${detail})`);
    this.name = 'ChannelError';
    this.kind = kind;
  }
}

/** A save the server refused, with its sentence (« Le lundi, 19 h et 20 h sont trop proches… »). */
export class ChannelRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelRefused';
  }
}

export const channelErrorKind = (error: unknown): ChannelErrorKind =>
  error instanceof ChannelError ? error.kind : 'unavailable';

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/telegram-channel`;

async function call(creatorId: string, init: RequestInit = {}): Promise<TelegramChannelView> {
  const what = `${init.method ?? 'GET'} telegram-channel`;
  let response: Response;
  try {
    response = await fetch(path(creatorId), { credentials: 'include', ...init });
  } catch {
    throw new ChannelError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const view = TelegramChannelViewSchema.safeParse(body);
    if (view.success) return view.data;
    throw new ChannelError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 400) {
    const refused = TelegramChannelRefusalBodySchema.safeParse(body);
    if (refused.success) throw new ChannelRefused(refusalOf(refused.data).message);
    // A setting the contract refused before the rules read it: said as refused, not as a server down.
    if (ApiErrorSchema.safeParse(body).success) throw new ChannelError('rejected', detail);
    throw new ChannelError('unavailable', detail);
  }
  if (response.status === 401) throw new ChannelError('session_expired', detail);
  if (response.status === 403) {
    const error = ApiErrorSchema.safeParse(body);
    if (error.success && error.data.error.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    throw new ChannelError('forbidden', detail);
  }
  if (response.status === 404) throw new ChannelError('not_found', detail);
  throw new ChannelError('unavailable', detail);
}

export const channelQueryKey = (creatorId: string): readonly string[] => ['telegram-channel', creatorId];

export function useTelegramChannel(creatorId: string): UseQueryResult<TelegramChannelView> {
  return useQuery({
    queryKey: channelQueryKey(creatorId),
    queryFn: () => call(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

/** Stores her setting whole; answers with what the server now holds. */
export const saveTelegramChannel = (
  creatorId: string,
  config: TelegramChannelConfig,
): Promise<TelegramChannelView> =>
  call(creatorId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config }),
  });
