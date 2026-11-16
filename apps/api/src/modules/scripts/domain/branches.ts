import { createHash } from 'node:crypto';

import type { BranchCondition, Currency, PlatformScriptStep } from '@impera/contracts';

/**
 * The branches of a native script (ADR 0112 § A): Reveal's model, a script is steps by rank and a step one or more
 * branches, each a sendable step of the platform known by its `stepRef`. Reveal gives no condition, no default and no
 * stable order for them (read on 16/11/2026): Impera holds those, set by the agency in the CRM, and keeps them across
 * imports by `stepRef`. Pure.
 */

/** A branch's settings as the agency set them (`platform_script_branches`), by its `stepRef`. */
export interface BranchSetting {
  readonly stepRef: string;
  /** Its place among the branches of its step, from 0. */
  readonly order: number;
  readonly condition: BranchCondition;
}

/** What the branch rules read of a step. */
interface BranchStep {
  readonly ref: string;
  /** The platform's rank: steps on the same are branches of one step. */
  readonly platformIndex: number;
  readonly priceMinor: number;
  readonly currency: Currency;
  /** The platform's ids of the media it sells (never its preview). */
  readonly soldMediaRefs: readonly string[];
}

/**
 * Same-rank branches in a stable order, whatever order Reveal lists them in: by rank, then by `stepRef`. What the
 * import keeps as positions and what a script's fingerprint is computed on, so that a second read of the same script
 * changes nothing (ADR 0112, remark Médias 16/11/2026).
 */
export function byRankThenRef<
  T extends { readonly platformIndex: number; readonly ref: { readonly id: string } },
>(steps: readonly T[]): T[] {
  return [...steps].sort(
    (a, b) => a.platformIndex - b.platformIndex || (a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : 0),
  );
}

/**
 * One branch as it is sold, in a stable form: its text, its price and its media, sold and preview. Changes only when
 * that branch changes on the platform, never with its neighbours: what a version of a branch is measured by (ADR 0129).
 */
export function platformStepFingerprint(
  step: Pick<PlatformScriptStep, 'ref' | 'text' | 'priceMinor' | 'currency' | 'media' | 'previewMedia'>,
): string {
  const canonical = JSON.stringify([
    step.ref.id,
    step.text,
    step.priceMinor,
    step.currency,
    step.media.map((media) => [media.ref.id, media.kind]),
    step.previewMedia.map((media) => [media.ref.id, media.kind]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** A step of the script, with its branches in the agency's order. */
export interface Rank<T> {
  readonly platformIndex: number;
  readonly branches: readonly T[];
}

/**
 * The script by rank, each rank with its branches in the agency's order (`order`), those it has not ordered after, by
 * `stepRef`. A setting of a branch Reveal no longer lists is ignored.
 */
export function ranksOf<T extends { readonly ref: string; readonly platformIndex: number }>(
  steps: readonly T[],
  settings: readonly BranchSetting[],
): Rank<T>[] {
  const orderOf = new Map(settings.map((setting) => [setting.stepRef, setting.order]));
  const ranks = new Map<number, T[]>();
  for (const step of steps) ranks.set(step.platformIndex, [...(ranks.get(step.platformIndex) ?? []), step]);
  const unordered = Number.MAX_SAFE_INTEGER;
  return [...ranks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([platformIndex, branches]) => ({
      platformIndex,
      branches: [...branches].sort(
        (a, b) =>
          (orderOf.get(a.ref) ?? unordered) - (orderOf.get(b.ref) ?? unordered) ||
          (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
      ),
    }));
}

/** The condition of a branch: `null` while unset, and always for the only branch of a step. */
export function conditionOf(
  rank: Rank<{ readonly ref: string }>,
  ref: string,
  settings: readonly BranchSetting[],
): BranchCondition | null {
  if (rank.branches.length < 2) return null;
  return settings.find((setting) => setting.stepRef === ref)?.condition ?? null;
}

type BranchGap =
  | 'branch_unsettled'
  | 'branch_two_defaults'
  | 'branch_cheaper_on_spend'
  | 'branch_previous_unknown'
  | 'media_twice';

/**
 * What keeps a script with branches from being offered (ADR 0112 §§ 2, 13, 14): a branch whose condition is unset; two
 * branches by default in a step; a condition on past spend that leads to a branch cheaper than the default; a
 * condition on the branch taken before that names no branch of an earlier step; the same sold media in two steps or
 * two branches, whichever the path. A script without branches has only the last.
 */
export function branchGaps(steps: readonly BranchStep[], settings: readonly BranchSetting[]): BranchGap[] {
  const gaps = new Set<BranchGap>();
  const ranks = ranksOf(steps, settings);
  ranks.forEach((rank, at) => {
    if (rank.branches.length < 2) return;
    const conditions = rank.branches.map((branch) => ({
      branch,
      condition: conditionOf(rank, branch.ref, settings),
    }));
    if (conditions.some(({ condition }) => condition === null)) gaps.add('branch_unsettled');
    const defaults = conditions.filter(({ condition }) => condition?.kind === 'none');
    if (defaults.length > 1) gaps.add('branch_two_defaults');
    const fallback = defaults.length === 1 ? defaults[0]?.branch : undefined;
    const earlier = new Set(ranks.slice(0, at).flatMap((each) => each.branches.map((branch) => branch.ref)));
    for (const { branch, condition } of conditions) {
      if (condition?.kind !== 'structured') continue;
      const { rule } = condition;
      if (rule.kind === 'previous_branch' && !earlier.has(rule.stepRef)) gaps.add('branch_previous_unknown');
      if (
        rule.kind === 'spent_at_least' &&
        fallback?.currency === branch.currency &&
        branch.priceMinor < fallback.priceMinor
      )
        gaps.add('branch_cheaper_on_spend');
    }
  });
  const seen = new Set<string>();
  for (const step of steps) {
    for (const ref of new Set(step.soldMediaRefs)) {
      if (seen.has(ref)) gaps.add('media_twice');
      seen.add(ref);
    }
  }
  return [...gaps];
}

/** A step with branches, none by default: its first position, where the warning shows. */
export function stepsWithoutDefault(
  steps: readonly (BranchStep & { readonly position: number })[],
  settings: readonly BranchSetting[],
): number[] {
  return ranksOf(steps, settings).flatMap((rank) => {
    if (rank.branches.length < 2) return [];
    const hasDefault = rank.branches.some(
      (branch) => conditionOf(rank, branch.ref, settings)?.kind === 'none',
    );
    const first = Math.min(...rank.branches.map((branch) => branch.position));
    return hasDefault ? [] : [first];
  });
}
