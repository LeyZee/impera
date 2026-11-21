import { describe, expect, it } from 'vitest';

import { dayHeroOf } from './model';

describe('« L’essentiel du jour » on her Aujourd’hui', () => {
  it('adds her posts, her tasks and what she owes the agency', () => {
    const hero = dayHeroOf({ essentials: { done: 2, total: 4 }, tasks: { done: 1, total: 2 }, toSend: 1 });
    expect(hero).toMatchObject({ done: 3, total: 7, title: 'L’essentiel du jour' });
    expect(hero?.line).toBe('Encore 4 choses pour boucler ta journée.');
    expect(hero?.chips.map((c) => c.words)).toEqual(['À poster 2/4', 'Tâches 1/2', '1 envoi à faire']);
    expect(new Set(hero?.chips.map((c) => c.colour)).size).toBe(3);
  });

  it('adapts to what exists: a day with tasks only counts tasks', () => {
    const hero = dayHeroOf({ essentials: null, tasks: { done: 0, total: 3 }, toSend: 0 });
    expect(hero?.total).toBe(3);
    expect(hero?.chips.map((c) => c.part)).toEqual(['tasks']);
  });

  it('says the day is done, and an empty day is not a failure', () => {
    expect(dayHeroOf({ essentials: { done: 3, total: 3 }, tasks: null, toSend: 0 })?.title).toBe(
      'Tout est fait',
    );
    expect(dayHeroOf({ essentials: { done: 0, total: 0 }, tasks: null, toSend: 0 })).toMatchObject({
      total: 0,
      share: 0,
    });
  });

  it('shows nothing while nothing is read', () => {
    expect(dayHeroOf({ essentials: null, tasks: null, toSend: null })).toBeNull();
  });
});
