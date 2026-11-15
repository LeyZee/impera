import { describe, expect, it } from 'vitest';

import { medalLabel, tierMedals } from './metals';

const tier = (thresholdMinor: number, label: string) => ({ thresholdMinor, label });

describe('tierMedals', () => {
  it('follows the names Bronze, Argent, Or, whatever their case or order', () => {
    const medals = tierMedals([tier(200_000, 'OR'), tier(50_000, 'bronze'), tier(100_000, 'Argent')]);
    expect(medals.of(50_000)).toEqual({ metal: 'bronze', rank: 1 });
    expect(medals.of(100_000)).toEqual({ metal: 'argent', rank: 2 });
    expect(medals.of(200_000)).toEqual({ metal: 'or', rank: 3 });
  });

  it('reads any other ladder from the top: gold, silver, then bronze', () => {
    const medals = tierMedals([tier(10, 'Un'), tier(20, 'Deux'), tier(30, 'Trois'), tier(40, 'Quatre')]);
    expect(medals.of(40)).toEqual({ metal: 'or', rank: 4 });
    expect(medals.of(30)).toEqual({ metal: 'argent', rank: 3 });
    expect(medals.of(20)).toEqual({ metal: 'bronze', rank: 2 });
    expect(medals.of(10)).toEqual({ metal: 'bronze', rank: 1 });
  });

  it('gives gold to a lone tier and to the higher of two', () => {
    expect(tierMedals([tier(10, 'Prime')]).of(10)).toEqual({ metal: 'or', rank: 1 });
    const two = tierMedals([tier(10, 'Petit'), tier(20, 'Grand')]);
    expect(two.of(10)).toEqual({ metal: 'argent', rank: 1 });
    expect(two.of(20)).toEqual({ metal: 'or', rank: 2 });
  });

  it('reads from the top as soon as one name is not a metal', () => {
    const medals = tierMedals([tier(10, 'Bronze'), tier(20, 'Argent'), tier(30, 'Diamant')]);
    expect(medals.of(10)?.metal).toBe('bronze');
    expect(medals.of(30)?.metal).toBe('or');
  });

  it('knows no tier it was not given', () => {
    expect(tierMedals([]).of(10)).toBeNull();
  });
});

describe('medalLabel', () => {
  it('names the object and whether it is earned', () => {
    expect(medalLabel({ metal: 'or', rank: 3 }, true)).toBe('Médaille d’or');
    expect(medalLabel({ metal: 'argent', rank: 2 }, false)).toBe('Médaille d’argent, pas encore gagnée');
  });
});
