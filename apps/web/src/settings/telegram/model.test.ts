import {
  CreatorIdSchema,
  TelegramBotIdSchema,
  TelegramChatIdSchema,
  newId,
  type TelegramBot,
  type TelegramChat,
  type TelegramOverview,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  botLine,
  chatChoices,
  chatLine,
  coverOf,
  deliveryLabel,
  goneChats,
  knownChatIds,
  goneLine,
  healthOf,
  initials,
  looksLikeToken,
  newChats,
  routeState,
  setTopicsOfChat,
  suggestedUsername,
  toggleRoute,
  topicsOfChat,
  whenLabel,
} from './model';

// Invented data: no real group, bot or creator.
const creator = newId(CreatorIdSchema);
const groupA = newId(TelegramChatIdSchema);
const groupB = newId(TelegramChatIdSchema);

function chat(id: TelegramChat['id'], title: string, patch: Partial<TelegramChat> = {}): TelegramChat {
  return {
    id,
    title,
    kind: 'group',
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
    username: 'demo_alertes_bot',
    displayName: 'Démo Alertes',
    state: 'active',
    lastPolledAt: null,
    chats,
    ...patch,
  };
}

function overview(patch: Partial<TelegramOverview> = {}): TelegramOverview {
  return {
    bots: [bot([chat(groupA, 'Astreinte'), chat(groupB, 'Ventes')])],
    routes: [{ creatorId: null, topic: 'urgent', chatId: groupA }],
    coverage: [{ creatorId: creator, displayName: 'Démo', urgentReachable: true, topicsWithoutGroup: [] }],
    version: 3,
    ...patch,
  };
}

describe('routing', () => {
  it('shows a creator the groups she already gets through « toutes les créatrices »', () => {
    const routes = overview().routes;
    expect(routeState(routes, 'all', 'urgent', groupA)).toBe('on');
    expect(routeState(routes, creator, 'urgent', groupA)).toBe('inherited');
    expect(routeState(routes, creator, 'urgent', groupB)).toBe('off');
  });

  it('flips one chip and keeps every other route', () => {
    const routes = overview().routes;
    const added = toggleRoute(routes, creator, 'urgent', groupB);
    expect(added).toEqual([...routes, { creatorId: creator, topic: 'urgent', chatId: groupB }]);
    expect(toggleRoute(added, creator, 'urgent', groupB)).toEqual(routes);
  });

  it('sets the topics of one group for every creator, in the tab order', () => {
    const routes = [
      ...overview().routes,
      { creatorId: creator, topic: 'sale' as const, chatId: groupA },
      { creatorId: null, topic: 'info' as const, chatId: groupB },
    ];
    const next = setTopicsOfChat(routes, groupA, ['sale', 'important']);
    expect(topicsOfChat(next, groupA)).toEqual(['important', 'sale']);
    // Her own route and the other group are untouched.
    expect(next).toContainEqual({ creatorId: creator, topic: 'sale', chatId: groupA });
    expect(next).toContainEqual({ creatorId: null, topic: 'info', chatId: groupB });
  });
});

describe('health and coverage', () => {
  it('says all is well, then names what breaks first', () => {
    expect(healthOf(overview())).toMatchObject({ tone: 'ok', botCount: 1, groupCount: 2 });
    expect(healthOf(overview({ bots: [] }))).toMatchObject({ tone: 'empty' });
    // A refused bot is a warning, not an urgency: red is kept for urgent alerts that reach no one.
    expect(healthOf(overview({ bots: [bot([], { state: 'refused' })] }))).toMatchObject({
      tone: 'warn',
      label: 'Un bot demande ton attention',
      fix: 'bots',
    });
    expect(
      healthOf(
        overview({
          coverage: [
            { creatorId: creator, displayName: 'Démo', urgentReachable: false, topicsWithoutGroup: [] },
          ],
        }),
      ),
    ).toMatchObject({ tone: 'bad', label: 'Les urgences n’arrivent nulle part', fix: 'alerts' });
    expect(
      healthOf(
        overview({
          bots: [bot([chat(groupA, 'Astreinte')], { state: 'refused' })],
          coverage: [
            { creatorId: creator, displayName: 'Démo', urgentReachable: false, topicsWithoutGroup: [] },
          ],
        }),
      ),
    ).toMatchObject({ tone: 'bad', fix: 'bots' });
    expect(
      healthOf(
        overview({ bots: [bot([chat(groupA, 'Astreinte', { lastError: 'Le bot ne peut plus écrire.' })])] }),
      ),
    ).toMatchObject({ tone: 'warn' });
  });

  it('keeps the latest send time', () => {
    const bots = [
      bot([
        chat(groupA, 'A', { lastSentAt: '2026-10-17T20:00:00.000Z' }),
        chat(groupB, 'B', { lastSentAt: '2026-10-17T22:00:00.000Z' }),
      ]),
    ];
    expect(healthOf(overview({ bots })).lastSentAt).toBe('2026-10-17T22:00:00.000Z');
  });

  it('names the creators no urgent alert reaches', () => {
    expect(coverOf(overview())).toMatchObject({ isOk: true, title: 'Quelqu’un est prévenu, même la nuit' });
    expect(coverOf(overview()).sub).toContain('1 groupe.');
    const bad = coverOf(
      overview({
        coverage: [
          { creatorId: creator, displayName: 'Démo', urgentReachable: false, topicsWithoutGroup: [] },
        ],
      }),
    );
    expect(bad).toMatchObject({ isOk: false });
    expect(bad.sub).toContain('(Démo)');
    expect(coverOf(overview({ bots: [] })).sub).toContain('Ajoute un bot');
  });

  it('sends to the broken bot, not to a group to choose, when no group can be written to', () => {
    const coverage = [
      { creatorId: creator, displayName: 'Démo', urgentReachable: false, topicsWithoutGroup: [] },
    ];
    const refused = coverOf(
      overview({ bots: [bot([chat(groupA, 'Astreinte')], { state: 'refused' })], coverage }),
    );
    expect(refused).toEqual({
      isOk: false,
      title: 'Les alertes ne partent plus',
      sub: 'Telegram refuse le jeton d’un bot : remplace-le dans Bots et groupes.',
    });
    expect(refused.sub).not.toContain('Choisis');
    const muted = coverOf(
      overview({ bots: [bot([chat(groupA, 'Astreinte', { canPost: false })])], coverage }),
    );
    expect(muted.sub).toContain('administrateur');
  });

  it('never offers a group the bot cannot post in', () => {
    const choices = chatChoices([
      bot([chat(groupA, 'Muet', { canPost: false })]),
      bot([chat(groupB, 'Ouvert')], { state: 'conflict' }),
    ]);
    expect(choices.map((c) => c.isReachable)).toEqual([false, false]);
  });
});

describe('a group the bot is out of (REG-28)', () => {
  it('is no routing choice nor a new group, but listed to remove, with why', () => {
    const left = chat(groupA, 'Ancien', { membership: 'left', canPost: false });
    const kicked = chat(groupB, 'Banni', { membership: 'kicked', canPost: false, kind: 'supergroup' });
    const owner = bot([left, kicked, chat(newId(TelegramChatIdSchema), 'Vivant')]);
    expect(chatChoices([owner]).map((c) => c.chat.title)).toEqual(['Vivant']);
    expect(newChats(owner, new Set()).map((c) => c.title)).toEqual(['Vivant']);
    // Added back while the sheet waits, a group it was out of counts as found.
    expect([...knownChatIds(owner)]).toEqual([owner.chats[2]?.id]);
    const back = bot([{ ...left, membership: 'member', canPost: true }], { id: owner.id });
    expect(newChats(back, knownChatIds(owner)).map((c) => c.title)).toEqual(['Ancien']);
    expect(goneChats(owner)).toEqual([left, kicked]);
    expect(goneLine(left)).toBe('Groupe · le bot n’est plus dans ce groupe');
    expect(goneLine(kicked)).toBe('Supergroupe · le bot a été exclu de ce groupe');
  });

  it('keeps the strip amber while one waits to be removed', () => {
    const kicked = chat(groupB, 'Banni', { membership: 'kicked', canPost: false });
    expect(healthOf(overview({ bots: [bot([chat(groupA, 'Astreinte'), kicked])] }))).toMatchObject({
      tone: 'warn',
      label: 'Un groupe demande ton attention',
      fix: 'bots',
    });
  });

  it('sends to Bots et groupes, not to a choice of group, when the bot is out of its only group', () => {
    const missing = [
      { creatorId: creator, displayName: 'Démo', urgentReachable: false, topicsWithoutGroup: [] },
    ];
    const out = coverOf(
      overview({
        bots: [bot([chat(groupA, 'Astreinte', { membership: 'kicked', canPost: false })])],
        coverage: missing,
      }),
    );
    expect(out).toMatchObject({ isOk: false, title: 'Les alertes ne partent plus' });
    expect(out.sub).toBe(
      'Le bot n’est plus dans aucun de ses groupes : rajoute-le à un groupe dans Bots et groupes.',
    );
    expect(out.sub).not.toContain('Choisis');
    const none = coverOf(overview({ bots: [bot([])], coverage: missing }));
    expect(none.sub).toBe('Le bot n’est dans aucun groupe : ajoute-le à un groupe dans Bots et groupes.');
  });
});

describe('lines', () => {
  const now = new Date(2026, 9, 17, 23, 30);

  it('says when a group last got a message, or why it cannot', () => {
    const [ok] = chatChoices([
      bot([chat(groupA, 'A', { lastSentAt: new Date(2026, 9, 17, 23, 12).toISOString() })]),
    ]);
    expect(ok === undefined ? '' : chatLine(ok, now).text).toBe('Groupe · dernier envoi à 23 h 12');
    const [mute] = chatChoices([bot([chat(groupA, 'A', { canPost: false })])]);
    expect(mute === undefined ? null : chatLine(mute, now)).toEqual({
      text: 'Groupe · le bot n’a pas le droit d’y écrire',
      isWarning: true,
    });
    expect(whenLabel(new Date(2026, 9, 16, 8, 0).toISOString(), now)).toBe('hier à 08 h 00');
    expect(whenLabel(new Date(2026, 9, 15, 8, 0).toISOString(), now)).toBe('le 15/10');
  });

  it('reads a bot’s state in words', () => {
    expect(botLine(bot([], { lastPolledAt: new Date(now.getTime() - 12_000).toISOString() })).text).toBe(
      '@demo_alertes_bot',
    );
    expect(botLine(bot([], { state: 'refused' }))).toEqual({
      text: 'Telegram refuse ce jeton : remplace-le',
      isWarning: true,
    });
  });

  it('ends a journal line with who took it, else its delivery', () => {
    const base = {
      id: '0b9a1d8e-6f39-4f39-9f4a-2b1c3d4e5f60',
      topic: 'urgent' as const,
      creatorId: null,
      chatTitle: 'Astreinte',
      summary: 'Possible mineur',
      createdAt: '2026-10-17T22:00:00.000Z',
      sentAt: null,
    };
    expect(deliveryLabel({ ...base, status: 'sent', closedBy: 'Théo' }).text).toBe('Pris en main par Théo');
    expect(deliveryLabel({ ...base, status: 'failed', closedBy: null })).toEqual({
      text: 'Non livrée',
      isOk: false,
    });
  });
});

describe('the sheet', () => {
  it('counts only the groups the bot entered while it waited', () => {
    const b = bot([chat(groupA, 'Ancien'), chat(groupB, 'Nouveau')]);
    expect(newChats(b, new Set([groupA])).map((c) => c.title)).toEqual(['Nouveau']);
    expect(newChats(undefined, new Set())).toEqual([]);
  });

  it('checks the shape of a token before sending it', () => {
    expect(looksLikeToken(` 1234567:AA${'x'.repeat(33)} `)).toBe(true);
    expect(looksLikeToken('sk-not-a-bot-token')).toBe(false);
  });

  it('suggests an identifier @BotFather accepts', () => {
    expect(suggestedUsername('Nirvana Alertes')).toBe('nirvana_alertes_bot');
    expect(suggestedUsername('Équipe nuit !')).toBe('equipe_nuit_bot');
    expect(suggestedUsername('   ')).toBe('nirvana_bot');
    // @BotFather wants a letter first, and one « bot » at the end.
    expect(suggestedUsername('3h Alertes')).toBe('nirvana_3h_alertes_bot');
    expect(suggestedUsername('Nirvana Bot')).toBe('nirvana_bot');
    expect(suggestedUsername('Robot')).toBe('robot');
    expect(suggestedUsername('A'.repeat(40))).toBe(`${'a'.repeat(28)}_bot`);
    expect(suggestedUsername('Bot')).toBe('nirvana_bot');
  });

  it('draws two letters for a group, an emoji as one', () => {
    expect(initials('Astreinte nuit')).toBe('AN');
    expect(initials('équipe')).toBe('É');
    expect(initials('🔥 Ventes')).toBe('🔥');
    expect(initials('💰 Ventes')).toBe('💰');
    expect(initials('')).toBe('?');
  });
});
