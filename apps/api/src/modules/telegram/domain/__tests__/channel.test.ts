import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TelegramBotIdSchema,
  TelegramChannelConfigSchema,
  TelegramChatIdSchema,
  isRedirectUrl,
  newId,
  type TelegramChannelConfig,
  type TelegramChatId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  channelChoices,
  channelRefusal,
  channelWarnings,
  normalizedConfig,
  type ChannelContext,
} from '../channel';
import type { ChatRecord } from '../ports';

const botId = newId(TelegramBotIdSchema);

function chat(title: string, patch: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: newId(TelegramChatIdSchema),
    botId,
    telegramChatId: '-1001',
    title,
    kind: 'channel',
    membership: 'member',
    canPost: true,
    nextSendAt: null,
    lastSentAt: null,
    lastErrorKind: null,
    ...patch,
  };
}

const context = (chats: readonly ChatRecord[], more: Partial<ChannelContext> = {}): ChannelContext => ({
  chats,
  takenByOthers: new Set<TelegramChatId>(),
  routed: new Set<TelegramChatId>(),
  ...more,
});

const config = (patch: Partial<TelegramChannelConfig>): TelegramChannelConfig => ({
  ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  ...patch,
});

const everyDay = [1, 2, 3, 4, 5, 6, 7];

describe('the slots of the channel (ADR 0080 § 1)', () => {
  it('takes the default, 19 h every day', () => {
    expect(channelRefusal(DEFAULT_TELEGRAM_CHANNEL_CONFIG, context([]))).toBeNull();
  });

  it('refuses a fifth post on one day, switched-off slots not counted', () => {
    const slots = [8, 12, 16, 20, 23].map((hour) => ({ minute: hour * 60, days: [3], enabled: true }));
    expect(channelRefusal(config({ slots }), context([]))?.kind).toBe('too_many_posts');
    const fourOn = slots.map((slot, rank) => ({ ...slot, enabled: rank !== 1 }));
    // 8 h, 16 h, 20 h, 23 h: four, but 20 h and 23 h are three hours apart exactly, which passes.
    expect(channelRefusal(config({ slots: fourOn }), context([]))).toBeNull();
  });

  it('refuses two posts of one day under three hours apart, and names them', () => {
    const refusal = channelRefusal(
      config({
        slots: [
          { minute: 19 * 60, days: everyDay, enabled: true },
          { minute: 21 * 60, days: [5], enabled: true },
        ],
      }),
      context([]),
    );
    expect(refusal?.kind).toBe('slots_too_close');
    expect(refusal?.message).toContain('vendredi');
  });

  it('counts the gap across midnight, Sunday to Monday too', () => {
    const late = { minute: 23 * 60, days: [7], enabled: true };
    const early = { minute: 60, days: [1], enabled: true };
    expect(channelRefusal(config({ slots: [late, early] }), context([]))?.kind).toBe('slots_too_close');
    expect(channelRefusal(config({ slots: [late, { ...early, minute: 2 * 60 }] }), context([]))).toBeNull();
  });

  it('sorts the days and the slots it stores', () => {
    const stored = normalizedConfig(
      config({
        slots: [
          { minute: 20 * 60, days: [7, 1], enabled: true },
          { minute: 9 * 60, days: [2], enabled: false },
        ],
      }),
    );
    expect(stored.slots.map((slot) => [slot.minute, slot.days])).toEqual([
      [540, [2]],
      [1200, [1, 7]],
    ]);
  });
});

describe('the redirect links (ADR 0080 § 4)', () => {
  const link = (name: string, url: string) => ({ id: newId(RedirectLinkIdSchema), name, url });

  it('reads a whole https address only', () => {
    expect(isRedirectUrl('https://example.test/messa-tg')).toBe(true);
    expect(isRedirectUrl('http://example.test/x')).toBe(false);
    expect(isRedirectUrl('https://example.test/a b')).toBe(false);
    expect(isRedirectUrl('https://user:pw@example.test/')).toBe(false);
    expect(isRedirectUrl('https://localhost/')).toBe(false);
    expect(isRedirectUrl(`https://example.test/${'a'.repeat(2048)}`)).toBe(false);
  });

  it('refuses a text of the link that holds an address', () => {
    const parsed = TelegramChannelConfigSchema.safeParse(config({ linkLabel: 'Clique www.exemple.test' }));
    expect(parsed.success).toBe(false);
  });

  it('refuses two links of one name or one address', () => {
    const a = link('Telegram', 'https://example.test/a');
    expect(
      channelRefusal(config({ links: [a, link('telegram', 'https://example.test/b')] }), context([]))?.kind,
    ).toBe('link_name_taken');
    expect(
      channelRefusal(config({ links: [a, link('Insta', 'https://example.test/a')] }), context([]))?.kind,
    ).toBe('link_url_taken');
  });

  it('refuses a link of the channel that is not in the list', () => {
    const a = link('Telegram', 'https://example.test/a');
    expect(
      channelRefusal(config({ links: [a], channelLinkId: newId(RedirectLinkIdSchema) }), context([]))?.kind,
    ).toBe('channel_link_unknown');
    expect(channelRefusal(config({ links: [a], channelLinkId: a.id }), context([]))).toBeNull();
  });
});

describe('the channel chosen (ADR 0057 § 2, ADR 0080 § 6.1)', () => {
  it('takes a channel the bot sits in', () => {
    const mine = chat('Canal test');
    expect(channelRefusal(config({ chatId: mine.id }), context([mine]))).toBeNull();
  });

  it('refuses a group, another creator’s channel and a channel that receives alerts', () => {
    const group = chat('Équipe', { kind: 'supergroup' });
    const taken = chat('Canal B');
    const routed = chat('Canal C');
    const all = context([group, taken, routed], {
      takenByOthers: new Set([taken.id]),
      routed: new Set([routed.id]),
    });
    expect(channelRefusal(config({ chatId: group.id }), all)?.kind).toBe('chat_not_channel');
    expect(channelRefusal(config({ chatId: taken.id }), all)?.kind).toBe('chat_taken');
    expect(channelRefusal(config({ chatId: routed.id }), all)?.kind).toBe('chat_routed');
    expect(channelRefusal(config({ chatId: newId(TelegramChatIdSchema) }), all)?.kind).toBe('chat_unknown');
  });

  it('offers the channels only, with what keeps one out', () => {
    const group = chat('Équipe', { kind: 'group' });
    const readOnly = chat('Canal lecture', { canPost: false });
    const taken = chat('Autre canal');
    const choices = channelChoices(context([group, readOnly, taken], { takenByOthers: new Set([taken.id]) }));
    expect(choices.map((choice) => [choice.title, choice.canPost, choice.takenByOther])).toEqual([
      ['Autre canal', true, true],
      ['Canal lecture', false, false],
    ]);
  });
});

describe('what keeps her posts in (ADR 0080 § 4.4)', () => {
  it('says everything a fresh setting lacks', () => {
    expect(channelWarnings(DEFAULT_TELEGRAM_CHANNEL_CONFIG, [], false)).toEqual([
      'no_bot',
      'no_channel',
      'no_link',
    ]);
  });

  it('says the channel the bot left, or where it cannot post', () => {
    const gone = chat('Canal', { membership: 'left' });
    const mute = chat('Canal 2', { canPost: false });
    const linkId = newId(RedirectLinkIdSchema);
    const links = [{ id: linkId, name: 'Telegram', url: 'https://example.test/a' }];
    const base = { links, channelLinkId: linkId };
    expect(channelWarnings(config({ ...base, chatId: gone.id }), [gone], true)).toEqual(['channel_gone']);
    expect(channelWarnings(config({ ...base, chatId: mute.id }), [mute], true)).toEqual(['bot_cannot_post']);
    expect(
      channelWarnings(
        config({ ...base, chatId: mute.id, slots: [{ minute: 0, days: [1], enabled: false }] }),
        [{ ...mute, canPost: true }],
        true,
      ),
    ).toEqual(['no_slot']);
  });
});
