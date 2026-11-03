import type { TelegramChatId, TelegramErrorKind } from '@impera/contracts';

import { nextBatch, type Batch } from '../domain/batch';
import type {
  BotsStore,
  ChannelFailure,
  ChannelResult,
  ChatRecord,
  Clock,
  DeliveriesStore,
  DeliveryRecord,
  NotificationChannel,
} from '../domain/ports';
import { escapeHtml, renderResend } from '../domain/render';
import { CHAT_SPACING_MS, STALE_SENDING_MS, retryDelayMs, shouldRetry } from '../domain/schedule';

export interface FlushDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  readonly clock: Clock;
}

/** While the message an edit or a reply acts on has not left yet. */
const PARENT_WAIT_MS = 5000;

/** A revoked token may come back (« Remplacer le jeton »): its messages wait within the retry window. */
const REFUSED_WAIT_MS = 5 * 60 * 1000;

/**
 * `telegram.flush_chat` (ADR 0020 §8, §9), in the serial queue of the group: sends one batch, records the outcome,
 * then schedules itself for what remains. Never throws for a Telegram answer: every answer is a state.
 */
export async function flushChat(deps: FlushDeps, chatId: TelegramChatId): Promise<void> {
  const chat = await deps.bots.findChat(chatId);
  if (chat === null) return;
  const now = deps.clock.now();

  await recoverInterrupted(deps, chatId, now);

  if (chat.membership !== 'member' || !chat.canPost) {
    const ready = await deps.deliveries.readyFor(chatId, now);
    await deps.deliveries.markDone(ids(ready), 'failed', 'chat_unreachable');
    return;
  }
  if (chat.nextSendAt !== null && chat.nextSendAt > now) {
    await deps.deliveries.enqueueFlush(chatId, chat.nextSendAt);
    return;
  }

  const bot = await deps.bots.findBot(chat.botId);
  const ready = await deps.deliveries.readyFor(chatId, now);
  if (bot === null) {
    await deps.deliveries.markDone(ids(ready), 'failed', 'token_refused');
    return;
  }
  const batch = nextBatch(ready);
  if (batch === null) return;
  const items = itemsOf(batch, ready);
  if (bot.token === null || bot.state === 'refused') {
    await retryOrFail(deps, items, now, REFUSED_WAIT_MS, 'token_refused');
    await scheduleNext(deps, chat, now);
    return;
  }

  const token = bot.token;
  await deps.deliveries.markSending(ids(items));
  const result = await send(deps, token, chat, batch, items, now);
  if (result !== 'postponed') {
    await record(deps, chat, items, result, now);
  }
  await scheduleNext(deps, await refreshed(deps, chat), now);
}

function ids(items: readonly { readonly id: string }[]): readonly string[] {
  return items.map((item) => item.id);
}

function itemsOf(batch: Batch, ready: readonly DeliveryRecord[]): readonly DeliveryRecord[] {
  const wanted = new Set(batch.kind === 'single' ? [batch.item.id] : batch.items.map((item) => item.id));
  return ready.filter((item) => wanted.has(item.id));
}

/** A delivery left `sending` by a dead worker: urgent goes again, marked; the rest is not repeated (ADR 0020 §9). */
async function recoverInterrupted(deps: FlushDeps, chatId: TelegramChatId, now: Date): Promise<void> {
  const stale = await deps.deliveries.staleSending(chatId, new Date(now.getTime() - STALE_SENDING_MS));
  const urgent = stale.filter((item) => item.topic === 'urgent' && item.action === 'send');
  const others = stale.filter((item) => !urgent.includes(item));
  if (urgent.length > 0) await deps.deliveries.requeue(ids(urgent), renderResend, now);
  if (others.length > 0) await deps.deliveries.markDone(ids(others), 'unknown', null);
}

type SendResult = ChannelResult<{ readonly messageId: number | null }> | 'postponed';

async function send(
  deps: FlushDeps,
  token: string,
  chat: ChatRecord,
  batch: Batch,
  items: readonly DeliveryRecord[],
  now: Date,
): Promise<SendResult> {
  if (batch.kind === 'joined') {
    return deps.channel.send(token, chat.telegramChatId, {
      text: batch.text,
      isSilent: batch.isSilent,
      replyToMessageId: null,
    });
  }
  const [item] = items;
  if (item === undefined) return 'postponed';
  if (item.action === 'send') {
    return deps.channel.send(token, chat.telegramChatId, {
      text: item.text,
      isSilent: item.isSilent,
      replyToMessageId: null,
    });
  }

  const parent = item.parentId === null ? null : await deps.deliveries.parentState(item.parentId);
  if (parent !== null && (parent.status === 'pending' || parent.status === 'sending')) {
    await deps.deliveries.markRetry([item.id], new Date(now.getTime() + PARENT_WAIT_MS), null);
    return 'postponed';
  }
  const parentMessageId = parent?.status === 'sent' ? parent.telegramMessageId : null;
  if (item.action === 'edit') {
    // Nothing to rewrite: the original never reached the group.
    if (parentMessageId === null) {
      await deps.deliveries.markDone([item.id], 'failed', null);
      return 'postponed';
    }
    if (parent?.isShared === true) {
      return deps.channel.send(token, chat.telegramChatId, {
        text: `✓ ${escapeHtml(item.summary)}`,
        isSilent: true,
        replyToMessageId: parentMessageId,
      });
    }
    const edited = await deps.channel.edit(token, chat.telegramChatId, parentMessageId, item.text);
    return edited.ok ? { ok: true, value: { messageId: null } } : edited;
  }
  return deps.channel.send(token, chat.telegramChatId, {
    text: item.text,
    isSilent: item.isSilent,
    replyToMessageId: parentMessageId,
  });
}

async function record(
  deps: FlushDeps,
  chat: ChatRecord,
  items: readonly DeliveryRecord[],
  result: ChannelResult<{ readonly messageId: number | null }>,
  now: Date,
): Promise<void> {
  if (result.ok) {
    await deps.deliveries.markSent(ids(items), result.value.messageId, now);
    await deps.bots.updateChat(chat.id, {
      lastSentAt: now,
      nextSendAt: new Date(now.getTime() + CHAT_SPACING_MS),
      lastErrorKind: null,
      lastErrorAt: null,
    });
    return;
  }
  await recordFailure(deps, chat, items, result.failure, now);
}

async function recordFailure(
  deps: FlushDeps,
  chat: ChatRecord,
  items: readonly DeliveryRecord[],
  failure: ChannelFailure,
  now: Date,
): Promise<void> {
  switch (failure.kind) {
    case 'rate_limited': {
      const at = new Date(now.getTime() + failure.retryAfterSeconds * 1000);
      await deps.deliveries.markRetry(ids(items), at, 'rate_limited');
      await deps.bots.updateChat(chat.id, { nextSendAt: at });
      return;
    }
    case 'migrated':
      // The group became a supergroup: same group, new id, sent again right away.
      await deps.bots.updateChat(chat.id, { telegramChatId: failure.toChatId });
      await deps.deliveries.markRetry(ids(items), now, null);
      return;
    case 'forbidden': {
      await deps.bots.updateChat(chat.id, {
        membership: 'left',
        canPost: false,
        lastErrorKind: 'chat_unreachable',
        lastErrorAt: now,
      });
      const rest = await deps.deliveries.readyFor(chat.id, now);
      await deps.deliveries.markDone([...ids(items), ...ids(rest)], 'failed', 'chat_unreachable');
      return;
    }
    case 'unauthorized':
      await deps.bots.setBotState(chat.botId, 'refused', 'token_refused');
      await retryOrFail(deps, items, now, REFUSED_WAIT_MS, 'token_refused');
      return;
    case 'bad_request':
      // Telegram refused this message itself (an edit of a deleted message, a text it will not take): no retry.
      await deps.deliveries.markDone(ids(items), 'failed', null);
      return;
    case 'conflict':
    case 'unreachable':
      await deps.bots.updateChat(chat.id, { lastErrorKind: 'unreachable', lastErrorAt: now });
      await retryOrFail(deps, items, now, null, 'unreachable');
      return;
  }
}

/** Retries within the window (ADR 0020 §8), the delay growing with the attempts; past it, the delivery fails. */
async function retryOrFail(
  deps: FlushDeps,
  items: readonly DeliveryRecord[],
  now: Date,
  fixedDelayMs: number | null,
  errorKind: TelegramErrorKind,
): Promise<void> {
  const alive = items.filter((item) => shouldRetry(item.createdAt, now));
  const dead = items.filter((item) => !alive.includes(item));
  for (const item of alive) {
    const delay = fixedDelayMs ?? retryDelayMs(item.attempts + 1);
    await deps.deliveries.markRetry([item.id], new Date(now.getTime() + delay), errorKind);
  }
  if (dead.length > 0) await deps.deliveries.markDone(ids(dead), 'failed', errorKind);
}

async function refreshed(deps: FlushDeps, chat: ChatRecord): Promise<ChatRecord> {
  return (await deps.bots.findChat(chat.id)) ?? chat;
}

/** The next flush: when the earliest pending delivery may go, and not before the group's pause. */
async function scheduleNext(deps: FlushDeps, chat: ChatRecord, now: Date): Promise<void> {
  const next = await deps.deliveries.nextRunAfter(chat.id);
  if (next === null) return;
  const pause = chat.nextSendAt ?? now;
  await deps.deliveries.enqueueFlush(
    chat.id,
    new Date(Math.max(next.getTime(), pause.getTime(), now.getTime())),
  );
}
