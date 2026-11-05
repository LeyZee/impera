import { describe, expect, it } from 'vitest';

import {
  decide,
  doneDays,
  maySuggest,
  repeatsOpen,
  sameTask,
  SuggestionDecidedError,
  weekOf,
} from '../suggestions';

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

describe('doneDays', () => {
  it('counts her routine within the suggestion’s week only, each day once', () => {
    expect(
      doneDays('routine', '2026-11-02', [
        '2026-11-01',
        '2026-11-02',
        '2026-11-02',
        '2026-11-08',
        '2026-11-09',
      ]),
    ).toBe(2);
  });

  it('counts every tick of a dated task, whatever week she moved it to', () => {
    expect(doneDays('day', '2026-11-02', ['2026-11-12'])).toBe(1);
    expect(doneDays('timed', '2026-11-02', [])).toBe(0);
  });
});

describe('a suggestion that repeats one still open (CREA-16)', () => {
  const live = { category: 'live', title: 'Live hors dispo', moment: '["timed","a"]' };

  it('is the same task at the same moment, or the same task where either found no room', () => {
    expect(repeatsOpen({ ...live, title: 'live hors dispo ' }, [live])).toBe(true);
    expect(repeatsOpen({ ...live, moment: null }, [live])).toBe(true);
    expect(repeatsOpen(live, [{ ...live, moment: null }])).toBe(true);
  });

  it('is not another moment, nor another task', () => {
    expect(repeatsOpen({ ...live, moment: '["timed","b"]' }, [live])).toBe(false);
    expect(repeatsOpen({ ...live, title: 'Live du soir' }, [live])).toBe(false);
    expect(repeatsOpen(live, [])).toBe(false);
  });
});
