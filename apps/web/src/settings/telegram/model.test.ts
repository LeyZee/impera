import {
  TelegramBotIdSchema,
  TelegramChatIdSchema,
  newId,
  type TelegramBot,
  type TelegramChat,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  botLine,
  chatChoices,
  chatLine,
  goneChats,
  goneLine,
  initials,
  knownChatIds,
  looksLikeToken,
  newChats,
  plural,
  suggestedUsername,
  whenLabel,
} from './model';

// Invented data: no real channel, bot or creator.
const groupA = newId(TelegramChatIdSchema);
const groupB = newId(TelegramChatIdSchema);

function chat(id: TelegramChat['id'], title: string, patch: Partial<TelegramChat> = {}): TelegramChat {
  return {
    id,
    title,
    kind: 'channel',
    membership: 'member',
    canPost: true,
    lastSentAt: null,
    lastError: null,
    ...patch,
  };
}

function bot(chats: TelegramChat[], patch: Partial<TelegramBot> = {}): TelegramBot {
  return {
    id: newId(TelegramBotIdSchema),
    username: 'demo_canal_bot',
    displayName: 'Démo Canal',
    state: 'active',
    lastPolledAt: null,
    chats,
    ...patch,
  };
}

describe('a channel the bot is out of (REG-28)', () => {
  it('is no choice nor a new channel, but listed to remove, with why', () => {
    const left = chat(groupA, 'Ancien', { membership: 'left', canPost: false });
    const kicked = chat(groupB, 'Banni', { membership: 'kicked', canPost: false });
    const owner = bot([left, kicked, chat(newId(TelegramChatIdSchema), 'Vivant')]);
    expect(chatChoices([owner]).map((c) => c.chat.title)).toEqual(['Vivant']);
    expect(newChats(owner, new Set()).map((c) => c.title)).toEqual(['Vivant']);
    // Added back while the sheet waits, a channel it was out of counts as found.
    expect([...knownChatIds(owner)]).toEqual([owner.chats[2]?.id]);
    const back = bot([{ ...left, membership: 'member', canPost: true }], { id: owner.id });
    expect(newChats(back, knownChatIds(owner)).map((c) => c.title)).toEqual(['Ancien']);
    expect(goneChats(owner)).toEqual([left, kicked]);
    expect(goneLine(left)).toBe('Canal · le bot n’est plus ici');
    expect(goneLine(kicked)).toBe('Canal · le bot a été exclu ici');
  });
});

describe('lines', () => {
  const now = new Date(2026, 9, 17, 23, 30);

  it('says when a channel last got a post, or why it cannot', () => {
    const [ok] = chatChoices([
      bot([chat(groupA, 'A', { lastSentAt: new Date(2026, 9, 17, 23, 12).toISOString() })]),
    ]);
    expect(ok === undefined ? '' : chatLine(ok, now).text).toBe('Canal · dernier post à 23 h 12');
    const [mute] = chatChoices([bot([chat(groupA, 'A', { canPost: false })])]);
    expect(mute === undefined ? null : chatLine(mute, now)).toEqual({
      text: 'Canal · le bot n’a pas le droit d’y publier',
      isWarning: true,
    });
    expect(whenLabel(new Date(2026, 9, 16, 8, 0).toISOString(), now)).toBe('hier à 08 h 00');
    expect(whenLabel(new Date(2026, 9, 15, 8, 0).toISOString(), now)).toBe('le 15/10');
  });

  it('reads a bot’s state in words', () => {
    expect(botLine(bot([], { lastPolledAt: new Date(now.getTime() - 12_000).toISOString() })).text).toBe(
      '@demo_canal_bot',
    );
    expect(botLine(bot([], { state: 'refused' }))).toEqual({
      text: 'Telegram refuse ce jeton : remplace-le',
      isWarning: true,
    });
  });

  it('says « canaux », never « canals »', () => {
    expect(plural(1, 'canal', 'canaux')).toBe('1 canal');
    expect(plural(2, 'canal', 'canaux')).toBe('2 canaux');
    expect(plural(2, 'bot')).toBe('2 bots');
  });
});

describe('the sheet', () => {
  it('counts only the channels the bot entered while it waited', () => {
    const b = bot([chat(groupA, 'Ancien'), chat(groupB, 'Nouveau')]);
    expect(newChats(b, new Set([groupA])).map((c) => c.title)).toEqual(['Nouveau']);
    expect(newChats(undefined, new Set())).toEqual([]);
  });

  it('checks the shape of a token before sending it', () => {
    expect(looksLikeToken(` 1234567:AA${'x'.repeat(33)} `)).toBe(true);
    expect(looksLikeToken('sk-not-a-bot-token')).toBe(false);
  });

  it('suggests an identifier @BotFather accepts', () => {
    expect(suggestedUsername('Impera Alertes')).toBe('impera_alertes_bot');
    expect(suggestedUsername('Équipe nuit !')).toBe('equipe_nuit_bot');
    expect(suggestedUsername('   ')).toBe('impera_bot');
    // @BotFather wants a letter first, and one « bot » at the end.
    expect(suggestedUsername('3h Alertes')).toBe('impera_3h_alertes_bot');
    expect(suggestedUsername('Impera Bot')).toBe('impera_bot');
    expect(suggestedUsername('Robot')).toBe('robot');
    expect(suggestedUsername('A'.repeat(40))).toBe(`${'a'.repeat(28)}_bot`);
    expect(suggestedUsername('Bot')).toBe('impera_bot');
  });

  it('draws two letters for a channel, an emoji as one', () => {
    expect(initials('Astreinte nuit')).toBe('AN');
    expect(initials('équipe')).toBe('É');
    expect(initials('🔥 Ventes')).toBe('🔥');
    expect(initials('💰 Ventes')).toBe('💰');
    expect(initials('')).toBe('?');
  });
});
