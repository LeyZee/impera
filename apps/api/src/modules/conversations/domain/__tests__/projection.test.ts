import { EventBodySchema, UserIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { applyEvent, INITIAL_PROJECTION, rebuildProjection } from '../projection';

const DRAFT = '0199f2a0-0000-7000-8000-0000000000d1';
const MESSAGE = '0199f2a0-0000-7000-8000-0000000000a1';
const CONVERSATION = '0199f2a0-0000-7000-8000-0000000000c1';
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e1');
const at = (minute: number) => new Date(`2026-10-17T20:${String(minute).padStart(2, '0')}:00Z`);

const message = { messageId: MESSAGE, platformMessageId: 'p1', mediaIds: [] };
const inbound = EventBodySchema.parse({
  type: 'message_received',
  payload: { ...message, direction: 'inbound', author: 'fan' },
});
const sent = EventBodySchema.parse({
  type: 'message_sent',
  payload: { ...message, direction: 'outbound', author: 'ai' },
});

describe('conversation projection', () => {
  it('counts unread fan messages and resets them when an answer leaves', () => {
    const afterTwo = rebuildProjection([
      { body: inbound, at: at(1) },
      { body: inbound, at: at(2) },
    ]);
    expect(afterTwo).toMatchObject({ state: 'pending', unreadCount: 2, lastInboundAt: at(2) });
    expect(applyEvent(afterTwo, sent, at(3))).toMatchObject({ unreadCount: 0, lastOutboundAt: at(3) });
  });

  it('leaves the conversation waiting when a stop expired the answer of a fan still unanswered (recette MOT-03)', () => {
    const expired = (leavesFanWaiting: boolean) =>
      EventBodySchema.parse({
        type: 'draft_expired',
        payload: {
          draftId: DRAFT,
          status: 'expired',
          reason: 'Arrêt d’urgence à l’envoi',
          ...(leavesFanWaiting && { leavesFanWaiting: true }),
        },
      });
    const sending = { ...INITIAL_PROJECTION, state: 'sending' as const, lastInboundAt: at(1) };
    expect(applyEvent(sending, expired(true), at(2)).state).toBe('pending');
    expect(applyEvent(sending, expired(false), at(2)).state).toBe('idle');
  });

  it('keeps a refused answer with the human as the event says, a refused follow-up at rest (recette CHAT-25)', () => {
    const rejected = (leavesFanWaiting: boolean) =>
      EventBodySchema.parse({
        type: 'draft_rejected',
        payload: {
          draftId: DRAFT,
          status: 'rejected',
          reason: 'Trop direct',
          ...(leavesFanWaiting && { leavesFanWaiting: true }),
        },
      });
    const waiting = { ...INITIAL_PROJECTION, state: 'awaiting_approval' as const, lastInboundAt: at(1) };
    expect(applyEvent(waiting, rejected(true), at(2)).state).toBe('human');
    expect(applyEvent(waiting, rejected(false), at(2)).state).toBe('idle');
    // An event written before CHAT-25 replays as it was decided, whatever the state says now (ADR 0007).
    const followUp = { ...waiting, lastOutboundAt: at(2) };
    expect(applyEvent(followUp, rejected(false), at(3)).state).toBe('idle');
  });

  it('puts him at rest when the creator’s side answered him on the platform, as the event says (ADR 0110 § 2)', () => {
    const fromTeam = (answersFan: boolean) =>
      EventBodySchema.parse({
        type: 'message_received',
        payload: {
          ...message,
          direction: 'outbound',
          author: 'human',
          ...(answersFan && { answersFan: true }),
        },
      });
    for (const state of ['pending', 'drafting', 'awaiting_approval'] as const) {
      const waiting = { ...INITIAL_PROJECTION, state, lastInboundAt: at(1) };
      expect(applyEvent(waiting, fromTeam(true), at(2))).toMatchObject({
        state: 'idle',
        lastOutboundAt: at(2),
      });
      // An event written before ADR 0110 replays as it was decided (ADR 0007).
      expect(applyEvent(waiting, fromTeam(false), at(2)).state).toBe(state);
    }
    // A draft already leaving is never stopped by it.
    const sending = { ...INITIAL_PROJECTION, state: 'sending' as const, lastInboundAt: at(1) };
    expect(applyEvent(sending, fromTeam(true), at(2)).state).toBe('sending');
  });

  it('clears the routing when a human hands the conversation back', () => {
    const routed = { ...INITIAL_PROJECTION, state: 'human' as const, routedToUserId: USER };
    const released = EventBodySchema.parse({
      type: 'takeover_ended',
      payload: { conversationId: CONVERSATION, userId: USER },
    });
    expect(applyEvent(routed, released, at(1))).toMatchObject({ state: 'idle', routedToUserId: null });
    expect(applyEvent(routed, inbound, at(1)).routedToUserId).toBe(USER);
  });

  it('keeps the last desire score, its band and its time, without moving the state', () => {
    const scored = (before: number | null, score: number) =>
      EventBodySchema.parse({
        type: 'desire_scored',
        payload: { before, score, signals: ['intent:flirt'], weightsVersion: 'w1' },
      });
    const projection = rebuildProjection([
      { body: inbound, at: at(1) },
      { body: scored(null, 45), at: at(2) },
      { body: scored(45, 71), at: at(3) },
    ]);
    expect(projection).toMatchObject({
      state: 'pending',
      desireScore: 71,
      desireBand: 'hot',
      desireAt: at(3),
    });
    expect(INITIAL_PROJECTION).toMatchObject({ desireScore: null, desireBand: null, desireAt: null });
  });

  it('opens the care mode once, marks its help bubble, and closes it (ADR 0088)', () => {
    const opened = EventBodySchema.parse({
      type: 'care_opened',
      payload: { conversationId: CONVERSATION, signs: ['self_harm'] },
    });
    const draft = (help: boolean) =>
      EventBodySchema.parse({
        type: 'draft_created',
        payload: { draftId: DRAFT, status: 'pending', care: { help } },
      });
    const closed = EventBodySchema.parse({
      type: 'care_closed',
      payload: { conversationId: CONVERSATION, reason: 'Il va mieux' },
    });
    const open = rebuildProjection([
      { body: inbound, at: at(1) },
      { body: opened, at: at(2) },
      { body: draft(true), at: at(3) },
      { body: opened, at: at(4) },
    ]);
    expect(open).toMatchObject({
      state: 'awaiting_approval',
      careSince: at(2),
      careHelpAt: at(3),
      careClosedAt: null,
    });
    expect(applyEvent(open, closed, at(5))).toMatchObject({
      state: 'awaiting_approval',
      careSince: null,
      careHelpAt: null,
      careClosedAt: at(5),
    });
    // A help bubble outside an episode marks nothing: only an open episode gives it once.
    expect(applyEvent(INITIAL_PROJECTION, draft(true), at(1)).careHelpAt).toBeNull();
  });

  it('ignores an event the state machine refuses, so a journal always folds', () => {
    const approved = EventBodySchema.parse({
      type: 'draft_approved',
      payload: { draftId: DRAFT, status: 'approved' },
    });
    expect(applyEvent(INITIAL_PROJECTION, approved, at(1)).state).toBe('idle');
  });

  it('leaves `sending` for `error` on a final failure, whatever the attempt; an older event counts attempts', () => {
    const sending = { ...INITIAL_PROJECTION, state: 'sending' as const };
    const failed = (attempt: number, isFinal?: boolean) =>
      EventBodySchema.parse({
        type: 'send_failed',
        payload: {
          conversationId: CONVERSATION,
          draftId: DRAFT,
          idempotencyKey: `${DRAFT}:0`,
          attempt,
          ...(isFinal === undefined ? {} : { isFinal }),
        },
      });
    expect(applyEvent(sending, failed(1, true), at(1)).state).toBe('error');
    expect(applyEvent(sending, failed(1, false), at(1)).state).toBe('sending');
    expect(applyEvent(sending, failed(3), at(1)).state).toBe('error');
    expect(applyEvent(sending, failed(1), at(1)).state).toBe('sending');
  });

  it('records a mode change', () => {
    const body = EventBodySchema.parse({ type: 'mode_changed', payload: { mode: 'auto' } });
    expect(applyEvent(INITIAL_PROJECTION, body, at(1)).mode).toBe('auto');
  });
});
