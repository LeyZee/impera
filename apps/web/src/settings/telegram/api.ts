import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  TELEGRAM_CHAT_MEMBER_CONFLICT,
  TelegramBotSchema,
  TelegramDeliveriesSchema,
  TelegramOverviewSchema,
  TelegramRefusalSchema,
  TelegramRoutesSchema,
  TelegramTestResultSchema,
  type TelegramBot,
  type TelegramBotId,
  type TelegramChatId,
  type TelegramDelivery,
  type TelegramOverview,
  type TelegramRefusal,
  type TelegramRoute,
} from '@nirvana/contracts';

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
    : { ok: false, refusal: TelegramRefusalSchema.parse(body) };
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

export async function sendTest(chatId: TelegramChatId): Promise<Outcome<{ sentAt: string }>> {
  const response = await call(`/chats/${chatId}/test`, { method: 'POST' });
  return outcome(response, (body) => TelegramTestResultSchema.parse(body));
}

export async function fetchDeliveries(limit = 50): Promise<TelegramDelivery[]> {
  const response = await call(`/deliveries?limit=${String(limit)}`);
  return TelegramDeliveriesSchema.parse(await response.json()).deliveries;
}
