import { describe, expect, it } from 'vitest';

import { PLACED_WINDOW_MS, placedDraftFor, placedVerdict } from '../placed-draft';

const placedAt = new Date('2026-11-21T14:00:00Z');
const at = (ms: number) => new Date(placedAt.getTime() + ms);

describe('the draft a message sent by hand answers for (ADR 0086 § 5)', () => {
  const placed = { id: 'a', status: 'pending', placedAt };

  it('is the placed draft, within the window', () => {
    expect(placedDraftFor([placed], at(30_000))).toBe(placed);
    expect(placedDraftFor([placed], at(PLACED_WINDOW_MS))).toBe(placed);
  });

  it('is none after the window, or well before the placing', () => {
    expect(placedDraftFor([placed], at(PLACED_WINDOW_MS + 1))).toBeNull();
    expect(placedDraftFor([placed], at(-5 * 60_000))).toBeNull();
  });

  it('forgives the platform clock a minute behind ours', () => {
    expect(placedDraftFor([placed], at(-30_000))).toBe(placed);
  });

  it('is none for a draft never placed, or already decided', () => {
    expect(placedDraftFor([{ id: 'b', status: 'pending', placedAt: null }], at(1_000))).toBeNull();
    expect(placedDraftFor([{ id: 'c', status: 'approved', placedAt }], at(1_000))).toBeNull();
  });

  it('is the last placed one when two are open', () => {
    const later = { id: 'd', status: 'pending', placedAt: at(60_000) };
    expect(placedDraftFor([placed, later], at(90_000))).toBe(later);
  });
});

describe('the verdict of what left (ADR 0086 § 5)', () => {
  it('validates the bubbles sent as they were, spaces aside', () => {
    expect(placedVerdict(['coucou toi', 'tu fais quoi'], ['coucou  toi ', 'tu fais quoi'])).toEqual({
      kind: 'validated',
    });
  });

  it('corrects a changed word, with the text really sent', () => {
    expect(placedVerdict(['coucou toi'], ['coucou mon cœur'])).toEqual({
      kind: 'corrected',
      text: 'coucou mon cœur',
    });
  });

  it('corrects a bubble left out or added', () => {
    expect(placedVerdict(['a', 'b'], ['a'])).toEqual({ kind: 'corrected', text: 'a' });
    expect(placedVerdict(['a'], ['a', 'c'])).toEqual({ kind: 'corrected', text: 'a\nc' });
  });
});
