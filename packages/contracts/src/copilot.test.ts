import { describe, expect, it } from 'vitest';

import {
  CopilotDraftQuerySchema,
  CopilotDraftViewSchema,
  CopilotVerdictBodySchema,
  PlatformConversationIdSchema,
  SetCopilotSwitchesBodySchema,
} from './copilot';
import { CreatorSettingsSchema } from './settings';

const CREATOR = '0b3f9a52-6c1e-4f4e-9b1a-3d2c1e0f9a8b';
const DRAFT = '7d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6';

describe('the copilot panel’s contract (ADR 0086)', () => {
  it('reads a platform’s conversation id as opaque, never a path', () => {
    expect(PlatformConversationIdSchema.parse('conv_123-abc:9')).toBe('conv_123-abc:9');
    for (const id of ['', '../fans', 'a b', 'x'.repeat(201)])
      expect(PlatformConversationIdSchema.safeParse(id).success).toBe(false);
    expect(CopilotDraftQuerySchema.parse({})).toEqual({ platform: 'reveal' });
    expect(CopilotDraftQuerySchema.safeParse({ platform: 'reveal', fan: 'x' }).success).toBe(false);
  });

  it('gives a draft only when it is ready, and a conversation once Impera knows it', () => {
    expect(CopilotDraftViewSchema.parse({ state: 'unknown' })).toEqual({ state: 'unknown' });
    const conversation = {
      creatorId: CREATOR,
      conversationId: DRAFT,
      fanId: DRAFT,
      switches: { fanCard: true, drafts: true },
    };
    expect(CopilotDraftViewSchema.safeParse({ state: 'none', conversation }).success).toBe(true);
    expect(
      CopilotDraftViewSchema.safeParse({
        state: 'none',
        conversation,
        draft: { draftId: DRAFT, bubbles: ['Coucou'], createdAt: '2026-11-08T17:00:00.000Z', placedAt: null },
      }).success,
    ).toBe(false);
    expect(CopilotDraftViewSchema.safeParse({ state: 'ready', conversation }).success).toBe(false);
  });

  it('takes a placing or a rejection with a reason of the closed list, nothing else', () => {
    expect(
      CopilotVerdictBodySchema.safeParse({ kind: 'placed', creatorId: CREATOR, edited: true }).success,
    ).toBe(true);
    expect(
      CopilotVerdictBodySchema.safeParse({ kind: 'rejected', creatorId: CREATOR, reason: 'sounds_ai' })
        .success,
    ).toBe(true);
    expect(
      CopilotVerdictBodySchema.safeParse({ kind: 'rejected', creatorId: CREATOR, reason: 'boring' }).success,
    ).toBe(false);
    // The panel never says « sent »: what left decides (§ 5).
    expect(CopilotVerdictBodySchema.safeParse({ kind: 'validated', creatorId: CREATOR }).success).toBe(false);
  });

  it('turns her switches one at a time, the card on and the drafts off by default', () => {
    expect(CreatorSettingsSchema.parse({}).copilot).toEqual({ fanCard: true, drafts: false });
    expect(SetCopilotSwitchesBodySchema.parse({ drafts: true })).toEqual({ drafts: true });
    expect(SetCopilotSwitchesBodySchema.safeParse({}).success).toBe(false);
    expect(SetCopilotSwitchesBodySchema.safeParse({ drafts: 'yes' }).success).toBe(false);
  });
});
