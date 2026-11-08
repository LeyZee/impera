import { describe, expect, it } from 'vitest';

import {
  cardReadRunAt,
  FAN_CARD_FIELDS,
  FanCardReadSchema,
  FanCardFieldSchema,
  FanCardViewSchema,
  fanCardFieldSpec,
  SetFanCardFieldBodySchema,
} from './fan-card';
import { KycSlotSchema } from './fans';

describe('the fan’s card (ADR 0085)', () => {
  it('holds the twenty fields of § 3 in their order, each with one spec', () => {
    expect(FAN_CARD_FIELDS.map((spec) => spec.field)).toEqual([...FanCardFieldSchema.options]);
    expect(FAN_CARD_FIELDS).toHaveLength(20);
    expect(fanCardFieldSpec('outfits')).toMatchObject({
      group: 'about_her',
      shape: 'list',
      learning: 'note',
    });
  });

  it('keeps the seven codes of the KYC canvas, so the facts already written fill the card', () => {
    for (const slot of KycSlotSchema.options)
      expect(FanCardFieldSchema.safeParse(slot).success, slot).toBe(true);
  });

  it('asks only the six KYC fields; what is observed is never asked', () => {
    const asked = FAN_CARD_FIELDS.filter((spec) => spec.learning === 'ask').map((spec) => spec.field);
    expect(asked).toEqual(['first_name', 'location', 'age', 'situation', 'job', 'hobbies']);
    const observed = FAN_CARD_FIELDS.filter((spec) => spec.learning === 'observe').map((spec) => spec.field);
    expect(observed).toEqual(['moods', 'payday', 'attachment', 'intensity', 'lead']);
  });

  it('takes items or a clear, nothing else, and refuses unknown keys', () => {
    expect(SetFanCardFieldBodySchema.safeParse({ items: ['Lyon'] }).success).toBe(true);
    expect(SetFanCardFieldBodySchema.safeParse({ clear: true }).success).toBe(true);
    expect(SetFanCardFieldBodySchema.safeParse({ items: [] }).success).toBe(false);
    expect(SetFanCardFieldBodySchema.safeParse({ items: ['  '] }).success).toBe(false);
    expect(SetFanCardFieldBodySchema.safeParse({ items: ['Lyon'], source: 'declared' }).success).toBe(false);
  });

  it('reads a card strictly: the extension and the CRM read the same shape', () => {
    const card = {
      fanId: '00000000-0000-4000-8000-000000000001',
      fields: [{ field: 'first_name', current: null, toCheck: [] }],
      others: [],
    };
    expect(FanCardViewSchema.safeParse(card).success).toBe(true);
    expect(FanCardViewSchema.safeParse({ ...card, payday: 'le 5' }).success).toBe(false);
    const value = {
      items: ['Lyon'],
      source: 'inferred',
      observedAt: '2026-11-08T10:00:00.000Z',
      notedBy: null,
      notedByName: null,
      sourceMessageId: '00000000-0000-4000-8000-0000000000a1',
      sourceQuote: 'je rentre à Lyon ce soir',
    };
    const filled = { ...card, fields: [{ field: 'location', current: value, toCheck: [] }] };
    expect(FanCardViewSchema.safeParse(filled).success).toBe(true);
    const tooLong = { ...value, sourceQuote: 'x'.repeat(201) };
    expect(
      FanCardViewSchema.safeParse({ ...card, fields: [{ field: 'location', current: tooLong, toCheck: [] }] })
        .success,
    ).toBe(false);
  });
});

describe('when the AI reads his messages again (ADR 0085 § 7)', () => {
  const now = new Date('2026-11-08T21:00:00Z');
  const minutes = (n: number): Date => new Date(now.getTime() + n * 60_000);

  it('waits for five minutes of silence, or reads at once after ten messages', () => {
    expect(cardReadRunAt({ now, unread: 1, lastReadAt: null })).toEqual(minutes(5));
    expect(cardReadRunAt({ now, unread: 10, lastReadAt: null })).toEqual(now);
  });

  it('never reads a conversation twice within ten minutes', () => {
    expect(cardReadRunAt({ now, unread: 12, lastReadAt: minutes(-4) })).toEqual(minutes(6));
    expect(cardReadRunAt({ now, unread: 2, lastReadAt: minutes(-30) })).toEqual(minutes(5));
  });

  it('takes a closed list of fields from the model, each with its message', () => {
    const read = {
      facts: [{ field: 'payday', items: ['le 5'], kind: 'inferred', confidence: 0.6, message: 3 }],
    };
    expect(FanCardReadSchema.safeParse(read).success).toBe(true);
    const unknown = { facts: [{ ...read.facts[0], field: 'religion' }] };
    expect(FanCardReadSchema.safeParse(unknown).success).toBe(false);
    expect(FanCardReadSchema.safeParse({ ...read, note: 'x' }).success).toBe(false);
  });
});
