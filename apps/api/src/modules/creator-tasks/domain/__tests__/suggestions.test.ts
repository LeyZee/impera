import { describe, expect, it } from 'vitest';

import { decide, maySuggest, sameTask, SuggestionDecidedError, weekOf } from '../suggestions';

describe('her gesture on a suggestion (ADR 0042 § 3)', () => {
  it('accepts or declines a suggestion once', () => {
    expect(decide('suggested', 'accept')).toEqual({ state: 'accepted', changed: true });
    expect(decide('suggested', 'decline')).toEqual({ state: 'declined', changed: true });
  });

  it('changes nothing on the same gesture twice, and refuses the other one', () => {
    expect(decide('accepted', 'accept')).toEqual({ state: 'accepted', changed: false });
    expect(() => decide('declined', 'accept')).toThrow(SuggestionDecidedError);
  });
});

describe('a declined task is not suggested again the week after (ADR 0042, Conséquences)', () => {
  const shoot = { category: 'content', title: 'Tournage  lingerie rouge' };
  const declined = [{ category: 'content', title: 'tournage lingerie Rouge', declinedOn: '2026-11-05' }];

  it('reads her week from Monday', () => {
    expect(weekOf('2026-11-05')).toBe('2026-11-02');
    expect(weekOf('2026-11-02')).toBe('2026-11-02');
    expect(weekOf('2026-11-08')).toBe('2026-11-02');
  });

  it('tells the same task by category and title, without case, accents nor spaces', () => {
    expect(sameTask(shoot, { category: 'content', title: 'tournage lingérie rouge ' })).toBe(true);
    expect(sameTask(shoot, { category: 'socials', title: 'Tournage lingerie rouge' })).toBe(false);
  });

  it('keeps it out the same week and the next, lets it back two weeks later', () => {
    expect(maySuggest(shoot, '2026-11-02', declined)).toBe(false);
    expect(maySuggest(shoot, '2026-11-09', declined)).toBe(false);
    expect(maySuggest(shoot, '2026-11-16', declined)).toBe(true);
    expect(maySuggest({ category: 'content', title: 'Live du dimanche' }, '2026-11-09', declined)).toBe(true);
  });
});
