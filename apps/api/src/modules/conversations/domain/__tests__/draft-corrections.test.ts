import {
  ConversationIdSchema,
  CreatorIdSchema,
  DRAFT_CORRECTIONS_MAX,
  DraftCorrectionsViewSchema,
  DraftIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { draftCorrectionOf, draftCorrectionsView, type DraftCorrectionRow } from '../draft-corrections';

/* Invented drafts (ADR 0010). */
const creatorId = CreatorIdSchema.parse('00000000-0000-4000-8000-000000000001');
const since = new Date('2026-10-22T00:00:00Z');
const at = new Date('2026-11-20T21:00:00Z');

const row = (over: Partial<DraftCorrectionRow> = {}): DraftCorrectionRow => ({
  draftId: DraftIdSchema.parse('00000000-0000-4000-8000-0000000000d1'),
  conversationId: ConversationIdSchema.parse('00000000-0000-4000-8000-0000000000c1'),
  fanDisplayName: 'Fan inventé',
  at,
  kind: 'rejected',
  before: ['Coucou toi', 'Tu fais quoi ce soir ?'],
  edited: null,
  writtenReason: null,
  rating: null,
  ...over,
});

describe('Entraîner › Corrections (trou béant 12)', () => {
  it('a retouch shows what the agent wrote beside what left', () => {
    expect(draftCorrectionOf(row({ kind: 'edited', edited: ['Coucou toi 😘'] }))).toEqual({
      draftId: row().draftId,
      conversationId: row().conversationId,
      fanDisplayName: 'Fan inventé',
      at: at.toISOString(),
      kind: 'edited',
      reason: 'edited',
      note: null,
      before: ['Coucou toi', 'Tu fais quoi ce soir ?'],
      after: ['Coucou toi 😘'],
    });
  });

  it('a refusal takes the copilot panel’s reason and note, else the reason written, else none', () => {
    expect(
      draftCorrectionOf(row({ rating: { kind: 'rejected', reason: 'too_long', note: 'Trop de bulles' } })),
    ).toMatchObject({ reason: 'too_long', note: 'Trop de bulles', after: null });
    expect(draftCorrectionOf(row({ rating: { kind: 'rejected', reason: 'sounds_ai' } }))).toMatchObject({
      reason: 'sounds_ai',
      note: null,
    });
    expect(draftCorrectionOf(row({ writtenReason: 'Elle ne dit jamais ça' }))).toMatchObject({
      reason: 'written',
      note: 'Elle ne dit jamais ça',
    });
    expect(draftCorrectionOf(row())).toMatchObject({ reason: 'none', note: null });
    // A rating that does not read is not a reason: the line still shows, without one.
    expect(draftCorrectionOf(row({ rating: { kind: 'rejected', reason: 'unknown' } })).reason).toBe('none');
  });

  it('counts each reason in the list’s order, and says when the newest were cut', () => {
    const view = draftCorrectionsView(creatorId, since, [
      row({ kind: 'edited', edited: ['Oui'] }),
      row({ rating: { kind: 'rejected', reason: 'too_long' } }),
      row(),
      row({ rating: { kind: 'rejected', reason: 'too_long' } }),
    ]);
    expect(view.counts).toEqual([
      { reason: 'too_long', count: 2 },
      { reason: 'none', count: 1 },
      { reason: 'edited', count: 1 },
    ]);
    expect(view.truncated).toBe(false);
    expect(DraftCorrectionsViewSchema.parse(view)).toEqual(view);

    const many = draftCorrectionsView(
      creatorId,
      since,
      Array.from({ length: DRAFT_CORRECTIONS_MAX + 1 }, () => row()),
    );
    expect(many.items).toHaveLength(DRAFT_CORRECTIONS_MAX);
    expect(many.truncated).toBe(true);
  });
});
