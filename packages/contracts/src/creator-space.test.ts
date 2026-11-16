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
  writtenBy: { kind: 'chatter', displayName: 'Kofi' },
  text: 'coucou toi',
  media: [{ kind: 'image', isLocked: true, description: 'Une photo au salon' }],
  priceMinor: 1500,
  currency: 'EUR',
  isPaid: true,
  platformCreatedAt: '2026-11-03T10:00:00.000Z',
} as const;

describe('the creator space contracts (CR-02)', () => {
  it('reads one of her messages with who wrote it, and a fan’s without (ADR 0065 § 1)', () => {
    expect(CreatorMessageSchema.parse(message)).toEqual(message);
    for (const writtenBy of [{ kind: 'ai' }, { kind: 'platform' }, { kind: 'agency' }] as const)
      expect(CreatorMessageSchema.parse({ ...message, writtenBy })).toEqual({ ...message, writtenBy });
    const fans = { ...message, direction: 'inbound', writtenBy: null } as const;
    expect(CreatorMessageSchema.parse(fans)).toEqual(fans);
  });

  it('refuses a fan’s message with a writer, and one of hers without', () => {
    expect(CreatorMessageSchema.safeParse({ ...message, direction: 'inbound' }).success).toBe(false);
    expect(CreatorMessageSchema.safeParse({ ...message, writtenBy: null }).success).toBe(false);
    expect(CreatorMessageSchema.safeParse({ ...message, writtenBy: undefined }).success).toBe(false);
  });

  it('refuses a writer that says more than its kind and a chatter’s display name', () => {
    for (const writtenBy of [
      { kind: 'chatter', displayName: 'Kofi', userId: 'u-1' },
      { kind: 'ai', model: 'grok' },
      { kind: 'ai', reviewedBy: 'Kofi' },
      { kind: 'platform', displayName: 'Kofi' },
      { kind: 'chatter', displayName: '' },
      { kind: 'chatter' },
      { kind: 'human' },
    ])
      expect(CreatorMessageSchema.safeParse({ ...message, writtenBy }).success).toBe(false);
  });

  it('refuses a message that carries the internal author or its draft, at every level', () => {
    for (const extra of [
      { author: 'ai' },
      { author: 'human' },
      { author: 'operator' },
      { draftId: message.id },
    ]) {
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
    const conversation = { id: message.id, fan: { id: fan.id, displayName: 'Fan test' } };
    expect(CreatorConversationSchema.safeParse(conversation).success).toBe(true);
    expect(CreatorConversationSchema.safeParse({ ...conversation, mode: 'auto' }).success).toBe(false);
    expect(
      CreatorConversationSchema.safeParse({ ...conversation, fan: { ...conversation.fan, flags: {} } })
        .success,
    ).toBe(false);
  });
});
