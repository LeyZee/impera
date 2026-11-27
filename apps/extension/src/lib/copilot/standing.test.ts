import { describe, expect, it } from 'vitest';

import { standingOf, withheldOf } from './standing';

describe('where things stand with him (ADR 0086 § 3.1)', () => {
  // Recette du 16/11, EXT-05: « Ne plus lui écrire » forbids any word, the other stops forbid an offer.
  it('says when nothing at all may go to him', () => {
    expect(standingOf({ doNotContact: true }, null)).toMatchObject({
      stops: ['Ne plus lui écrire'],
      noContact: true,
    });
    expect(
      standingOf({ salesFrozen: { reason: 'distress', since: '2026-11-08T18:00:00Z' } }, null).noContact,
    ).toBe(false);
    expect(standingOf('unread', null)).toMatchObject({ unread: true, noContact: false });
  });

  // ADR 0141 § 9: the panel cuts the sale and masks what is intimate by itself while his age is contested.
  it('says when his age is contested, in the glossary word', () => {
    expect(standingOf({ ageDisputed: { since: '2026-11-08T18:00:00Z', by: 'policy' } }, 'hot')).toMatchObject(
      { stops: ['Âge contesté'], ageDisputed: true },
    );
    expect(standingOf({}, null).ageDisputed).toBe(false);
    expect(standingOf('unread', null).ageDisputed).toBe(false);
  });

  // Bilan's review: closed by default, nothing to copy until his limits are read.
  it('withholds the text to copy unless his limits are read and allow a word', () => {
    expect(withheldOf(null)).toBe('unread');
    expect(withheldOf(standingOf('unread', null))).toBe('unread');
    expect(withheldOf(standingOf({ doNotContact: true }, null))).toBe('no_contact');
    expect(withheldOf(standingOf({}, null))).toBeNull();
    expect(
      withheldOf(standingOf({ salesFrozen: { reason: 'distress', since: '2026-11-08T18:00:00Z' } }, null)),
    ).toBeNull();
  });
});
