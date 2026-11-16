import type { BranchCondition } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  branchGaps,
  byRankThenRef,
  conditionOf,
  platformStepFingerprint,
  ranksOf,
  stepsWithoutDefault,
  type BranchSetting,
} from '../branches';

/** An invented step: its ref, its rank, its price in cents and the media it sells. */
function step(ref: string, platformIndex: number, priceMinor = 0, soldMediaRefs: string[] = [`m_${ref}`]) {
  return { ref, platformIndex, priceMinor, currency: 'EUR' as const, soldMediaRefs };
}

const none: BranchCondition = { kind: 'none' };
const text: BranchCondition = { kind: 'text', text: "S'il a dit aimer la lingerie" };
const spent = (amountMinor: number): BranchCondition => ({
  kind: 'structured',
  rule: { kind: 'spent_at_least', amountMinor, currency: 'EUR' },
});
const set = (stepRef: string, order: number, condition: BranchCondition): BranchSetting => ({
  stepRef,
  order,
  condition,
});

describe('the order of branches', () => {
  it('keeps one order whatever order Reveal lists the branches of a step in', () => {
    const at = (id: string, platformIndex: number) => ({ ref: { id }, platformIndex });
    const order = (listed: { ref: { id: string }; platformIndex: number }[]) =>
      byRankThenRef(listed).map((each) => each.ref.id);
    expect(order([at('s3', 1), at('s1', 0), at('s2', 1)])).toEqual(['s1', 's2', 's3']);
    expect(order([at('s2', 1), at('s3', 1), at('s1', 0)])).toEqual(['s1', 's2', 's3']);
  });

  it("reads a step's branches in the agency's order, those it did not order after, by ref", () => {
    const steps = [step('a', 0), step('c', 1), step('b', 1), step('d', 1)];
    const ranks = ranksOf(steps, [set('d', 0, none), set('c', 1, text)]);
    expect(ranks.map((rank) => rank.branches.map((branch) => branch.ref))).toEqual([['a'], ['d', 'c', 'b']]);
  });

  it('gives no condition to the only branch of a step, and none to an unset one', () => {
    const steps = [step('a', 0), step('b', 1), step('c', 1)];
    const settings = [set('a', 0, text), set('b', 0, none)];
    const [first, second] = ranksOf(steps, settings);
    if (first === undefined || second === undefined) throw new Error('two ranks');
    expect(conditionOf(first, 'a', settings)).toBeNull();
    expect(conditionOf(second, 'b', settings)).toEqual(none);
    expect(conditionOf(second, 'c', settings)).toBeNull();
  });
});

describe('what keeps a script with branches from being offered (ADR 0112 §§ 2, 13, 14)', () => {
  const steps = [step('a', 0, 500), step('b', 1, 1_500), step('c', 1, 2_500)];

  it('offers a script without branches as before', () => {
    expect(branchGaps([step('a', 0, 0), step('b', 1, 1_000)], [])).toEqual([]);
  });

  it('waits for a condition on every branch of a step that has several', () => {
    expect(branchGaps(steps, [])).toEqual(['branch_unsettled']);
    expect(branchGaps(steps, [set('b', 0, none)])).toEqual(['branch_unsettled']);
    expect(branchGaps(steps, [set('b', 0, none), set('c', 1, text)])).toEqual([]);
  });

  it('ignores the setting of a branch Reveal no longer lists, and asks for a new branch', () => {
    const settings = [set('b', 0, none), set('gone', 1, text)];
    expect(branchGaps(steps, settings)).toEqual(['branch_unsettled']);
  });

  it('refuses two branches by default in one step', () => {
    expect(branchGaps(steps, [set('b', 0, none), set('c', 1, none)])).toEqual(['branch_two_defaults']);
  });

  it('refuses a condition on past spend that leads to a branch cheaper than the default', () => {
    const cheaper = [step('a', 0, 500), step('b', 1, 2_500), step('c', 1, 1_500)];
    expect(branchGaps(cheaper, [set('b', 0, none), set('c', 1, spent(10_000))])).toEqual([
      'branch_cheaper_on_spend',
    ]);
    expect(branchGaps(steps, [set('b', 0, none), set('c', 1, spent(10_000))])).toEqual([]);
  });

  it('refuses a condition on the branch taken before that names no branch of an earlier step', () => {
    const later = [...steps, step('d', 2, 3_000), step('e', 2, 3_000)];
    const previous = (stepRef: string): BranchCondition => ({
      kind: 'structured',
      rule: { kind: 'previous_branch', stepRef },
    });
    const base = [set('b', 0, none), set('c', 1, text), set('d', 0, none)];
    expect(branchGaps(later, [...base, set('e', 1, previous('c'))])).toEqual([]);
    expect(branchGaps(later, [...base, set('e', 1, previous('d'))])).toEqual(['branch_previous_unknown']);
    expect(branchGaps(later, [...base, set('e', 1, previous('nowhere'))])).toEqual([
      'branch_previous_unknown',
    ]);
  });

  it('refuses the same sold media in two steps or two branches', () => {
    expect(branchGaps([step('a', 0, 500, ['m1']), step('b', 1, 900, ['m1'])], [])).toEqual(['media_twice']);
    const twins = [step('a', 0, 500), step('b', 1, 900, ['m2']), step('c', 1, 900, ['m2'])];
    expect(branchGaps(twins, [set('b', 0, none), set('c', 1, text)])).toEqual(['media_twice']);
  });
});

describe('a step with branches and none by default', () => {
  it('is a warning at its first position, never a refusal', () => {
    const steps = [
      { ...step('a', 0), position: 0 },
      { ...step('b', 1), position: 1 },
      { ...step('c', 1), position: 2 },
    ];
    expect(stepsWithoutDefault(steps, [set('b', 0, text), set('c', 1, spent(5_000))])).toEqual([1]);
    expect(stepsWithoutDefault(steps, [set('b', 0, text), set('c', 1, none)])).toEqual([]);
  });
});

describe('the fingerprint of one branch', () => {
  const reveal = (id: string) => ({ platform: 'reveal' as const, id });
  const branch = {
    ref: reveal('s1'),
    text: 'Coucou',
    priceMinor: 900,
    currency: 'EUR' as const,
    media: [{ ref: reveal('m1'), kind: 'image' as const }],
    previewMedia: [{ ref: reveal('m2'), kind: 'image' as const }],
  };

  it('changes with its text, price, sold media or preview, and only with them', () => {
    const base = platformStepFingerprint(branch);
    expect(platformStepFingerprint({ ...branch })).toBe(base);
    for (const changed of [
      { ...branch, text: 'Autre' },
      { ...branch, priceMinor: 1_000 },
      { ...branch, media: [{ ref: reveal('m3'), kind: 'image' as const }] },
      { ...branch, previewMedia: [] },
    ])
      expect(platformStepFingerprint(changed)).not.toBe(base);
  });
});
