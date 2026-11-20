import type { BranchCondition, CopyDifference, Currency, PreparedScriptContent } from '@impera/contracts';

import type { BranchSetting } from './branches';

/**
 * The next import recognises a script copied into Reveal by hand (ADR 0112 § 23): a native script is tied to a script
 * « prêt à copier » only when everything matches, the same name, the same number of steps, the same branches at each
 * rank, the same media and the same prices. Texts are not compared: the platform's text is the one that goes. Without
 * an exact match nothing is tied, and the differences are said. Pure.
 */

/** A branch of a native script as the import keeps it. */
export interface NativeBranch {
  readonly ref: string;
  /** Reveal's rank: steps on the same are branches of one step. */
  readonly platformIndex: number;
  readonly priceMinor: number;
  readonly currency: Currency;
  /** The platform's ids of the media it sells (never its preview). */
  readonly soldMediaRefs: readonly string[];
}

export interface NativeScriptForMatch {
  readonly id: string;
  readonly name: string;
  readonly branches: readonly NativeBranch[];
}

export type MatchOutcome =
  | { readonly matched: true; readonly refs: ReadonlyMap<string, string> }
  | { readonly matched: false; readonly differences: readonly CopyDifference[] };

const sameName = (a: string, b: string) => a.trim() === b.trim();

const sameMedia = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const wanted = new Set(a);
  return wanted.size === new Set(b).size && b.every((ref) => wanted.has(ref));
};

/** The native ranks in order, each with its branches. */
function ranksOf(branches: readonly NativeBranch[]): NativeBranch[][] {
  const byRank = new Map<number, NativeBranch[]>();
  for (const branch of branches)
    byRank.set(branch.platformIndex, [...(byRank.get(branch.platformIndex) ?? []), branch]);
  return [...byRank.entries()].sort(([a], [b]) => a - b).map(([, rank]) => rank);
}

/**
 * The match of one script ready to copy against one native script: each of its branches tied to the native branch of
 * the same rank that sells the same media at the same price, each native branch taken once. The refs map a branch's
 * key to the native `stepRef`.
 */
export function matchPrepared(content: PreparedScriptContent, native: NativeScriptForMatch): MatchOutcome {
  if (!sameName(content.name, native.name))
    return { matched: false, differences: [{ code: 'name_not_found' }] };
  const ranks = ranksOf(native.branches);
  if (ranks.length !== content.steps.length)
    return {
      matched: false,
      differences: [{ code: 'steps_count', expected: content.steps.length, found: ranks.length }],
    };
  const differences: CopyDifference[] = [];
  const refs = new Map<string, string>();
  content.steps.forEach((step, at) => {
    const rank = ranks[at] ?? [];
    if (rank.length !== step.branches.length) {
      differences.push({
        code: 'branches_count',
        step: at,
        expected: step.branches.length,
        found: rank.length,
      });
      return;
    }
    const taken = new Set<string>();
    for (const branch of step.branches) {
      const twin = rank.find(
        (candidate) =>
          !taken.has(candidate.ref) &&
          candidate.priceMinor === branch.priceMinor &&
          candidate.currency === branch.currency &&
          sameMedia(
            branch.media.map((media) => media.ref),
            candidate.soldMediaRefs,
          ),
      );
      if (twin === undefined) {
        differences.push({ code: 'branch_not_found', step: at, branch: branch.key });
        continue;
      }
      taken.add(twin.ref);
      refs.set(branch.key, twin.ref);
    }
  });
  return differences.length === 0 ? { matched: true, refs } : { matched: false, differences };
}

/** A condition with its `previous_branch` rule turned from a branch's key into the native `stepRef`. */
function conditionFor(condition: BranchCondition | null, refs: ReadonlyMap<string, string>): BranchCondition {
  if (condition === null) return { kind: 'none' };
  if (condition.kind !== 'structured' || condition.rule.kind !== 'previous_branch') return condition;
  const stepRef = refs.get(condition.rule.stepRef);
  // A key the match does not know cannot happen: the gaps refuse it before « prêt à copier ».
  return stepRef === undefined
    ? { kind: 'none' }
    : { kind: 'structured', rule: { kind: 'previous_branch', stepRef } };
}

/**
 * The settings that only live at Impera, passed to the native script (§ 23): for each step of several branches, their
 * order and condition, as the agency wrote them. A step of one branch needs none.
 */
export function transferredSettings(
  content: PreparedScriptContent,
  refs: ReadonlyMap<string, string>,
): BranchSetting[] {
  return content.steps.flatMap((step) =>
    step.branches.length < 2
      ? []
      : step.branches.flatMap((branch, order) => {
          const stepRef = refs.get(branch.key);
          return stepRef === undefined
            ? []
            : [{ stepRef, order, condition: conditionFor(branch.condition, refs) }];
        }),
  );
}

export interface PreparedForMatch {
  readonly id: string;
  readonly content: PreparedScriptContent;
}

export interface Recognition {
  readonly preparedId: string;
  readonly nativeId: string;
  readonly settings: readonly BranchSetting[];
}

/**
 * The recognitions of one import: each script ready to copy, the oldest first, tied to the first native script it
 * matches exactly that no other took. A native script is tied once.
 */
export function recognise(
  prepared: readonly PreparedForMatch[],
  natives: readonly NativeScriptForMatch[],
): Recognition[] {
  const taken = new Set<string>();
  const recognitions: Recognition[] = [];
  for (const script of prepared) {
    for (const native of natives) {
      if (taken.has(native.id)) continue;
      const outcome = matchPrepared(script.content, native);
      if (!outcome.matched) continue;
      taken.add(native.id);
      recognitions.push({
        preparedId: script.id,
        nativeId: native.id,
        settings: transferredSettings(script.content, outcome.refs),
      });
      break;
    }
  }
  return recognitions;
}

/**
 * What differs, for the screen: against the native script of the same name that differs least, or `name_not_found`.
 * Empty when one matches exactly.
 */
export function copyDifferences(
  content: PreparedScriptContent,
  natives: readonly NativeScriptForMatch[],
): readonly CopyDifference[] {
  let best: readonly CopyDifference[] | null = null;
  for (const native of natives) {
    if (!sameName(content.name, native.name)) continue;
    const outcome = matchPrepared(content, native);
    if (outcome.matched) return [];
    if (best === null || outcome.differences.length < best.length) best = outcome.differences;
  }
  return best ?? [{ code: 'name_not_found' }];
}
