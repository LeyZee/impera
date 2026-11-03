import { describe, expect, it } from 'vitest';

import {
  CreatorConversationSchema,
  CreatorFanPageSchema,
  CreatorMessagePageSchema,
  CreatorMessageSchema,
} from './creator-space';

const message = {
  id: '01890000-0000-7000-8000-000000000001',
  direction: 'outbound',
  text: 'coucou toi',
  media: [{ kind: 'image', isLocked: true, description: 'Une photo au salon' }],
  priceMinor: 1500,
  currency: 'EUR',
  isPaid: true,
  platformCreatedAt: '2026-11-03T10:00:00.000Z',
} as const;

describe('the creator space contracts (CR-02)', () => {
  it('reads a message without its author', () => {
    expect(CreatorMessageSchema.parse(message)).toEqual(message);
  });

  it('refuses a message that carries its author or its draft, at every level', () => {
    for (const extra of [{ author: 'ai' }, { author: 'operator' }, { draftId: message.id }]) {
      expect(CreatorMessageSchema.safeParse({ ...message, ...extra }).success).toBe(false);
      expect(
        CreatorMessagePageSchema.safeParse({ items: [{ ...message, ...extra }], nextCursor: null }).success,
      ).toBe(false);
    }
    const media = [{ ...message.media[0], author: 'ai' }];
    expect(CreatorMessageSchema.safeParse({ ...message, media }).success).toBe(false);
  });

  it('refuses a field of too many on a fan and on a conversation', () => {
    const fan = {
      id: '01890000-0000-7000-8000-000000000002',
      displayName: 'Fan test',
      conversationId: null,
      spent: { eurMinor: 0, usdMinor: 0 },
      firstSeenAt: '2026-11-01T10:00:00.000Z',
      lastSeenAt: '2026-11-03T10:00:00.000Z',
    };
    expect(CreatorFanPageSchema.safeParse({ items: [fan], nextCursor: null }).success).toBe(true);
    expect(
      CreatorFanPageSchema.safeParse({ items: [{ ...fan, desire: 80 }], nextCursor: null }).success,
    ).toBe(false);
    const conversation = { id: message.id, fan: { id: fan.id, displayName: 'Fan test', notes: [] } };
    expect(CreatorConversationSchema.safeParse(conversation).success).toBe(true);
    expect(CreatorConversationSchema.safeParse({ ...conversation, mode: 'auto' }).success).toBe(false);
    expect(
      CreatorConversationSchema.safeParse({ ...conversation, fan: { ...conversation.fan, flags: {} } })
        .success,
    ).toBe(false);
  });
});
