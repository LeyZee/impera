import {
  normaliseWords,
  type MediaSlotKind,
  type PersonaLimits,
  type PreparedScriptContent,
  type PreparedScriptGap,
  type PreparedScriptGapCode,
  type PreparedScriptState,
  type PreparedScriptWarning,
  type StaircaseSetting,
} from '@impera/contracts';

import { branchGaps, type BranchSetting } from './branches';
import { priceNotAbovePrevious, priceWarnings } from './platform-scripts';

/**
 * Scripts in preparation (ADR 0112 §§ 20-23): what keeps one from « prêt à copier », and its price warnings, with the
 * same rules as a native script (§§ 13-14), read on the keys of its steps and branches instead of Reveal's refs. Pure.
 */

/** Where a media of her vault stands, by the platform's id; absent from the map: her vault does not list it. */
export interface PreparedVaultMedia {
  readonly kind: MediaSlotKind;
  /** A description of its media a human validated (ADR 0083). */
  readonly described: boolean;
  /** Offered once (ADR 0145 § 2): sent for free by the platform, or out in a drop that leaves for free. */
  readonly offered: boolean;
}

/** One branch, as the shared branch rules read it: its key in place of a `stepRef`. */
function asPlatformSteps(content: PreparedScriptContent) {
  return content.steps.flatMap((step, platformIndex) =>
    step.branches.map((branch) => ({
      ref: branch.key,
      platformIndex,
      priceMinor: branch.priceMinor,
      currency: branch.currency,
      soldMediaRefs: branch.media.map((media) => media.ref),
      spendBranch: branch.condition?.kind === 'structured' && branch.condition.rule.kind === 'spent_at_least',
    })),
  );
}

function settingsOf(content: PreparedScriptContent): BranchSetting[] {
  return content.steps.flatMap((step) =>
    step.branches.length < 2
      ? []
      : step.branches.flatMap((branch, order) =>
          branch.condition === null ? [] : [{ stepRef: branch.key, order, condition: branch.condition }],
        ),
  );
}

/** The persona's entries a sentence she says must not touch: what she never says, never does, what disgusts her. */
function limitTerms(limits: PersonaLimits) {
  return [...limits.never_say, ...limits.never_do, ...limits.disgusts]
    .map((term) => ({ term, words: normaliseWords(term) }))
    .filter((entry) => entry.words !== '');
}

const gap = (
  code: PreparedScriptGapCode,
  step: number | null = null,
  branch: string | null = null,
  term: string | null = null,
): PreparedScriptGap => ({ code, step, branch, term });

/** Script-wide gaps of the shared rules, placed on the first branch they concern when the rules say which. */
const SHARED: readonly PreparedScriptGapCode[] = [
  'branch_unsettled',
  'branch_two_defaults',
  'branch_cheaper_on_spend',
  'branch_previous_unknown',
  'media_twice',
];

/**
 * What keeps the script from « prêt à copier »: the script's name and description; for each branch its offer text, at
 * least one media, each media in her vault and, photo or video, described, and on a paid branch never one offered
 * once; a condition in text that says something;
 * the shared branch rules (§§ 2, 13, 14); and no text touching her limits. `limits` is `null` without an active
 * persona: nothing is checked against it then, and the screen says so.
 */
export function preparedScriptGaps(
  content: PreparedScriptContent,
  vault: ReadonlyMap<string, PreparedVaultMedia>,
  limits: PersonaLimits | null,
): PreparedScriptGap[] {
  const gaps: PreparedScriptGap[] = [];
  if (content.name.trim() === '') gaps.push(gap('name_missing'));
  if (content.description.trim() === '') gaps.push(gap('description_missing'));
  const terms = limits === null ? [] : limitTerms(limits);
  content.steps.forEach((step, at) => {
    for (const branch of step.branches) {
      if (branch.offerText.trim() === '') gaps.push(gap('offer_text_missing', at, branch.key));
      if (branch.media.length === 0) gaps.push(gap('media_missing', at, branch.key));
      const absent = branch.media.some((media) => !vault.has(media.ref));
      if (absent) gaps.push(gap('media_absent', at, branch.key));
      const undescribed = branch.media.some((media) => {
        const known = vault.get(media.ref);
        return known !== undefined && known.kind !== 'audio' && !known.described;
      });
      if (undescribed) gaps.push(gap('media_not_described', at, branch.key));
      // « Un média offert n'est jamais revendu » (ADR 0145 § 2): a paid branch never sells one.
      if (branch.priceMinor > 0 && branch.media.some((media) => vault.get(media.ref)?.offered === true))
        gaps.push(gap('media_offered', at, branch.key));
      if (
        step.branches.length > 1 &&
        branch.condition?.kind === 'text' &&
        branch.condition.text.trim() === ''
      )
        gaps.push(gap('condition_text_missing', at, branch.key));
      const said = ` ${normaliseWords(
        [
          branch.teaser,
          branch.offerText,
          branch.afterMedia.justAfter,
          branch.afterMedia.unread,
          branch.afterMedia.readNotBought,
        ].join(' '),
      )} `;
      const touched = new Set<string>();
      for (const { term, words } of terms) {
        if (touched.has(words) || !said.includes(` ${words} `)) continue;
        touched.add(words);
        gaps.push(gap('disgust', at, branch.key, term));
      }
    }
  });
  // The staircase (avenant du 27/11/2026), path by path: a paid branch above the last paid step of each of its paths.
  const flat = asPlatformSteps(content);
  for (const position of priceNotAbovePrevious(flat)) {
    const branch = flat[position];
    if (branch !== undefined) gaps.push(gap('price_not_above_previous', branch.platformIndex, branch.ref));
  }
  const shared = new Set<string>(branchGaps(asPlatformSteps(content), settingsOf(content)));
  for (const code of SHARED) if (shared.has(code)) gaps.push(gap(code));
  return gaps;
}

/** The price warnings of § 14, path by path, on the branch they concern; `step_without_default` on its step. */
export function preparedScriptWarnings(
  content: PreparedScriptContent,
  staircase?: StaircaseSetting,
): PreparedScriptWarning[] {
  const flat = asPlatformSteps(content);
  const jump = staircase?.spendBranchJumpMultiple;
  const options = jump === undefined ? {} : { spendBranchJumpMultiple: jump };
  const warnings: PreparedScriptWarning[] = priceWarnings(flat, options).map((warning) => {
    const branch = flat[warning.position];
    return { code: warning.code, step: branch?.platformIndex ?? 0, branch: branch?.ref ?? null };
  });
  content.steps.forEach((step, at) => {
    if (step.branches.length > 1 && !step.branches.some((branch) => branch.condition?.kind === 'none'))
      warnings.push({ code: 'step_without_default', step: at, branch: null });
  });
  return warnings.sort((a, b) => a.step - b.step);
}

export type PreparedTransition = 'save' | 'ready' | 'editing';

/**
 * Whether a change is allowed: a matched script is closed for good; « prêt » asks for no gap; a save of a script
 * « prêt à copier » takes it back to editing (what someone may be copying has changed).
 */
export function preparedTransition(
  state: PreparedScriptState,
  transition: PreparedTransition,
  gapCount: number,
):
  | { readonly ok: true; readonly next: PreparedScriptState }
  | { readonly ok: false; readonly reason: 'closed' | 'gaps' } {
  if (state === 'matched') return { ok: false, reason: 'closed' };
  if (transition === 'ready')
    return gapCount === 0 ? { ok: true, next: 'ready_to_copy' } : { ok: false, reason: 'gaps' };
  return { ok: true, next: 'editing' };
}
