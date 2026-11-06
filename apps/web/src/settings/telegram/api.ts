import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  TELEGRAM_CHAT_MEMBER_CONFLICT,
  TELEGRAM_LINK_NO_BOT_UNPROCESSABLE,
  TelegramBotSchema,
  TelegramDeliveriesSchema,
  TelegramLinkCodeSchema,
  TelegramOverviewSchema,
  TelegramPrivateLinkSchema,
  TelegramRefusalBodySchema,
  TelegramRoutesSchema,
  TelegramSalesSettingsSchema,
  TelegramTestResultSchema,
  refusalOf,
  type TelegramBot,
  type TelegramBotId,
  type TelegramChatId,
  type TelegramDelivery,
  type TelegramLinkCode,
  type TelegramOverview,
  type TelegramPrivateLink,
  type TelegramRefusal,
  type TelegramRoute,
  type TelegramSaleSettingsEntry,
  type TelegramSalesSettings,
} from '@impera/contracts';

import { ReauthRequired } from '../services/api';

/**
 * `/v1/settings/telegram` (fiche P3-07). The bot token goes up once, in the body of `POST /bots` or
 * `PUT /bots/:id/token`; no answer ever brings it back. Every answer is parsed with the contract.
 */

const BASE = '/v1/settings/telegram';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** `GET /v1/settings/telegram` is not served: the server runs without Telegram (no encryption key, ADR 0020). */
export class TelegramOff extends Error {}

/** The server answers 403 `role_forbidden`: Telegram is the owner's alone (`requireRole('owner')`). */
export class TelegramForbidden extends Error {}

export type Outcome<T> = { ok: true; value: T } | { ok: false; refusal: TelegramRefusal };

/** 422 and 409 carry a refusal with its French sentence; anything else that is not 2xx throws. */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  if (response.status === 403) {
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (body.success && body.data.error.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    if (body.success && body.data.error.code === 'role_forbidden') throw new TelegramForbidden();
  }
  if (response.status === 404 && path === '') throw new TelegramOff();
  if (!response.ok && response.status !== 422 && response.status !== 409)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${String(response.status)}`);
  return response;
}

async function outcome<T>(response: Response, parse: (body: unknown) => T): Promise<Outcome<T>> {
  const body: unknown = await response.json();
  return response.ok
    ? { ok: true, value: parse(body) }
    : { ok: false, refusal: refusalOf(TelegramRefusalBodySchema.parse(body)) };
}

export async function fetchOverview(): Promise<TelegramOverview> {
  return TelegramOverviewSchema.parse(await (await call('')).json());
}

export async function addBot(token: string): Promise<Outcome<TelegramBot>> {
  const response = await call('/bots', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
  return outcome(response, (body) => TelegramBotSchema.parse(body));
}

export async function replaceToken(id: TelegramBotId, token: string): Promise<Outcome<TelegramBot>> {
  const response = await call(`/bots/${id}/token`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
  return outcome(response, (body) => TelegramBotSchema.parse(body));
}

/** The contract answers 204 or 404: any refusal is an error, never a silent success. */
export async function removeBot(id: TelegramBotId): Promise<void> {
  const response = await call(`/bots/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`DELETE /bots: ${String(response.status)}`);
}

/**
 * « Retirer de la liste » (REG-28): a group the bot left or was banned from goes, with its routes. 404 is already gone,
 * the same end; 409 `telegram_chat_member_conflict`: the bot came back in meanwhile, the group stays.
 */
export async function removeChat(id: TelegramChatId): Promise<'removed' | 'still_member'> {
  const response = await fetch(`${BASE}/chats/${id}`, { method: 'DELETE', credentials: 'include' });
  if (response.ok || response.status === 404) return 'removed';
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (body.success && body.data.error.code === TELEGRAM_CHAT_MEMBER_CONFLICT) return 'still_member';
  throw new Error(`DELETE /chats: ${String(response.status)}`);
}

/** Asks the server to watch the bot's updates closely while the sheet waits for a group. */
export async function listen(id: TelegramBotId): Promise<void> {
  const response = await call(`/bots/${id}/listen`, { method: 'POST' });
  if (!response.ok) throw new Error(`POST /listen: ${String(response.status)}`);
}

export async function saveRoutes(
  version: number,
  routes: readonly TelegramRoute[],
): Promise<Outcome<{ routes: TelegramRoute[]; version: number }>> {
  const response = await call('/routes', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ version, routes }),
  });
  return outcome(response, (body) => TelegramRoutesSchema.parse(body));
}

/** The sales topic's settings (CRM-04): the entry for every creator always comes back, then hers. */
export async function fetchSaleSettings(): Promise<TelegramSalesSettings> {
  return TelegramSalesSettingsSchema.parse(await (await call('/sales')).json());
}

/** Replaces the whole list; a creator removed meanwhile throws (400), the screen reloads. */
export async function saveSaleSettings(
  settings: readonly TelegramSaleSettingsEntry[],
): Promise<TelegramSalesSettings> {
  const response = await call('/sales', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ settings }),
  });
  return TelegramSalesSettingsSchema.parse(await response.json());
}

export async function sendTest(chatId: TelegramChatId): Promise<Outcome<{ sentAt: string }>> {
  const response = await call(`/chats/${chatId}/test`, { method: 'POST' });
  return outcome(response, (body) => TelegramTestResultSchema.parse(body));
}

export async function fetchDeliveries(limit = 50): Promise<TelegramDelivery[]> {
  const response = await call(`/deliveries?limit=${String(limit)}`);
  return TelegramDeliveriesSchema.parse(await response.json()).deliveries;
}

/* ---- `/v1/auth/telegram-link` (SEC-05 lot 2, ADR 0068 § 4): the account's own private chat with the agency's bot ---- */

const LINK = '/v1/auth/telegram-link';

/** Not served: the server runs without Telegram (404), or the account is a creator's (403 `role_forbidden`). */
export class LinkUnavailable extends Error {}

/** 429: more than ten codes asked in a minute. */
export class LinkRateLimited extends Error {}

async function linkCall(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${LINK}${path}`, { credentials: 'include', ...init });
  if (response.status === 403) {
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (body.success && body.data.error.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    throw new LinkUnavailable();
  }
  if (response.status === 404) throw new LinkUnavailable();
  if (response.status === 429) throw new LinkRateLimited();
  if (!response.ok && response.status !== 422)
    throw new Error(`${init.method ?? 'GET'} ${LINK}${path}: ${String(response.status)}`);
  return response;
}

/** Whether the account's private chat is linked, and through which bot; never the chat's id. */
export async function fetchPrivateLink(): Promise<TelegramPrivateLink> {
  return TelegramPrivateLinkSchema.parse(await (await linkCall('')).json());
}

/** A new one-time code (ten minutes), replacing the last; `no_bot` while no active bot can take it (422). */
export async function requestLinkCode(): Promise<TelegramLinkCode | 'no_bot'> {
  const response = await linkCall('/code', { method: 'POST' });
  if (response.ok) return TelegramLinkCodeSchema.parse(await response.json());
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (body.success && body.data.error.code === TELEGRAM_LINK_NO_BOT_UNPROCESSABLE) return 'no_bot';
  throw new Error(`POST ${LINK}/code: ${String(response.status)}`);
}

/** Unlinks the chat (and drops a code still waiting); answers the state after. */
export async function unlinkPrivateChat(): Promise<TelegramPrivateLink> {
  return TelegramPrivateLinkSchema.parse(await (await linkCall('', { method: 'DELETE' })).json());
}
