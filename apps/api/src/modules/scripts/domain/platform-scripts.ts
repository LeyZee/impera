import { createHash } from 'node:crypto';

import {
  PLATFORM_SCRIPT_GAPS,
  PLATFORM_SCRIPT_NAME_MAX,
  PLATFORM_SCRIPT_REF_MAX,
  PLATFORM_SCRIPT_STEP_MEDIA_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  PLATFORM_SCRIPT_STEPS_MAX,
  type Currency,
  type MediaSlotKind,
  type PlatformScript,
} from '@impera/contracts';

import { byRankThenRef } from './branches';

/**
 * The import of the native scripts (ADR 0099 § 1, time 2; P6-01): each script the platform keeps for an account, its
 * steps in the platform's order (`stepIndex`, ADR 0099 § 3), its prices read as they are. The platform is the source:
 * Impera never writes a script here, it mirrors them. A script gone from the platform is deactivated, never deleted (a
 * run or a reward may still name it); one back again is active again.
 */

/**
 * The warning ceiling of a step's price: 40 € VAT included, in minor units (P6-01; unit confirmed by Charles on
 * 14/11/2026). A warning to the agency at import, never a refusal: the price stays the platform's.
 */
const PLATFORM_SCRIPT_PRICE_CEILING_MINOR = 4000;

type PlatformScriptWarningCode = 'price_more_than_double' | 'price_above_ceiling' | 'step_without_default';

/** A step whose price the agency should look at; `position` counts from 0, as the platform's `stepIndex`. */
export interface PlatformScriptWarning {
  readonly code: PlatformScriptWarningCode;
  readonly position: number;
}

interface PricedStep {
  /** The platform's rank: steps on the same are branches of one step (ADR 0112), never one after the other. */
  readonly platformIndex: number;
  readonly priceMinor: number;
  readonly currency: Currency;
}

/**
 * P6-01, path by path (ADR 0112 § 14): a paid step that costs more than twice the paid step before it on some path
 * (tripling cut the old bot's sales short), or more than the ceiling. Free steps neither warn nor reset the comparison:
 * the step before is the last paid one of the path. A change of currency between two paid steps compares nothing.
 * Without branches, a path is the script.
 */
export function priceWarnings(steps: readonly PricedStep[]): PlatformScriptWarning[] {
  const warnings: PlatformScriptWarning[] = [];
  const ranks = [...new Set(steps.map((step) => step.platformIndex))].sort((a, b) => a - b);
  // The last paid step of the paths that reach this rank, each once; `null` for a path with none paid yet.
  let before: ReadonlySet<PricedStep | null> = new Set([null]);
  for (const rank of ranks) {
    const after = new Set<PricedStep | null>();
    steps.forEach((step, position) => {
      if (step.platformIndex !== rank) return;
      if (step.priceMinor === 0) {
        for (const previous of before) after.add(previous);
        return;
      }
      if (
        [...before].some(
          (previous) =>
            previous !== null &&
            previous.currency === step.currency &&
            step.priceMinor > 2 * previous.priceMinor,
        )
      )
        warnings.push({ code: 'price_more_than_double', position });
      if (step.currency === 'EUR' && step.priceMinor > PLATFORM_SCRIPT_PRICE_CEILING_MINOR)
        warnings.push({ code: 'price_above_ceiling', position });
      after.add(step);
    });
    before = after;
  }
  return warnings.sort((a, b) => a.position - b.position);
}

/**
 * What a script is, as the platform says it, in a stable form: its name, its moment, each step in order with its
 * text, its price and its media in order. Two reads that give the same fingerprint changed nothing.
 */
export function platformScriptFingerprint(script: PlatformScript): string {
  const canonical = JSON.stringify([
    script.name,
    script.moment,
    script.steps.map((step) => [
      step.ref.id,
      step.index,
      step.platformIndex,
      step.name,
      step.text,
      step.priceMinor,
      step.currency,
      step.media.map((media) => [media.ref.id, media.kind]),
      step.previewMedia.map((media) => [media.ref.id, media.kind]),
    ]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** At most `max` UTF-16 units, never half of an emoji: the platform's text is cut, not refused (as the vault's). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/**
 * A script as Impera keeps it, within the base's bounds (`PLATFORM_SCRIPT_*_MAX`): its names and texts cut; `null`
 * when it has more steps or more media in a step than the bounds, or a platform id longer, which are not cut (a step
 * or a media dropped would sell another script than the platform's).
 */
export function boundedPlatformScript(script: PlatformScript): PlatformScript | null {
  const refs = [
    script.ref.id,
    ...script.steps.flatMap((step) => [
      step.ref.id,
      ...[...step.media, ...step.previewMedia].map((media) => media.ref.id),
    ]),
  ];
  if (
    script.steps.length > PLATFORM_SCRIPT_STEPS_MAX ||
    script.steps.some(
      (step) =>
        step.media.length > PLATFORM_SCRIPT_STEP_MEDIA_MAX ||
        step.previewMedia.length > PLATFORM_SCRIPT_STEP_MEDIA_MAX,
    ) ||
    refs.some((ref) => ref.length > PLATFORM_SCRIPT_REF_MAX)
  )
    return null;
  return {
    ...script,
    name: cut(script.name, PLATFORM_SCRIPT_NAME_MAX),
    steps: script.steps.map((step) => ({
      ...step,
      name: cut(step.name, PLATFORM_SCRIPT_NAME_MAX),
      text: cut(step.text, PLATFORM_SCRIPT_STEP_TEXT_MAX),
    })),
  };
}

/** A native script already imported for the account, as the base keeps it. */
export interface KnownPlatformScript {
  readonly id: string;
  readonly ref: string;
  readonly fingerprint: string;
  readonly active: boolean;
}

/** What one import does to the account's scripts. */
export interface PlatformScriptsPlan {
  /** Read for the first time. */
  readonly added: readonly PlatformScript[];
  /** Known, and changed on the platform (or back after it was gone): rewritten whole, active. */
  readonly changed: readonly { readonly id: string; readonly script: PlatformScript }[];
  /** Known, unchanged and active: only their reading time moves. */
  readonly unchanged: readonly string[];
  /** Known and active, gone from the platform: deactivated, never deleted. */
  readonly gone: readonly string[];
  /**
   * Listed, but out of the bounds (`boundedPlatformScript`): not imported. One already known stays as it was, neither
   * rewritten nor gone. Counted only.
   */
  readonly refused: number;
}

/**
 * Its steps by rank, and the branches of a rank by `stepRef` (`byRankThenRef`), each `index` its place in that order:
 * Reveal lists the branches of a step in no stable order, and two reads of the same script must keep the same.
 */
function stableOrder(script: PlatformScript): PlatformScript {
  return {
    ...script,
    steps: byRankThenRef(script.steps).map((step, index) => ({ ...step, index })),
  };
}

/**
 * The plan of one import, from the scripts the platform lists now and those the base knows. A script listed twice
 * by the platform is taken once (its first listing). Its steps keep the platform's order, the branches of a step by
 * `stepRef` (`stableOrder`), and `index` is the position kept. Each is bounded first
 * (`boundedPlatformScript`): what the plan carries is what the base keeps.
 */
export function planPlatformScripts(
  known: readonly KnownPlatformScript[],
  listed: readonly PlatformScript[],
): PlatformScriptsPlan {
  const byRef = new Map(known.map((script) => [script.ref, script]));
  const seen = new Set<string>();
  const added: PlatformScript[] = [];
  const changed: { id: string; script: PlatformScript }[] = [];
  const unchanged: string[] = [];
  let refused = 0;
  for (const listing of listed) {
    if (seen.has(listing.ref.id)) continue;
    seen.add(listing.ref.id);
    const script = boundedPlatformScript(stableOrder(listing));
    if (script === null) {
      refused += 1;
      continue;
    }
    const before = byRef.get(script.ref.id);
    if (before === undefined) added.push(script);
    else if (before.active && before.fingerprint === platformScriptFingerprint(script))
      unchanged.push(before.id);
    else changed.push({ id: before.id, script });
  }
  const gone = known.filter((script) => script.active && !seen.has(script.ref)).map((script) => script.id);
  return { added, changed, unchanged, gone, refused };
}

/** Where a media of a step stands in the vault, as the vault's link (`media_platform_refs`) and the descriptions say. */
export interface StepMediaState {
  readonly kind: MediaSlotKind;
  /** Listed by the last sync of the vault, and not removed since. */
  readonly inVault: boolean;
  /** Its media has a description a human validated (ADR 0083, ADR 0030 § 3); `false` while its file is not read. */
  readonly described: boolean;
}

/** Why a native script cannot be offered for sale yet. */
export type PlatformScriptGap = (typeof PLATFORM_SCRIPT_GAPS)[number];

/**
 * What keeps a native script from being proposable (P6-01, ADR 0099 § 1, remark Médias 6): a media of a step (sold or
 * preview) absent from the vault makes its step incomplete; a photo or a video not described with a validated
 * description (a voice note is never described: ADR 0083 § 2); the identity of its current version (SC-04 c8) not
 * validated; what its branches lack (`branchGaps`, ADR 0112). Empty: it may be offered, when it is active.
 */
export function platformScriptGaps(
  steps: readonly { readonly media: readonly StepMediaState[] }[],
  identityValidated: boolean,
  branches: readonly PlatformScriptGap[],
): PlatformScriptGap[] {
  const media = steps.flatMap((step) => step.media);
  const gaps: PlatformScriptGap[] = [];
  if (media.some((each) => !each.inVault)) gaps.push('media_absent');
  if (media.some((each) => each.inVault && each.kind !== 'audio' && !each.described))
    gaps.push('media_not_described');
  if (!identityValidated) gaps.push('identity_not_validated');
  gaps.push(...branches);
  return gaps;
}
