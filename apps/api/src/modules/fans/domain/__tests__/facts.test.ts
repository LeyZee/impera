import { describe, expect, it } from 'vitest';

import {
  kycSlotsToLearn,
  MAX_ACTIVE_FACTS,
  MAX_FACT_VALUE_LENGTH,
  MAX_OPERATOR_NOTE_LENGTH,
  planFacts,
  selectActiveFacts,
  type FactProposal,
  type StoredFact,
} from '../facts';

const may = new Date('2026-05-10T10:00:00Z');
const august = new Date('2026-08-10T10:00:00Z');
const now = new Date('2026-09-01T10:00:00Z');

const stored = (over: Partial<StoredFact> = {}): StoredFact => ({
  id: 'f-1',
  category: 'identity',
  key: 'city',
  value: 'Lyon',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: null,
  observedAt: may,
  expiresAt: null,
  supersededBy: null,
  ...over,
});

const proposal = (over: Partial<FactProposal> = {}): FactProposal => ({
  category: 'identity',
  key: 'city',
  value: 'Paris',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: null,
  observedAt: august,
  ...over,
});

describe('planFacts', () => {
  it('writes a new slot, with a normalized key and value', () => {
    expect(planFacts([], [proposal({ key: ' Home City ', value: '  Paris   centre ' })], now)).toEqual([
      {
        fact: {
          category: 'identity',
          key: 'home_city',
          value: 'Paris centre',
          kind: 'declared',
          confidence: 0.9,
          sourceMessageId: null,
          observedAt: august,
          expiresAt: null,
        },
        supersedes: null,
      },
    ]);
  });

  it('supersedes the old value: Lyon in May, Paris in August', () => {
    const [write] = planFacts([stored()], [proposal()], now);
    expect(write).toMatchObject({ fact: { value: 'Paris' }, supersedes: 'f-1' });
  });

  it('does not write the same value again, whatever its case', () => {
    expect(planFacts([stored()], [proposal({ value: 'lyon' })], now)).toEqual([]);
  });

  it('lets a declared fact confirm an inferred one, never the reverse', () => {
    expect(planFacts([stored({ kind: 'inferred' })], [proposal({ value: 'Lyon' })], now)).toMatchObject([
      { fact: { kind: 'declared' }, supersedes: 'f-1' },
    ]);
    expect(planFacts([stored()], [proposal({ kind: 'inferred', value: 'Marseille' })], now)).toEqual([]);
  });

  it('changes nothing for a proposal older than the active fact (a replayed job)', () => {
    expect(
      planFacts([stored({ observedAt: august })], [proposal({ value: 'Nice', observedAt: may })], now),
    ).toEqual([]);
  });

  it('keeps the last value of a slot named twice in one batch, superseding the stored fact once', () => {
    const writes = planFacts([stored()], [proposal(), proposal({ value: 'Nice' })], now);
    expect(writes).toMatchObject([{ fact: { value: 'Nice' }, supersedes: 'f-1' }]);
  });

  it('skips empty keys and values and cuts long values', () => {
    expect(planFacts([], [proposal({ key: '  ' }), proposal({ value: ' ' })], now)).toEqual([]);
    const [write] = planFacts([], [proposal({ value: 'a'.repeat(1000) })], now);
    expect(write?.fact.value).toHaveLength(MAX_FACT_VALUE_LENGTH);
    const [note] = planFacts(
      [],
      [proposal({ category: 'operator_note', key: 'note_1', value: 'a'.repeat(900) })],
      now,
    );
    expect(note?.fact.value).toHaveLength(900);
    const [long] = planFacts(
      [],
      [proposal({ category: 'operator_note', key: 'note_2', value: 'a'.repeat(2000) })],
      now,
    );
    expect(long?.fact.value).toHaveLength(MAX_OPERATOR_NOTE_LENGTH);
  });

  it('writes again a slot whose fact has expired, without superseding it', () => {
    const expired = stored({ expiresAt: new Date('2026-08-01T00:00:00Z') });
    expect(planFacts([expired], [proposal({ value: 'Lyon' })], now)).toMatchObject([{ supersedes: null }]);
  });
});

describe('selectActiveFacts', () => {
  it('drops superseded and expired facts', () => {
    const facts = [
      stored({ id: 'old', supersededBy: 'new' }),
      stored({ id: 'gone', key: 'trip', expiresAt: new Date('2026-08-31T00:00:00Z') }),
      stored({ id: 'new', value: 'Paris', observedAt: august }),
    ];
    expect(selectActiveFacts(facts, now).map((fact) => fact.id)).toEqual(['new']);
  });

  it('sorts by category, then confidence, then the newest', () => {
    const facts = [
      stored({ id: 'likes', category: 'preferences', key: 'likes' }),
      stored({ id: 'job-low', category: 'identity', key: 'job', confidence: 0.4 }),
      stored({ id: 'city-old', category: 'identity', key: 'city', observedAt: may }),
      stored({ id: 'age-new', category: 'identity', key: 'age', observedAt: august }),
    ];
    expect(selectActiveFacts(facts, now).map((fact) => fact.id)).toEqual([
      'age-new',
      'city-old',
      'job-low',
      'likes',
    ]);
  });

  it("puts a chatter's notes first, so the cap never drops them", () => {
    const facts = [
      ...Array.from({ length: 45 }, (_, i) => stored({ id: `f-${String(i)}`, key: `k${String(i)}` })),
      stored({ id: 'note', category: 'operator_note', key: 'note_1', confidence: 1 }),
    ];
    expect(selectActiveFacts(facts, now)[0]?.id).toBe('note');
  });

  it('keeps 40 facts at most', () => {
    const facts = Array.from({ length: 50 }, (_, i) =>
      stored({ id: `f-${String(i)}`, key: `k${String(i)}` }),
    );
    expect(selectActiveFacts(facts, now)).toHaveLength(MAX_ACTIVE_FACTS);
  });
});

describe('kycSlotsToLearn', () => {
  it('keeps her lines in her order, without those an active fact has as key', () => {
    const slots = ['first_name', 'age', 'location', 'job'] as const;
    expect(kycSlotsToLearn(slots, [], now)).toEqual(['first_name', 'age', 'location', 'job']);
    expect(
      kycSlotsToLearn(
        slots,
        [stored({ key: 'location' }), stored({ category: 'life', key: ' Job ' }), stored({ key: 'city' })],
        now,
      ),
    ).toEqual(['first_name', 'age']);
  });

  it('reads every active fact, past the 40 of the context, and none that is no longer true', () => {
    const notes = Array.from({ length: MAX_ACTIVE_FACTS + 5 }, (_, index) =>
      stored({ id: `n-${String(index)}`, category: 'operator_note', key: `note_${String(index)}` }),
    );
    const facts = [
      ...notes,
      stored({ category: 'interests', key: 'hobbies', confidence: 0.1 }),
      stored({ key: 'age', supersededBy: 'f-2' }),
      stored({ key: 'job', expiresAt: may }),
    ];
    expect(kycSlotsToLearn(['age', 'job', 'hobbies'], facts, now)).toEqual(['age', 'job']);
  });

  it('never counts a chatter’s note as a learnt line', () => {
    expect(
      kycSlotsToLearn(['first_name'], [stored({ category: 'operator_note', key: 'first_name' })], now),
    ).toEqual(['first_name']);
  });
});
