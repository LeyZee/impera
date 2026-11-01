import { ConversationIdSchema, CustomAlertIdSchema, DraftIdSchema, newId } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { FAKE_TOKEN } from '../../__tests__/support/fake-telegram';
import { foldUpdates } from '../../application/poll';
import { toScannedEvent } from '../events';
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

  it('takes a replayed edit as done', async () => {
    const api = createTelegramApi({
      fetch: fakeFetch(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message is not modified',
      }),
    });
    expect(await api.edit(FAKE_TOKEN, '1', 5, 'x')).toEqual({ ok: true, value: null });
  });

  it('reads membership, migration and title updates, and moves past the rest', async () => {
    const api = createTelegramApi({
      fetch: fakeFetch(200, {
        ok: true,
        result: [
          {
            update_id: 10,
            my_chat_member: {
              chat: { id: -100, type: 'group', title: 'Astreinte' },
              new_chat_member: { status: 'member' },
            },
          },
          { update_id: 11, message: { chat: { id: -100, type: 'group' }, migrate_to_chat_id: -1001 } },
          {
            update_id: 12,
            message: { chat: { id: -1001, type: 'supergroup' }, new_chat_title: 'Astreinte nuit' },
          },
          { update_id: 13, message: { chat: { id: -1001, type: 'supergroup' }, text: 'bonjour' } },
          { update_id: 14, weird: true },
          {
            update_id: 15,
            my_chat_member: { chat: { id: 5, type: 'private' }, new_chat_member: { status: 'member' } },
          },
        ],
      }),
    });
    const result = await api.getUpdates(FAKE_TOKEN, 0, 0);
    expect(result.ok).toBe(true);
    const batch = foldUpdates(0, result.ok ? result.value : []);
    expect(batch).toEqual({
      nextOffset: 16,
      chats: [
        { telegramChatId: '-100', title: 'Astreinte', kind: 'group', membership: 'member', canPost: true },
      ],
      migrations: [{ fromChatId: '-100', toChatId: '-1001' }],
      titles: [{ telegramChatId: '-1001', title: 'Astreinte nuit' }],
    });
  });
});

describe('reading the outbox', () => {
  const base = { id: 'e1', creatorId: null, createdAt: new Date('2026-10-17T22:00:00Z') };
  const conversationId = newId(ConversationIdSchema);

  it('reads a handoff with its cause, and an older one without', () => {
    expect(
      toScannedEvent({ ...base, type: 'handoff_requested', payload: { conversationId, cause: 'minor' } }),
    ).toMatchObject({
      signal: { kind: 'handoff', conversationId, cause: 'minor' },
    });
    expect(
      toScannedEvent({ ...base, type: 'handoff_requested', payload: { reason: 'texte libre' } }),
    ).toMatchObject({
      signal: { kind: 'handoff', conversationId: null, cause: null },
    });
  });

  it('reads which alert of hers paused the agent, and lets a trigger it cannot read go', () => {
    const alert = { kind: 'custom', id: newId(CustomAlertIdSchema) } as const;
    const handoff = (trigger: unknown) =>
      toScannedEvent({
        ...base,
        type: 'handoff_requested',
        payload: { conversationId, cause: 'custom_alert', trigger },
      })?.signal;
    expect(handoff({ alert, matchedBy: 'keyword', keyword: 'appel' })).toEqual({
      kind: 'handoff',
      conversationId,
      cause: 'custom_alert',
      alert,
    });
    expect(handoff({ alert: { kind: 'other' } })).toEqual({
      kind: 'handoff',
      conversationId,
      cause: 'custom_alert',
    });
  });

  it('reads the hand-back to the agent, with or without its conversation', () => {
    expect(
      toScannedEvent({ ...base, type: 'takeover_ended', payload: { conversationId, userId: 'u1' } }),
    ).toMatchObject({ signal: { kind: 'release', conversationId, userId: 'u1' } });
    expect(toScannedEvent({ ...base, type: 'takeover_ended', payload: { userId: 'u1' } })).toMatchObject({
      signal: { kind: 'release', conversationId: null, userId: 'u1' },
    });
  });

  it('reads only the last send failure, and nothing of what the platform said', () => {
    const failed = (payload: object) => toScannedEvent({ ...base, type: 'send_failed', payload });
    const attempt = {
      draftId: newId(DraftIdSchema),
      idempotencyKey: 'k',
      attempt: 3,
      error: 'platform_said_x',
    };
    expect(failed({ ...attempt, conversationId, isFinal: true })?.signal).toEqual({
      kind: 'send_failed',
      conversationId,
    });
    expect(failed({ ...attempt, conversationId, isFinal: false })).toBeNull();
    expect(failed({ ...attempt, conversationId })).toBeNull();
  });

  it('reads which alert rang when it was to go to Telegram, never how it matched nor the word', () => {
    const alert = { kind: 'custom', id: newId(CustomAlertIdSchema) } as const;
    const triggered = (payload: object) => toScannedEvent({ ...base, type: 'alert_triggered', payload });
    const trigger = { alert, matchedBy: 'keyword', keyword: 'appel' };
    expect(triggered({ conversationId, trigger, notify: true })?.signal).toEqual({
      kind: 'alert',
      conversationId,
      alert,
    });
    expect(
      triggered({
        conversationId,
        trigger: { alert: { kind: 'system', code: 'service_request' } },
        notify: true,
      })?.signal,
    ).toEqual({ kind: 'alert', conversationId, alert: { kind: 'system', code: 'service_request' } });
    // Off when it rang, or a row that does not say: nothing leaves.
    expect(triggered({ conversationId, trigger, notify: false })).toBeNull();
    expect(triggered({ conversationId, trigger })).toBeNull();
  });

  it('keeps only the session changes that open or close a thread', () => {
    const session = (from: string, to: string) =>
      toScannedEvent({
        ...base,
        type: 'session_state_changed',
        payload: { platformAccountId: 'acc', from, to },
      });
    expect(session('valid', 'expired')).toMatchObject({ signal: { kind: 'session_expired' } });
    expect(session('expired', 'valid')).toMatchObject({ signal: { kind: 'session_back' } });
    expect(session('valid', 'warning')).toBeNull();
  });

  it('reads the budget crossing of #54 and skips types it does not know yet', () => {
    expect(
      toScannedEvent({
        ...base,
        type: 'budget_threshold_crossed',
        payload: { kind: 'alert', spentMinor: 1600, capMinor: 2000, currency: 'EUR', day: '2026-10-17' },
      }),
    ).toMatchObject({ signal: { kind: 'budget', threshold: 'alert' } });
    expect(
      toScannedEvent({
        ...base,
        type: 'backup_overdue',
        payload: { lastSucceededAt: '2026-10-26T02:04:00.000Z', day: '2026-10-27' },
      })?.signal,
    ).toEqual({ kind: 'backup_overdue', lastSucceededAt: new Date('2026-10-26T02:04:00.000Z') });
    expect(
      toScannedEvent({
        ...base,
        type: 'backup_overdue',
        payload: { lastSucceededAt: null, day: '2026-10-27' },
      })?.signal,
    ).toEqual({ kind: 'backup_overdue', lastSucceededAt: null });
    // ADR 0033: the currency and the day of its last rate, nothing of the pay; `day` stays out.
    const rate = (payload: object) =>
      toScannedEvent({ ...base, type: 'exchange_rate_overdue', payload })?.signal;
    expect(rate({ currency: 'USD', lastRateDay: '2026-10-23', day: '2026-10-28' })).toEqual({
      kind: 'exchange_rate_overdue',
      currency: 'USD',
      lastRateDay: '2026-10-23',
    });
    expect(rate({ currency: 'USD', lastRateDay: null, day: '2026-10-28' })).toEqual({
      kind: 'exchange_rate_overdue',
      currency: 'USD',
      lastRateDay: null,
    });
    expect(rate({ currency: 'usd<b>', lastRateDay: null, day: '2026-10-28' })).toBeUndefined();
    // EQ-06: the period, the document and the reason; the member, the statement and the amount stay in Nirvana.
    const notIssued = (payload: object) =>
      toScannedEvent({ ...base, type: 'invoice_not_issued', payload })?.signal;
    const invoice = {
      memberId: '018f3e5c-0000-7000-8000-000000000001',
      statementId: '018f3e5c-0000-7000-8000-000000000002',
      period: '2026-10-16',
      document: 'invoice',
      reason: 'identity_incomplete',
      amountMinor: 12_345,
    };
    expect(notIssued(invoice)).toEqual({
      kind: 'invoice_not_issued',
      period: '2026-10-16',
      document: 'invoice',
      reason: 'identity_incomplete',
    });
    expect(notIssued({ ...invoice, reason: 'something_new' })).toBeUndefined();
    expect(notIssued({ ...invoice, period: '2026-10-17' })).toBeUndefined();
    // The voice version stays in Nirvana: the signal carries only the reasons and the count.
    const closed = toScannedEvent({
      ...base,
      type: 'automatic_closed',
      payload: {
        voicePrompt: 'sha256:abc',
        voiceModel: 'demo-model',
        missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
        conversations: 2,
      },
    });
    expect(closed?.signal).toEqual({
      kind: 'automatic_closed',
      missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
      conversations: 2,
    });
    expect(toScannedEvent({ ...base, type: 'automatic_closed', payload: { missing: [] } })).toBeNull();
    expect(toScannedEvent({ ...base, type: 'sale_detected', payload: {} })).toBeNull();
    expect(toScannedEvent({ ...base, type: 'kill_switch_toggled', payload: { nonsense: 1 } })).toBeNull();
  });
});
