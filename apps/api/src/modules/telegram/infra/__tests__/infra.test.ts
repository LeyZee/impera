import { describe, expect, it } from 'vitest';

import { FAKE_TOKEN } from '../../__tests__/support/fake-telegram';
import { foldUpdates } from '../../application/poll';
import { createTelegramApi, type PostLike } from '../telegram-api';

interface Call {
  readonly url: string;
  readonly body: unknown;
}

/** Answers every call with the given status and body, and records what was asked. */
function fakeFetch(status: number, body: unknown, calls: Call[] = []): PostLike {
  return (url, init) => {
    const sent: unknown = JSON.parse(init.body);
    calls.push({ url, body: sent });
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}

describe('Telegram API adapter', () => {
  it('sends HTML without link preview, silent when asked, as a reply when asked', async () => {
    const calls: Call[] = [];
    const api = createTelegramApi({ fetch: fakeFetch(200, { ok: true, result: { message_id: 42 } }, calls) });
    const sent = await api.send(FAKE_TOKEN, '-100', {
      text: '<b>x</b>',
      isSilent: true,
      replyToMessageId: 7,
    });
    expect(sent).toEqual({ ok: true, value: { messageId: 42 } });
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`);
    expect(calls[0]?.body).toMatchObject({
      chat_id: '-100',
      parse_mode: 'HTML',
      disable_notification: true,
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: 7, allow_sending_without_reply: true },
    });
  });

  it('turns each Telegram refusal into one failure kind', async () => {
    const answer = (status: number, body: unknown) => createTelegramApi({ fetch: fakeFetch(status, body) });
    const message = { text: 'x', isSilent: false, replyToMessageId: null };
    expect(
      await answer(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } }).send(
        FAKE_TOKEN,
        '1',
        message,
      ),
    ).toEqual({
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 7 },
    });
    expect(
      await answer(400, { ok: false, error_code: 400, parameters: { migrate_to_chat_id: -1009 } }).send(
        FAKE_TOKEN,
        '1',
        message,
      ),
    ).toEqual({ ok: false, failure: { kind: 'migrated', toChatId: '-1009' } });
    expect(await answer(403, { ok: false, error_code: 403 }).send(FAKE_TOKEN, '1', message)).toMatchObject({
      failure: { kind: 'forbidden' },
    });
    expect(await answer(404, { ok: false, error_code: 404 }).getMe(FAKE_TOKEN)).toMatchObject({
      failure: { kind: 'unauthorized' },
    });
    expect(await answer(409, { ok: false, error_code: 409 }).getUpdates(FAKE_TOKEN, 0, 0)).toMatchObject({
      failure: { kind: 'conflict' },
    });
    expect(await answer(502, 'Bad Gateway').getMe(FAKE_TOKEN)).toMatchObject({
      failure: { kind: 'unreachable' },
    });
  });

  it('never lets a network error out, since it may quote the URL and its token', async () => {
    const api = createTelegramApi({
      fetch: () =>
        Promise.reject(new Error(`connect ECONNREFUSED https://api.telegram.org/bot${FAKE_TOKEN}/getMe`)),
    });
    const result = await api.getMe(FAKE_TOKEN);
    expect(result).toEqual({ ok: false, failure: { kind: 'unreachable' } });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it('reads membership, migration and title updates, and moves past the rest, a private /start included', async () => {
    const api = createTelegramApi({
      fetch: fakeFetch(200, {
        ok: true,
        result: [
          {
            update_id: 10,
            my_chat_member: {
              chat: { id: -100, type: 'group', title: 'Nora' },
              new_chat_member: { status: 'member' },
            },
          },
          { update_id: 11, message: { chat: { id: -100, type: 'group' }, migrate_to_chat_id: -1001 } },
          {
            update_id: 12,
            message: { chat: { id: -1001, type: 'supergroup' }, new_chat_title: 'Canal de Nora' },
          },
          { update_id: 13, message: { chat: { id: -1001, type: 'supergroup' }, text: 'bonjour' } },
          { update_id: 14, weird: true },
          {
            update_id: 15,
            my_chat_member: { chat: { id: 5, type: 'private' }, new_chat_member: { status: 'member' } },
          },
          // 27/11/2026: the private chats are gone, a `/start` is read past like any message.
          { update_id: 16, message: { chat: { id: 5, type: 'private' }, text: '/start ABCDEFGH23' } },
          {
            update_id: 17,
            message: { chat: { id: 6, type: 'private' }, text: '/start@demo_bot XYZW234567' },
          },
          { update_id: 18, message: { chat: { id: -1001, type: 'supergroup' }, text: '/start ABCDEFGH23' } },
          { update_id: 19, message: { chat: { id: 5, type: 'private' }, text: '/start' } },
          { update_id: 20, message: { chat: { id: 5, type: 'private' }, text: '/start ABC and more' } },
        ],
      }),
    });
    const result = await api.getUpdates(FAKE_TOKEN, 0, 0);
    expect(result.ok).toBe(true);
    const batch = foldUpdates(0, result.ok ? result.value : []);
    expect(batch).toEqual({
      nextOffset: 21,
      chats: [{ telegramChatId: '-100', title: 'Nora', kind: 'group', membership: 'member', canPost: true }],
      migrations: [{ fromChatId: '-100', toChatId: '-1001' }],
      titles: [{ telegramChatId: '-1001', title: 'Canal de Nora' }],
    });
  });
});
