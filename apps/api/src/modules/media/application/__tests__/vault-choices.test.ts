import { CreatorIdSchema, PlatformAccountIdSchema, type VaultDescribeAsk } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { VaultDescribeOverCap } from '../../domain/errors';
import type { DescribeCandidate } from '../../domain/vault-choice';
import { askVaultDescriptions, type VaultChoiceStore } from '../vault-choices';

/* An invented vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const photo = (platformMediaId: string): DescribeCandidate => ({
  platformMediaId,
  kind: 'image',
  removed: false,
  imported: true,
  linked: false,
  asked: false,
  failures: 0,
});

/** A store that decides on these media and keeps what a decision asks. */
function storeOf(media: readonly DescribeCandidate[]) {
  const asked: string[] = [];
  const store: VaultChoiceStore = {
    view: () => Promise.resolve(null),
    set: () => Promise.resolve('set'),
    ask: (_creatorId, _userId, _request, decide) => {
      const decision = decide(new Map(media.map((each) => [each.platformMediaId, each])));
      asked.push(...decision.insert);
      return Promise.resolve(decision.answer);
    },
  };
  return { store, asked };
}

const ask = (confirm: VaultDescribeAsk['confirm']): VaultDescribeAsk => ({
  platformAccountId: ACCOUNT,
  platformMediaIds: ['p1', 'p2', 'p3'],
  confirm,
  idempotencyKey: '0192f3a0-0000-7000-8000-00000000f001',
});

describe('« Décrire par IA », against what is left of the day (ADR 0145 § 5)', () => {
  const media = [photo('p1'), photo('p2'), photo('p3')];

  it('shows the estimate with what is left of the ceiling, then asks it once confirmed', async () => {
    const { store, asked } = storeOf(media);
    const deps = { store, budget: () => ({ spentEur: 19.9, capEur: 20 }) };
    // 3 × 0.5 c€ = 1.5 c€, said 2 c€; 10 c€ left.
    const shown = await askVaultDescriptions(deps, CREATOR, 'u-owner', ask(null), 'test');
    expect(shown).toMatchObject({ status: 'estimate', count: 3, costCents: 2, capLeftCents: 10 });
    expect(
      await askVaultDescriptions(deps, CREATOR, 'u-owner', ask({ count: 3, costCents: 2 }), 'test'),
    ).toEqual({ status: 'asked', count: 3 });
    expect(asked).toEqual(['p1', 'p2', 'p3']);
  });

  it('refuses a confirmed run dearer than what is left of the day, asking nothing', async () => {
    const { store, asked } = storeOf(media);
    const deps = { store, budget: () => ({ spentEur: 19.99, capEur: 20 }) };
    await expect(
      askVaultDescriptions(deps, CREATOR, 'u-owner', ask({ count: 3, costCents: 2 }), 'test'),
    ).rejects.toBeInstanceOf(VaultDescribeOverCap);
    expect(asked).toEqual([]);
  });
});
