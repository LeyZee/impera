import { describe, expect, it } from 'vitest';

import {
  messageOf,
  momentOf,
  scriptsOf,
  sentStepsOf,
  snapshotOf,
  transactionOf,
  type OwnMessages,
} from '../mapping';
import type { RevealAnswer } from '../wire';

/** Invented, evidently fake values (CLAUDE.md): nothing here comes from a capture. */
const AT = '2026-10-01T10:00:00.000Z';
const CONVERSATION = { platform: 'reveal', id: 'conv_test' } as const;
const NOBODY: OwnMessages = { ids: new Set(), botDisplayName: null };

type MessageItem = RevealAnswer<'messages.list'>['data'][number];
type Media = MessageItem['medias'][number];
type ScriptItem = RevealAnswer<'scripts.list'>['data'][number];
type SequenceItem = RevealAnswer<'scriptSequences.list'>[number];

function media(id: string, type: Media['type'] = 'photo'): Media {
  const url = `https://files.test/${id}`;
  return {
    id,
    blurhash: 'L00000',
    createdAt: AT,
    updatedAt: AT,
    url,
    smallUrl: url,
    mediumUrl: url,
    largeUrl: url,
    type,
    isArchived: false,
    modelId: 'model_test',
  };
}

function message(input: {
  id?: string;
  content?: string;
  fanId?: string;
  displayName?: string;
  bundle?: { price: number; isPaid?: true; media: Media[] };
  medias?: Media[];
}): MessageItem {
  const { bundle } = input;
  return {
    message: {
      id: input.id ?? 'msg_test',
      createdAt: AT,
      updatedAt: AT,
      isUnread: false,
      content: input.content ?? 'Message de test',
      type: 'default',
      ...(bundle === undefined ? {} : { bundleId: 'bundle_test' }),
    },
    medias: input.medias ?? [],
    ...(bundle === undefined
      ? {}
      : {
          bundleWithMedias: {
            bundle: {
              id: 'bundle_test',
              createdAt: AT,
              updatedAt: AT,
              price: bundle.price,
              type: 'media',
              ...(bundle.isPaid === undefined ? {} : { isPaid: bundle.isPaid, transactionId: 'tx_test' }),
              modelId: 'model_test',
              memberId: 'fan_test',
            },
            medias: bundle.media,
            teasingMedias: [],
          },
        }),
    authorMessage:
      input.fanId === undefined
        ? { displayName: input.displayName ?? 'Créatrice de test' }
        : { displayName: 'fan_test_01', memberId: input.fanId },
    reactions: [],
    replyTo: null,
    storyReply: null,
  };
}

function step(
  id: string,
  input: { name?: string; price?: number; media?: Media[] } = {},
): ScriptItem['script'] {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    name: input.name ?? `Étape ${id}`,
    content: `Texte de ${id}`,
    ...(input.price === undefined ? {} : { price: input.price }),
  };
}

function loose(id: string, input: { name?: string; price?: number; media?: Media[] } = {}): ScriptItem {
  return {
    script: step(id, input),
    tags: [],
    medias: input.media ?? [],
    teasingMedias: [],
    conversations: [],
  };
}

function sequence(
  id: string,
  name: string,
  steps: { id: string; index: number; price?: number; media?: Media[] }[],
) {
  const item: SequenceItem = {
    sequence: { id, name, createdAt: AT, updatedAt: AT },
    steps: steps.map((s) => ({
      step: { id: `${id}_step_${String(s.index)}`, stepIndex: s.index },
      script: step(s.id, s.price === undefined ? {} : { price: s.price }),
      medias: s.media ?? [],
      teasingMedias: [],
      tags: [],
    })),
  };
  return item;
}

describe('messageOf (reveal-connector-spec.md § 4)', () => {
  it('reads an incoming text: the fan wrote it', () => {
    const mapped = messageOf(message({ fanId: 'fan_test', content: 'Salut' }), CONVERSATION, NOBODY);
    expect(mapped).toMatchObject({ direction: 'inbound', author: 'fan', text: 'Salut', priceMinor: null });
    expect(mapped.senderLabel).toBeUndefined();
  });

  it('reads an outgoing text of the « bot » member by its id first, whatever name it shows', () => {
    const own = { ids: new Set(['msg_ours']), botDisplayName: 'Chatteur bot' };
    const mapped = messageOf(message({ id: 'msg_ours', displayName: 'Autre nom' }), CONVERSATION, own);
    expect(mapped).toMatchObject({ direction: 'outbound', author: 'ai', senderLabel: 'Autre nom' });
  });

  it('falls back to the « bot » member’s display name when the id is not known (a lost answer)', () => {
    const own = { ids: new Set<string>(), botDisplayName: 'Chatteur bot' };
    expect(messageOf(message({ displayName: 'Chatteur bot' }), CONVERSATION, own).author).toBe('ai');
  });

  it('reads a message the creator or a chatter wrote as outgoing, but not ours', () => {
    const own = { ids: new Set(['msg_ours']), botDisplayName: 'Chatteur bot' };
    for (const displayName of ['Créatrice de test', 'Chatteur humain']) {
      expect(messageOf(message({ displayName }), CONVERSATION, own)).toMatchObject({
        direction: 'outbound',
        author: 'human',
        senderLabel: displayName,
      });
    }
    // Without the bot's name, only ids count.
    expect(messageOf(message({ displayName: 'Chatteur bot' }), CONVERSATION, NOBODY).author).toBe('human');
  });

  it('reads a locked bundle: priced, its media locked, not paid', () => {
    const mapped = messageOf(
      message({ medias: [media('m_free')], bundle: { price: 1500, media: [media('m_sold', 'video')] } }),
      CONVERSATION,
      NOBODY,
    );
    expect(mapped).toMatchObject({ priceMinor: 1500, currency: 'EUR', isPaid: false });
    expect(mapped.media).toEqual([
      { ref: { platform: 'reveal', id: 'm_free' }, kind: 'image', isLocked: false },
      { ref: { platform: 'reveal', id: 'm_sold' }, kind: 'video', isLocked: true },
    ]);
  });

  it('reads a bought bundle: paid, its media unlocked', () => {
    const mapped = messageOf(
      message({ bundle: { price: 500, isPaid: true, media: [media('m_sold')] } }),
      CONVERSATION,
      NOBODY,
    );
    expect(mapped).toMatchObject({ priceMinor: 500, isPaid: true });
    expect(mapped.media.map((m) => m.isLocked)).toEqual([false]);
  });
});

describe('momentOf (spec § 6)', () => {
  it('reads ☀️ and 🌙 in the name, with or without the variation selector', () => {
    expect(momentOf('SCRIPT 1 | ☀️', [])).toBe('day');
    expect(momentOf('SCRIPT 1 | ☀', [])).toBe('day');
    expect(momentOf('SCRIPT 2 | 🌙', [])).toBe('night');
  });

  it('gives no moment for a name with neither, or with both', () => {
    expect(momentOf('Script de test', [])).toBeNull();
    expect(momentOf('☀️ et 🌙', ['Dossier ☀️'])).toBeNull();
  });

  it('falls back to the vault folders of its media when they agree', () => {
    expect(momentOf('Script de test', ['SCRIPT 1 | ☀️', 'Divers', 'SCRIPT 1 | ☀️'])).toBe('day');
    expect(momentOf('Script de test', ['SCRIPT 2 | 🌙'])).toBe('night');
    expect(momentOf('Script de test', ['SCRIPT 1 | ☀️', 'SCRIPT 2 | 🌙'])).toBeNull();
    expect(momentOf('Script de test', ['Divers'])).toBeNull();
  });
});

describe('scriptsOf (spec § 6)', () => {
  it('makes a sequence one script, its steps in `stepIndex` order, a missing price free', () => {
    const [script] = scriptsOf(
      [
        sequence('seq_1', 'Séquence de test 🌙', [
          { id: 'step_b', index: 1, price: 1500 },
          { id: 'step_a', index: 0, media: [media('m_1')] },
        ]),
      ],
      [],
      () => null,
    );
    expect(script).toMatchObject({ ref: { id: 'seq_1' }, name: 'Séquence de test 🌙', moment: 'night' });
    expect(script?.steps.map((s) => [s.ref.id, s.index, s.priceMinor])).toEqual([
      ['step_a', 0, 0],
      ['step_b', 1, 1500],
    ]);
    expect(script?.steps[0]?.media).toEqual([{ ref: { platform: 'reveal', id: 'm_1' }, kind: 'image' }]);
  });

  it('makes a step in no sequence a script of one step, and leaves an empty sequence out', () => {
    const scripts = scriptsOf(
      [sequence('seq_empty', 'Vide', []), sequence('seq_1', 'Séquence', [{ id: 'step_a', index: 0 }])],
      [loose('step_a'), loose('step_alone', { price: 3000, media: [media('m_9')] })],
      (mediaId) => (mediaId === 'm_9' ? 'SCRIPT 1 | ☀️' : null),
    );
    expect(scripts.map((s) => [s.ref.id, s.steps.length, s.moment])).toEqual([
      ['seq_1', 1, null],
      ['step_alone', 1, 'day'],
    ]);
  });
});

describe('sentStepsOf (spec § 6, ADR 0018 § 5)', () => {
  it('lists a step sent in the conversation, bought when one of its sends was paid', () => {
    const sent = (conversations: ScriptItem['conversations']): ScriptItem => ({
      ...loose('x'),
      conversations,
    });
    const items = [
      { ...sent([{ id: 'conv_test', hasBundle: true, isPaid: true }]), script: step('step_bought') },
      { ...sent([{ id: 'conv_test', hasBundle: true, isPaid: false }]), script: step('step_sent') },
      { ...sent([]), script: step('step_never') },
    ];
    expect(sentStepsOf(items)).toEqual([
      { stepRef: { platform: 'reveal', id: 'step_bought' }, isPaid: true },
      { stepRef: { platform: 'reveal', id: 'step_sent' }, isPaid: false },
    ]);
  });
});

describe('snapshotOf and transactionOf (spec § 4)', () => {
  it('names the fan by his first name, else his user name; unread is 1 or 0', () => {
    const item = (firstname: string | undefined, unread: boolean): RevealAnswer<'conversations.get'> => ({
      conversation: {
        id: 'conv_test',
        modelIsUnread: unread,
        memberIsUnread: false,
        memberLastReadAt: null,
        isBlockedByModel: false,
        isPinned: false,
        isExcludedFromMassDM: false,
        isTeamPinned: false,
        assignedInbox: 1,
        lastMessageAt: AT,
        createdAt: AT,
        updatedAt: AT,
        lastMessageId: null,
        memberId: 'fan_test',
        modelId: 'model_test',
        ...(firstname === undefined ? {} : { memberFirstname: firstname }),
      },
      lastMessageAuthor: {},
      lastMessage: null,
      lastMessageHasMedia: false,
      member: {
        id: 'fan_test',
        authorMessageId: 'author_fan_test',
        createdAt: AT,
        updatedAt: AT,
        vipUntil: null,
        userName: 'fan_test_01',
        userId: 'user_fan_test',
      },
      model: {
        id: 'model_test',
        avatarUrl: '',
        bannerUrl: '',
        avatarThumbUrl: '',
        bannerPreviewUrl: '',
        displayName: 'Créatrice de test',
        description: '',
        userName: 'creatrice_test',
        incomingMediaPrice: 0,
        isVisible: true,
        engagementPopupMessage: '',
        isAI: false,
        requireCardVerificationForFreeSubscription: false,
        isOfficialAccount: false,
      },
      memberTotalSpent: 0,
      memberLastSeenAt: null,
      modelCreatorNote: '',
      isExcludedFromMassDM: false,
    });
    expect(snapshotOf(item('Prénom01', true))).toMatchObject({
      fanRef: { id: 'fan_test' },
      fanDisplayName: 'Prénom01',
      unreadCount: 1,
      lastMessageAt: AT,
    });
    expect(snapshotOf(item(undefined, false))).toMatchObject({
      fanDisplayName: 'fan_test_01',
      unreadCount: 0,
    });
  });

  it('reads a transaction’s kind, an unknown one as `other`', () => {
    const kinds = ['bundle', 'tip', 'subscription', 'mystère'].map(
      (type) =>
        transactionOf({
          id: 'tx_test',
          createdAt: AT,
          updatedAt: AT,
          amount: 1000,
          status: 'paid',
          type,
          modelId: 'model_test',
          memberId: 'fan_test',
          agencyMemberId: null,
          platformFee: 0,
          platformPercentage: 0,
          platformRevenue: 0,
          agencyFee: 0,
          agencyPercentage: 0,
          processorFee: 0,
          vatFee: 0,
          vatPercentage: 0,
          modelRevenue: 0,
          isProcessedSuccessfully: true,
          uid: 'uid_test',
          providerTransactionId: 'provider_test',
          countryCode: 'FR',
          member: { userName: 'fan_test_01' },
        }).kind,
    );
    expect(kinds).toEqual(['ppv', 'tip', 'subscription', 'other']);
  });
});
