import { createHash } from 'node:crypto';

import type { Currency, PlatformScript } from '@impera/contracts';

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

type PlatformScriptWarningCode = 'price_more_than_double' | 'price_above_ceiling';

/** A step whose price the agency should look at; `position` counts from 0, as the platform's `stepIndex`. */
export interface PlatformScriptWarning {
  readonly code: PlatformScriptWarningCode;
  readonly position: number;
}

interface PricedStep {
  readonly priceMinor: number;
  readonly currency: Currency;
}

/**
 * P6-01: a paid step that costs more than twice the paid step before it (tripling cut the old bot's sales short), or
 * more than the ceiling. Free steps neither warn nor reset the comparison: the step before is the last paid one. A
 * change of currency between two paid steps compares nothing.
 */
export function priceWarnings(steps: readonly PricedStep[]): PlatformScriptWarning[] {
  const warnings: PlatformScriptWarning[] = [];
  let previous: PricedStep | null = null;
  steps.forEach((step, position) => {
    if (step.priceMinor === 0) return;
    if (previous !== null && previous.currency === step.currency && step.priceMinor > 2 * previous.priceMinor)
      warnings.push({ code: 'price_more_than_double', position });
    if (step.currency === 'EUR' && step.priceMinor > PLATFORM_SCRIPT_PRICE_CEILING_MINOR)
      warnings.push({ code: 'price_above_ceiling', position });
    previous = step;
  });
  return warnings;
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
}

/**
 * The plan of one import, from the scripts the platform lists now and those the base knows. A script listed twice
 * by the platform is taken once (its first listing). Its steps keep the platform's order: `PlatformScript.steps` is
 * already sorted by `stepIndex` (spec § 6) and its `index` is the position kept.
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
  for (const script of listed) {
    if (seen.has(script.ref.id)) continue;
    seen.add(script.ref.id);
    const before = byRef.get(script.ref.id);
    if (before === undefined) added.push(script);
    else if (before.active && before.fingerprint === platformScriptFingerprint(script))
      unchanged.push(before.id);
    else changed.push({ id: before.id, script });
  }
  const gone = known.filter((script) => script.active && !seen.has(script.ref)).map((script) => script.id);
  return { added, changed, unchanged, gone };
}

/** Where a media of a step stands in the vault, as the vault's link (`media_platform_refs`) and the descriptions say. */
export interface StepMediaState {
  /** Listed by the last sync of the vault, and not removed since. */
  readonly inVault: boolean;
  /** Its media has a description a human validated (ADR 0083, ADR 0030 § 3); `false` while its file is not read. */
  readonly described: boolean;
}

/** Why a native script cannot be offered for sale yet. */
export type PlatformScriptGap = 'media_absent' | 'media_not_described' | 'identity_not_validated';

/**
 * What keeps a native script from being proposable (P6-01, ADR 0099 § 1, remark Médias 6): a media of a step (sold or
 * preview) absent from the vault makes its step incomplete; one not described with a validated description; the
 * script's identity (SC-04 c8) not validated. Empty: it may be offered, when it is active.
 */
export function platformScriptGaps(
  steps: readonly { readonly media: readonly StepMediaState[] }[],
  identityValidated: boolean,
): PlatformScriptGap[] {
  const media = steps.flatMap((step) => step.media);
  const gaps: PlatformScriptGap[] = [];
  if (media.some((each) => !each.inVault)) gaps.push('media_absent');
  if (media.some((each) => each.inVault && !each.described)) gaps.push('media_not_described');
  if (!identityValidated) gaps.push('identity_not_validated');
  return gaps;
}
