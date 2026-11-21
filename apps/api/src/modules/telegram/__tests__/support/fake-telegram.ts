import type {
  ChannelFailure,
  ChannelResult,
  ChannelUpdate,
  NotificationChannel,
  OutgoingMessage,
} from '../../domain/ports';
import type { ChannelOutgoing } from '../../domain/week-ports';

/**
 * Fictitious bot tokens, shaped like @BotFather's. Built at run time so that no literal in the repository looks like
 * a real token to a secret scanner.
 */
const fakeToken = (botId: string, filler: string): string => `${botId}:AA${filler.repeat(8)}00`;
export const FAKE_TOKEN = fakeToken('1234567', 'FAKE');
export const OTHER_TOKEN = fakeToken('7654321', 'OTHR');
export const SAME_BOT_NEW_TOKEN = fakeToken('1234567', 'NEWK');

export interface SentMessage extends OutgoingMessage {
  readonly chatId: string;
  readonly messageId: number;
}

/**
 * Plays Telegram for the tests: knows the tokens it was given, records every message, and answers the next call
 * of a method with a scripted failure when one is queued. Nothing leaves the process.
 */
export class FakeTelegram implements NotificationChannel {
  readonly sent: SentMessage[] = [];
  readonly edits: { chatId: string; messageId: number; text: string }[] = [];
  /** The posts of her channel (ADR 0162), as `FakeTelegramChannel`. */
  readonly published: (ChannelOutgoing & { readonly chatId: string; readonly messageId: number })[] = [];
  readonly updates: ChannelUpdate[] = [];
  private readonly failures = new Map<string, ChannelFailure[]>();
  private readonly known = new Map<
    string,
    { telegramBotId: string; username: string; displayName: string }
  >();
  private nextMessageId = 100;

  addBot(token: string, username: string): void {
    this.known.set(token, { telegramBotId: token.split(':')[0] ?? '', username, displayName: username });
  }

  revoke(token: string): void {
    this.known.delete(token);
  }

  failNext(method: 'getMe' | 'getUpdates' | 'send' | 'edit' | 'publish', failure: ChannelFailure): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(failure);
    this.failures.set(method, queue);
  }

  private check<T>(method: string, token: string, value: () => T): ChannelResult<T> {
    const failure = this.failures.get(method)?.shift();
    if (failure !== undefined) return { ok: false, failure };
    if (!this.known.has(token)) return { ok: false, failure: { kind: 'unauthorized' } };
    return { ok: true, value: value() };
  }

  getMe(token: string): ReturnType<NotificationChannel['getMe']> {
    return Promise.resolve(
      this.check('getMe', token, () => {
        const bot = this.known.get(token);
        if (bot === undefined) throw new Error('unreachable');
        return bot;
      }),
    );
  }

  deleteWebhook(token: string): ReturnType<NotificationChannel['deleteWebhook']> {
    return Promise.resolve(this.check('deleteWebhook', token, () => null));
  }

  getUpdates(token: string, offset: number): ReturnType<NotificationChannel['getUpdates']> {
    return Promise.resolve(
      this.check('getUpdates', token, () => this.updates.filter((update) => update.updateId >= offset)),
    );
  }

  send(token: string, chatId: string, message: OutgoingMessage): ReturnType<NotificationChannel['send']> {
    return Promise.resolve(
      this.check('send', token, () => {
        const messageId = (this.nextMessageId += 1);
        this.sent.push({ ...message, chatId, messageId });
        return { messageId };
      }),
    );
  }

  publish(
    token: string,
    chatId: string,
    message: ChannelOutgoing,
  ): ReturnType<NotificationChannel['publish']> {
    return Promise.resolve(
      this.check('publish', token, () => {
        const messageId = (this.nextMessageId += 1);
        this.published.push({ ...message, chatId, messageId });
        return { messageId };
      }),
    );
  }

  edit(
    token: string,
    chatId: string,
    messageId: number,
    text: string,
  ): ReturnType<NotificationChannel['edit']> {
    return Promise.resolve(
      this.check('edit', token, () => {
        this.edits.push({ chatId, messageId, text });
        return null;
      }),
    );
  }
}

/** The bot entering a group, as `my_chat_member` says it. */
export function joined(updateId: number, telegramChatId: string, title: string): ChannelUpdate {
  return {
    kind: 'membership',
    updateId,
    telegramChatId,
    title,
    chatKind: 'group',
    membership: 'member',
    canPost: true,
  };
}
