import type { TelegramMembership } from '@impera/contracts';
import { z } from 'zod';

import type { ChannelFailure, ChannelResult, ChannelUpdate, NotificationChannel } from '../domain/ports';

/**
 * The Telegram Bot API adapter (ADR 0020 §1, §5). The token sits in the URL (`/bot<token>/…`): nothing here logs
 * or rethrows a URL, a request or a raw error. Every answer becomes a value, every failure one `ChannelFailure`.
 */

export type PostLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

export interface TelegramApiOptions {
  readonly fetch: PostLike;
  /** `https://api.telegram.org` unless a test points elsewhere. */
  readonly baseUrl?: string;
}

const CALL_TIMEOUT_MS = 10_000;

const ErrorSchema = z.object({
  ok: z.literal(false),
  error_code: z.number().int(),
  description: z.string().optional(),
  parameters: z
    .object({ retry_after: z.number().optional(), migrate_to_chat_id: z.number().optional() })
    .optional(),
});

const OkSchema = z.object({ ok: z.literal(true), result: z.unknown() });

const MeSchema = z.object({
  id: z.number().int(),
  username: z.string().min(1),
  first_name: z.string().min(1),
});

const SentSchema = z.object({ message_id: z.number().int() });

const ChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(),
});

const UpdateSchema = z.object({
  update_id: z.number().int(),
  my_chat_member: z
    .object({
      chat: ChatSchema,
      new_chat_member: z.object({
        status: z.string(),
        can_post_messages: z.boolean().optional(),
        can_send_messages: z.boolean().optional(),
      }),
    })
    .optional(),
  message: z
    .object({
      chat: ChatSchema,
      migrate_to_chat_id: z.number().int().optional(),
      new_chat_title: z.string().optional(),
    })
    .optional(),
});

type Call = { ok: true; result: unknown } | { ok: false; failure: ChannelFailure; description: string };

function failureOf(status: number, body: unknown): Call {
  const parsed = ErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error_code : status;
  const description = parsed.success ? (parsed.data.description ?? '') : '';
  const parameters = parsed.success ? parsed.data.parameters : undefined;
  if (parameters?.migrate_to_chat_id !== undefined) {
    return {
      ok: false,
      failure: { kind: 'migrated', toChatId: String(parameters.migrate_to_chat_id) },
      description,
    };
  }
  if (code === 429) {
    return {
      ok: false,
      failure: {
        kind: 'rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil(parameters?.retry_after ?? 5)),
      },
      description,
    };
  }
  // Telegram answers 404 to a token it does not know.
  if (code === 401 || code === 404) return { ok: false, failure: { kind: 'unauthorized' }, description };
  if (code === 403) return { ok: false, failure: { kind: 'forbidden' }, description };
  if (code === 409) return { ok: false, failure: { kind: 'conflict' }, description };
  if (code === 400) return { ok: false, failure: { kind: 'bad_request' }, description };
  return { ok: false, failure: { kind: 'unreachable' }, description };
}

function membershipOf(
  member: {
    status: string;
    can_post_messages?: boolean | undefined;
    can_send_messages?: boolean | undefined;
  },
  chatType: string,
): {
  membership: TelegramMembership;
  canPost: boolean;
} {
  switch (member.status) {
    case 'creator':
      return { membership: 'member', canPost: true };
    case 'administrator':
      return {
        membership: 'member',
        canPost: chatType === 'channel' ? member.can_post_messages === true : true,
      };
    case 'member':
      return { membership: 'member', canPost: chatType !== 'channel' };
    case 'restricted':
      return { membership: 'member', canPost: member.can_send_messages === true };
    case 'kicked':
      return { membership: 'kicked', canPost: false };
    default:
      return { membership: 'left', canPost: false };
  }
}

function toUpdate(raw: unknown): ChannelUpdate | null {
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const update = parsed.data;
  const member = update.my_chat_member;
  if (member !== undefined) {
    return {
      kind: 'membership',
      updateId: update.update_id,
      telegramChatId: String(member.chat.id),
      title: member.chat.title ?? 'Sans titre',
      chatKind: member.chat.type,
      ...membershipOf(member.new_chat_member, member.chat.type),
    };
  }
  const message = update.message;
  if (message?.migrate_to_chat_id !== undefined) {
    return {
      kind: 'migration',
      updateId: update.update_id,
      fromChatId: String(message.chat.id),
      toChatId: String(message.migrate_to_chat_id),
    };
  }
  if (message?.new_chat_title !== undefined) {
    return {
      kind: 'title',
      updateId: update.update_id,
      telegramChatId: String(message.chat.id),
      title: message.new_chat_title,
    };
  }
  return { kind: 'other', updateId: update.update_id };
}

/** The update id of a row the schema refused, so the offset still moves past it. */
function updateIdOf(raw: unknown): number | null {
  const parsed = z.object({ update_id: z.number().int() }).safeParse(raw);
  return parsed.success ? parsed.data.update_id : null;
}

export function createTelegramApi(options: TelegramApiOptions): NotificationChannel {
  const baseUrl = options.baseUrl ?? 'https://api.telegram.org';

  async function call(
    token: string,
    method: string,
    body: object,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<Call> {
    let status: number;
    let text: string;
    try {
      const response = await options.fetch(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch {
      // The error may quote the URL, hence the token: dropped, never logged.
      return { ok: false, failure: { kind: 'unreachable' }, description: '' };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return failureOf(status, null);
    }
    const ok = OkSchema.safeParse(json);
    return ok.success && status < 300 ? { ok: true, result: ok.data.result } : failureOf(status, json);
  }

  function fail<T>(failure: ChannelFailure): ChannelResult<T> {
    return { ok: false, failure };
  }

  const linkPreview = { is_disabled: true };

  return {
    async getMe(token) {
      const result = await call(token, 'getMe', {});
      if (!result.ok) return fail(result.failure);
      const me = MeSchema.safeParse(result.result);
      if (!me.success) return fail({ kind: 'unreachable' });
      return {
        ok: true,
        value: {
          telegramBotId: String(me.data.id),
          username: me.data.username,
          displayName: me.data.first_name,
        },
      };
    },
    async deleteWebhook(token) {
      const result = await call(token, 'deleteWebhook', { drop_pending_updates: false });
      return result.ok ? { ok: true, value: null } : fail(result.failure);
    },
    async getUpdates(token, offset, waitSeconds) {
      const result = await call(
        token,
        'getUpdates',
        { offset, timeout: waitSeconds, allowed_updates: ['my_chat_member', 'message'] },
        CALL_TIMEOUT_MS + waitSeconds * 1000,
      );
      if (!result.ok) return fail(result.failure);
      const rows = z.array(z.unknown()).safeParse(result.result);
      if (!rows.success) return fail({ kind: 'unreachable' });
      const updates: ChannelUpdate[] = [];
      for (const raw of rows.data) {
        const update = toUpdate(raw);
        const updateId = update?.updateId ?? updateIdOf(raw);
        if (update !== null) updates.push(update);
        else if (updateId !== null) updates.push({ kind: 'other', updateId });
      }
      return { ok: true, value: updates };
    },
    async send(token, telegramChatId, message) {
      const result = await call(token, 'sendMessage', {
        chat_id: telegramChatId,
        text: message.text,
        parse_mode: 'HTML',
        disable_notification: message.isSilent,
        link_preview_options: linkPreview,
        ...(message.replyToMessageId === null
          ? {}
          : {
              reply_parameters: { message_id: message.replyToMessageId, allow_sending_without_reply: true },
            }),
      });
      if (!result.ok) return fail(result.failure);
      const sent = SentSchema.safeParse(result.result);
      return sent.success
        ? { ok: true, value: { messageId: sent.data.message_id } }
        : fail({ kind: 'unreachable' });
    },
    async edit(token, telegramChatId, messageId, text) {
      const result = await call(token, 'editMessageText', {
        chat_id: telegramChatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: linkPreview,
      });
      if (result.ok) return { ok: true, value: null };
      // A replayed edit: the message already reads the same.
      if (result.failure.kind === 'bad_request' && result.description.includes('message is not modified')) {
        return { ok: true, value: null };
      }
      return fail(result.failure);
    },
  };
}
