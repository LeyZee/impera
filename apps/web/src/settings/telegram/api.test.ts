import {
  REAUTHENTICATION_ERROR_CODE,
  TELEGRAM_LINK_NO_BOT_UNPROCESSABLE,
  TelegramBotIdSchema,
  TelegramChatIdSchema,
  newId,
} from '@impera/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReauthRequired } from '../services/api';

import {
  LinkRateLimited,
  LinkUnavailable,
  TelegramForbidden,
  TelegramOff,
  addBot,
  fetchOverview,
  fetchPrivateLink,
  removeBot,
  removeChat,
  requestLinkCode,
  saveRoutes,
  unlinkPrivateChat,
} from './api';

/** A refusal in the common body, its kind in `details` (MOT-13). */
const refusalBody = (code: string, kind: string, message: string): object => ({
  error: { code, message, details: { kind }, requestId: 'r' },
});

const bot = {
  id: newId(TelegramBotIdSchema),
  username: 'demo_alertes_bot',
  displayName: 'Démo Alertes',
  state: 'active',
  lastPolledAt: null,
  chats: [],
};

const calls: { url: string; init: RequestInit | undefined }[] = [];

function answer(status: number, body: unknown): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Telegram API client', () => {
  it('sends the token once, in the body, and reads the bot or the refusal', async () => {
    answer(201, bot);
    expect(await addBot('1234567:FAKE')).toEqual({ ok: true, value: bot });
    expect(calls[0]?.url).toBe('/v1/settings/telegram/bots');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: '1234567:FAKE' }));
    answer(
      422,
      refusalBody('telegram_token_unprocessable', 'token_refused', 'Telegram ne reconnaît pas ce jeton.'),
    );
    expect(await addBot('1234567:FAKE')).toEqual({
      ok: false,
      refusal: { kind: 'token_refused', message: 'Telegram ne reconnaît pas ce jeton.' },
    });
  });

  it('reads a version conflict on the routes as a refusal', async () => {
    answer(
      409,
      refusalBody('telegram_routes_conflict', 'routes_version_conflict', 'Quelqu’un a changé ces réglages.'),
    );
    expect(await saveRoutes(2, [])).toMatchObject({
      ok: false,
      refusal: { kind: 'routes_version_conflict' },
    });
  });

  it('tells a server without Telegram from one that fails', async () => {
    answer(404, { error: 'Not Found' });
    await expect(fetchOverview()).rejects.toBeInstanceOf(TelegramOff);
    answer(500, null);
    await expect(fetchOverview()).rejects.not.toBeInstanceOf(TelegramOff);
  });

  it('tells a member who is not the owner from a server that fails', async () => {
    answer(403, { error: { code: 'role_forbidden', message: 'x', details: {}, requestId: 'r' } });
    await expect(fetchOverview()).rejects.toBeInstanceOf(TelegramForbidden);
  });

  it('never takes a refused removal for a success', async () => {
    answer(409, { kind: 'routes_version_conflict', message: 'x' });
    await expect(removeBot(bot.id)).rejects.toThrow('DELETE /bots: 409');
  });

  it('asks for the password when the sign-in is too old', async () => {
    answer(403, {
      error: { code: REAUTHENTICATION_ERROR_CODE, message: 'x', details: {}, requestId: 'r1' },
    });
    await expect(removeBot(bot.id)).rejects.toBeInstanceOf(ReauthRequired);
  });

  it('fails loudly on a shape it does not expect', async () => {
    answer(200, { bots: 'nope' });
    await expect(fetchOverview()).rejects.toThrow();
    answer(500, { error: 'boom' });
    await expect(fetchOverview()).rejects.toThrow('GET : 500');
  });

  it('removes a group the bot is out of, already gone counts, the bot back in keeps it (REG-28)', async () => {
    const id = newId(TelegramChatIdSchema);
    answer(204, null);
    expect(await removeChat(id)).toBe('removed');
    expect(calls[0]).toMatchObject({ url: `/v1/settings/telegram/chats/${id}`, init: { method: 'DELETE' } });
    answer(404, { error: { code: 'telegram_chat_not_found', message: 'x', details: {}, requestId: 'r' } });
    expect(await removeChat(id)).toBe('removed');
    answer(409, {
      error: { code: 'telegram_chat_member_conflict', message: 'x', details: {}, requestId: 'r' },
    });
    expect(await removeChat(id)).toBe('still_member');
    answer(500, null);
    await expect(removeChat(id)).rejects.toThrow();
  });
});

describe('the private chat link (SEC-05 lot 2)', () => {
  const linked = { linked: true, botUsername: 'demo_bot', linkedAt: '2026-11-06T05:40:00.000Z' };
  const unlinked = { linked: false, botUsername: null, linkedAt: null };

  it('reads the link of the signed-in account, never a chat id', async () => {
    answer(200, linked);
    expect(await fetchPrivateLink()).toEqual(linked);
    expect(calls[0]?.url).toBe('/v1/auth/telegram-link');
  });

  it('is not served to a creator, nor on a server without Telegram', async () => {
    answer(403, { error: { code: 'role_forbidden', message: 'Interdit', details: {}, requestId: 'r' } });
    await expect(fetchPrivateLink()).rejects.toBeInstanceOf(LinkUnavailable);
    answer(404, { error: { code: 'not_found', message: 'Introuvable', details: {}, requestId: 'r' } });
    await expect(fetchPrivateLink()).rejects.toBeInstanceOf(LinkUnavailable);
  });

  it('asks a code, the password again when the sign-in is old, and says when no bot can take it', async () => {
    const code = {
      code: 'ABCDEFGH23',
      botUsername: 'demo_bot',
      url: 'https://t.me/demo_bot?start=ABCDEFGH23',
      expiresAt: '2026-11-06T05:50:00.000Z',
    };
    answer(200, code);
    expect(await requestLinkCode()).toEqual(code);
    expect(calls[0]?.url).toBe('/v1/auth/telegram-link/code');
    expect(calls[0]?.init?.method).toBe('POST');

    answer(403, {
      error: { code: REAUTHENTICATION_ERROR_CODE, message: 'Confirme', details: {}, requestId: 'r' },
    });
    await expect(requestLinkCode()).rejects.toBeInstanceOf(ReauthRequired);

    answer(422, {
      error: { code: TELEGRAM_LINK_NO_BOT_UNPROCESSABLE, message: 'Aucun bot', details: {}, requestId: 'r' },
    });
    expect(await requestLinkCode()).toBe('no_bot');

    answer(429, { error: { code: 'rate_limited', message: 'Trop', details: {}, requestId: 'r' } });
    await expect(requestLinkCode()).rejects.toBeInstanceOf(LinkRateLimited);
  });

  it('unlinks, and answers the state after', async () => {
    answer(200, unlinked);
    expect(await unlinkPrivateChat()).toEqual(unlinked);
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});
