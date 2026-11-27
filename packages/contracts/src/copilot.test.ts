import { describe, expect, it } from 'vitest';

import {
  CopilotAssistSchema,
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
      standing: null,
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

  it('reads what the agent computed (ADR 0141), and still takes a view from a server that does not send it', () => {
    const conversation = {
      creatorId: CREATOR,
      conversationId: DRAFT,
      fanId: DRAFT,
      switches: { fanCard: true, drafts: true },
    };
    const assist = {
      nextMove: { kind: 'offer_step', label: 'Proposer Étape 2 à 15 €', priceMinor: 1500, block: null },
      reasons: [{ code: 'rewritten_once', label: 'Réécrit une fois par une garde' }],
      sale: {
        script: { name: 'Soirée', stepIndex: 1, stepCount: 4 },
        nextStep: { name: 'Étape 2', priceMinor: 1500 },
        refusedSteps: [],
        usedObjections: [],
        customOrderOpen: false,
        offerPending: false,
      },
      signals: { desireTrend: 'up', followUpDue: false },
      cuts: [],
      buttons: [],
      clicksLeftToday: 30,
    };
    expect(CopilotAssistSchema.safeParse(assist).success).toBe(true);
    const moment = {
      verdict: 'soon',
      conditions: [
        { code: 'cooldown', met: false, until: '2026-11-16T17:20:00.000Z' },
        { code: 'fan_messages', met: false, remaining: 2 },
        { code: 'desire_below_threshold', met: true },
      ],
    };
    expect(CopilotAssistSchema.safeParse({ ...assist, saleMoment: moment }).success).toBe(true);
    expect(CopilotAssistSchema.safeParse({ ...assist, saleMoment: null }).success).toBe(true);
    expect(CopilotDraftViewSchema.safeParse({ state: 'none', conversation, assist }).success).toBe(true);
    expect(CopilotDraftViewSchema.safeParse({ state: 'none', conversation, assist: null }).success).toBe(
      true,
    );
    expect(CopilotDraftViewSchema.safeParse({ state: 'none', conversation }).success).toBe(true);
    // Only `none` and `ready` carry it.
    expect(CopilotDraftViewSchema.safeParse({ state: 'writing', conversation, assist }).success).toBe(false);
    // Closed lists: an unknown gesture, cut or button is refused, never shown raw.
    for (const broken of [
      { ...assist, nextMove: { ...assist.nextMove, kind: 'discount' } },
      { ...assist, cuts: ['vip'] },
      { ...assist, buttons: ['free_text'] },
      { ...assist, signals: { desireTrend: 72, followUpDue: false } },
      // § 4 bis: a verdict of a closed list, never a figure.
      { ...assist, saleMoment: { verdict: 62, conditions: [] } },
      { ...assist, saleMoment: { verdict: 'now', conditions: [] } },
      { ...assist, saleMoment: { verdict: 'good', conditions: [{ code: 'score', met: true }] } },
      // The panel words the codes: a label from the server is refused.
      {
        ...assist,
        saleMoment: { verdict: 'good', conditions: [{ code: 'cooldown', label: 'Offre', met: true }] },
      },
      {
        ...assist,
        saleMoment: { verdict: 'soon', conditions: [{ code: 'fan_messages', met: false, remaining: 0 }] },
      },
    ])
      expect(CopilotAssistSchema.safeParse(broken).success).toBe(false);
  });
});
