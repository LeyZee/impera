import { DESCRIPTION_TRIES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  capLeftCents,
  confirms,
  descriptionStateOf,
  estimateVaultDescriptions,
  excerptOf,
  type DescribeCandidate,
} from '../vault-choice';

const candidate = (id: string, over: Partial<DescribeCandidate> = {}): DescribeCandidate => ({
  platformMediaId: id,
  kind: 'image',
  removed: false,
  imported: true,
  linked: false,
  asked: false,
  failures: 0,
  ...over,
});
const known = (...all: DescribeCandidate[]) => new Map(all.map((each) => [each.platformMediaId, each]));

describe('the estimate of a description asked (ADR 0145 § 5)', () => {
  it('counts only an imported photo or video never described nor asked, each once, and rounds the cost up', () => {
    const estimate = estimateVaultDescriptions(
      ['p1', 'p2', 'v1', 'p1', 'unknown', 'voice', 'gone', 'done', 'asked', 'out', 'failed'],
      known(
        candidate('p1'),
        candidate('p2'),
        candidate('v1', { kind: 'video' }),
        candidate('voice', { kind: 'audio' }),
        candidate('gone', { removed: true }),
        candidate('done', { linked: true }),
        candidate('asked', { asked: true }),
        candidate('out', { imported: false }),
        candidate('failed', { failures: DESCRIPTION_TRIES }),
      ),
    );
    expect(estimate).toEqual({
      count: 3,
      photos: 2,
      videos: 1,
      alreadyDescribed: 1,
      alreadyAsked: 1,
      notImported: 1,
      notDescribable: 4,
      // 2 × 0.5 c€ + 1.5 c€ = 2.5 c€, said 3 c€: the estimate never says less than the spend.
      costCents: 3,
      toAsk: ['p1', 'p2', 'v1'],
    });
  });

  it('costs nothing when nothing is left to describe', () => {
    expect(estimateVaultDescriptions(['done'], known(candidate('done', { linked: true })))).toMatchObject({
      count: 0,
      costCents: 0,
      toAsk: [],
    });
  });

  it('holds a confirmation only for the very count and cost it was shown', () => {
    const estimate = { count: 3, costCents: 3 };
    expect(confirms({ count: 3, costCents: 3 }, estimate)).toBe(true);
    expect(confirms(null, estimate)).toBe(false);
    expect(confirms({ count: 2, costCents: 3 }, estimate)).toBe(false);
    expect(confirms({ count: 3, costCents: 2 }, estimate)).toBe(false);
    expect(confirms({ count: 1, costCents: 0 }, { count: 0, costCents: 0 })).toBe(false);
  });

  it('says what is left of the day’s cap in whole cents, never below zero', () => {
    expect(capLeftCents({ spentEur: 3.255, capEur: 20 })).toBe(1674);
    expect(capLeftCents({ spentEur: 21, capEur: 20 })).toBe(0);
  });
});

describe('a vault media’s description, for the screen', () => {
  it('is described once linked, left to the agency after its tries, else asked or not', () => {
    const base = {
      kind: 'image' as const,
      removed: false,
      imported: true,
      linked: false,
      asked: false,
      failures: 0,
    };
    expect(descriptionStateOf({ ...base, linked: true, asked: true })).toBe('described');
    expect(descriptionStateOf({ ...base, failures: DESCRIPTION_TRIES, asked: true })).toBe('to_agency');
    expect(descriptionStateOf({ ...base, asked: true })).toBe('asked');
    expect(descriptionStateOf(base)).toBe('none');
  });

  it('shows the beginning of a description, cut on a word', () => {
    expect(excerptOf(null, 20)).toBeNull();
    expect(excerptOf('   ', 20)).toBeNull();
    expect(excerptOf('Une photo  inventée.', 20)).toBe('Une photo inventée.');
    expect(excerptOf('Une photo inventée dans un salon inventé', 20)).toBe('Une photo inventée…');
  });
});
