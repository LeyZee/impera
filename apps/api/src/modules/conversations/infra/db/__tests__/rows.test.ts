import { ConversationIdSchema, CreatorIdSchema, EventIdSchema, newId } from '@impera/contracts';
import type { schema } from '@impera/db';
import { describe, expect, it } from 'vitest';

import { readDraftTranslation, toStoredEvent, toStoredPolicyTrace } from '../rows';

const conversationId = newId(ConversationIdSchema);

function row(type: string, payload: unknown): typeof schema.conversationEvents.$inferSelect {
  return {
    id: newId(EventIdSchema),
    creatorId: newId(CreatorIdSchema),
    conversationId,
    seq: 1,
    type,
    payload,
    actor: 'system',
    correlationId: 'test',
    createdAt: new Date('2026-10-16T20:00:00Z'),
  };
}

describe('journal rows written before a contract change (ADR 0007, Évolution des payloads)', () => {
  it('reads a handoff of before #54, without its conversation nor its cause', () => {
    expect(toStoredEvent(row('handoff_requested', { reason: 'je ne sais pas quoi répondre' })).body).toEqual({
      type: 'handoff_requested',
      payload: { conversationId, cause: 'other', reason: 'je ne sais pas quoi répondre' },
    });
  });

  it('moves the codes an engine handoff joined in its reason to its detail, never shown to a chatter', () => {
    expect(
      toStoredEvent(row('handoff_requested', { reason: 'guard_blocked : meeting_promise' })).body,
    ).toEqual({
      type: 'handoff_requested',
      payload: { conversationId, cause: 'other', detail: ['guard_blocked', 'meeting_promise'] },
    });
    expect(
      toStoredEvent(
        row('handoff_requested', {
          conversationId,
          cause: 'llm_unavailable',
          reason: 'llm_unavailable : no voice key',
        }),
      ).body,
    ).toEqual({
      type: 'handoff_requested',
      payload: { conversationId, cause: 'llm_unavailable', detail: ['llm_unavailable', 'no voice key'] },
    });
    // Cut at 500 characters right after a « : »: the empty code is dropped, the row still reads.
    expect(
      toStoredEvent(row('handoff_requested', { reason: 'guard_blocked : meeting_promise : ' })).body,
    ).toEqual({
      type: 'handoff_requested',
      payload: { conversationId, cause: 'other', detail: ['guard_blocked', 'meeting_promise'] },
    });
  });

  it('reads a takeover of before #60, without its conversation', () => {
    expect(toStoredEvent(row('takeover_started', { reason: 'je prends' })).body).toEqual({
      type: 'takeover_started',
      payload: { conversationId, reason: 'je prends' },
    });
  });

  it('keeps what a current row holds, and still refuses a payload no shape explains', () => {
    const other = newId(ConversationIdSchema);
    expect(
      toStoredEvent(row('handoff_requested', { conversationId: other, cause: 'distress' })).body,
    ).toEqual({ type: 'handoff_requested', payload: { conversationId: other, cause: 'distress' } });
    expect(() => toStoredEvent(row('handoff_requested', { cause: 'not_a_cause' }))).toThrow();
  });
});

describe('her draft in French for the team, beside the draft (ADR 0168 § 9)', () => {
  it('is kept and read back apart from the step the send reads', () => {
    const translation = { language: 'french' as const, bubbles: ['coucou toi'] };
    const stored = toStoredPolicyTrace({ translation });
    expect(stored).toEqual({ translation });
    expect(readDraftTranslation(stored)).toEqual(translation);
    // The send reads the step only (`scriptStep`): the French is not one.
    expect(stored.scriptStep).toBeUndefined();
  });

  it('drops one that does not read, never the draft, and reads none on an older trace', () => {
    expect(toStoredPolicyTrace({ translation: { language: 'french', bubbles: [] } })).toEqual({});
    expect(readDraftTranslation({})).toBeNull();
    expect(readDraftTranslation({ translation: { language: 'english', bubbles: ['hey'] } })).toBeNull();
  });
});
