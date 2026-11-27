import { describe, expect, it } from 'vitest';

import { ppvStatsOf, snapshotOf } from '../mapping';
import { REVEAL_ENDPOINTS } from '../wire';

/**
 * The shapes Reveal answers since 2026-11-15 (relevé en lecture seule, formes seulement) : invented, evidently fake
 * values (CLAUDE.md), nothing copied from a response.
 */
const AT = '2026-10-01T10:00:00.000Z';

const MODEL = {
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
};

const conversationItem = (extra: Record<string, unknown>) => ({
  conversation: {
    id: 'conv_test',
    modelIsUnread: false,
    memberIsUnread: false,
    isBlockedByModel: false,
    isPinned: false,
    isExcludedFromMassDM: false,
    isTeamPinned: false,
    assignedInbox: 1,
    lastMessageAt: AT,
    createdAt: AT,
    updatedAt: AT,
    memberId: 'fan_test',
    modelId: 'model_test',
  },
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
  model: MODEL,
  memberTotalSpent: 0,
  memberLastSeenAt: null,
  modelCreatorNote: '',
  isExcludedFromMassDM: false,
  ...extra,
});

describe('Reveal shapes of 2026-11-15', () => {
  it('reads a conversation without any message: no author, no last message, no read date', () => {
    const page = REVEAL_ENDPOINTS['conversations.list'].shape.parse({
      data: [conversationItem({})],
      pageInfo: { hasNextPage: false, endCursor: '' },
    });
    const [item] = page.data;
    if (item === undefined) throw new Error('one item expected');
    expect(page.pageInfo.endCursor).toBeNull();
    const snapshot = snapshotOf(item);
    expect(snapshot.lastMessageAt).toBe(AT);
    expect(snapshot).not.toHaveProperty('lastMessagePreview');
  });

  it('reads the team as last author, and a GIF on the last message', () => {
    const parsed = REVEAL_ENDPOINTS['conversations.list'].shape.safeParse({
      data: [
        conversationItem({
          lastMessageAuthor: { model: MODEL },
          lastMessage: {
            id: 'msg_test',
            createdAt: AT,
            updatedAt: AT,
            isUnread: false,
            content: '',
            type: 'default',
            gif: {
              id: 'gif_test',
              url: 'https://media.example.test/gif',
              webpUrl: 'https://media.example.test/webp',
              posterUrl: 'https://media.example.test/poster',
              width: 200,
              height: 100,
            },
          },
        }),
      ],
      pageInfo: { hasNextPage: true, endCursor: 'cursor_test' },
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.pageInfo.endCursor).toBe('cursor_test');
  });

  it('reads a step with three branches: one stepIndex, a condition on all but the default (2026-11-16)', () => {
    const branch = (id: string, condition?: string) => ({
      step: { id: `step_${id}`, stepIndex: 1, ...(condition === undefined ? {} : { condition }) },
      script: { id: `script_${id}`, createdAt: AT, updatedAt: AT, name: `Branche ${id}`, content: 'texte' },
      medias: [],
      teasingMedias: [],
      tags: [],
    });
    const parsed = REVEAL_ENDPOINTS['scriptSequences.list'].shape.safeParse([
      {
        sequence: { id: 'seq_test', name: 'test', createdAt: AT, updatedAt: AT },
        steps: [branch('b', 'il parle de sport'), branch('a'), branch('c', 'il a déjà acheté')],
      },
    ]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.[0]?.steps.map(({ step }) => step.condition ?? null)).toEqual([
      'il parle de sport',
      null,
      'il a déjà acheté',
    ]);
  });

  it('still refuses a key nobody has seen', () => {
    const parsed = REVEAL_ENDPOINTS['vault.folders'].shape.safeParse([
      {
        id: 'folder_test',
        imageCount: 0,
        videoCount: 0,
        isSharedForSfs: false,
        createdAt: AT,
        updatedAt: AT,
        name: 'Dossier vide',
        modelId: 'model_test',
        unknownKey: true,
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it('reads an empty folder without its cover, and a discounted step', () => {
    expect(
      REVEAL_ENDPOINTS['vault.folders'].shape.safeParse([
        {
          id: 'folder_test',
          imageCount: 0,
          videoCount: 0,
          isSharedForSfs: false,
          createdAt: AT,
          updatedAt: AT,
          name: 'Dossier vide',
          modelId: 'model_test',
        },
      ]).error,
    ).toBeUndefined();
    const scripts = REVEAL_ENDPOINTS['scripts.list'].shape.safeParse({
      data: [
        {
          script: {
            id: 'step_test',
            createdAt: AT,
            updatedAt: AT,
            name: 'Étape de test',
            content: 'Texte de test',
            price: 2000,
            discountedPrice: 1500,
            discountDurationMinutes: 60,
          },
          tags: [],
          medias: [],
          teasingMedias: [],
          conversations: [],
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: 1,
    });
    expect(scripts.error).toBeUndefined();
  });

  it('reads stats and the PPV history without the fields Reveal no longer sends; the price range is then unknown', () => {
    expect(
      REVEAL_ENDPOINTS['conversations.stats'].shape.safeParse({
        memberCreatedAt: AT,
        firstSubscriptionAt: null,
        tipsTotal: 0,
        messagesTotal: 3,
        totalSpent: 0,
        boudoirItemTotal: 0,
        incomingMessageTotal: 1,
        lastPaidAt: null,
        highestPurchase: 0,
        subscriptionPeriodicity: null,
        subscriptionExpireAt: null,
        autoRenew: false,
        refundAskedTotal: 0,
      }).error,
    ).toBeUndefined();
    const history = REVEAL_ENDPOINTS['conversations.ppvHistory'].shape.parse({
      buyRate: { purchased: 0, total: 0, percentage: 0 },
      bundles: [],
      pageInfo: { hasNextPage: false, endCursor: '' },
    });
    const stats = ppvStatsOf({ first: history, bundles: [] }, []);
    expect(stats.highestPriceMinor).toBeNull();
    expect(stats.lowestPriceMinor).toBeNull();
  });
});

describe('Reveal shapes of 2026-11-27', () => {
  const messagesPage = (extra: Record<string, unknown>) => ({
    data: [],
    pageInfo: { hasNextPage: false, endCursor: null },
    totalCount: 0,
    memberLastReadAt: null,
    ...extra,
  });

  it('reads the messages of a conversation with the translation settings Reveal now sends', () => {
    const shape = REVEAL_ENDPOINTS['messages.list'].shape;
    const parsed = shape.parse(
      messagesPage({ translation: { teamLanguage: 'fr', memberLanguage: null, replyLanguage: null } }),
    );
    expect(parsed.translation).toEqual({ teamLanguage: 'fr', memberLanguage: null, replyLanguage: null });
    expect(
      shape.parse(
        messagesPage({ translation: { teamLanguage: 'fr', memberLanguage: 'en', replyLanguage: 'en' } }),
      ),
    ).toBeDefined();
    expect(shape.parse(messagesPage({})).translation).toBeUndefined();
  });

  it('still refuses an unknown key inside the translation settings', () => {
    const shape = REVEAL_ENDPOINTS['messages.list'].shape;
    expect(
      shape.safeParse(
        messagesPage({
          translation: { teamLanguage: 'fr', memberLanguage: null, replyLanguage: null, auto: true },
        }),
      ).success,
    ).toBe(false);
  });
});
