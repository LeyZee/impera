import { createHash } from 'node:crypto';

import type { MediaSlotKind } from '@impera/contracts';

/**
 * A native script's identity (SC-04 lot c8, ADR 0056 § 6): what it is and when it fits, for the brain and the chatters
 * to choose among the scripts the code allows (ADR 0098 § 6). It is written for one version of the script: its steps'
 * names and texts, their media and the validated description of each. A change of any of these asks for a new one; a
 * change of price does not (prices are never in it). Only a validated identity of the current version counts.
 */

/** A media of a step, as the identity reads it: by the platform's id, and the validated description it is told with. */
interface IdentityMedia {
  readonly ref: string;
  readonly kind: MediaSlotKind;
  /** The validated description's row; `null` while it has none (or is not in the vault). */
  readonly descriptionId: string | null;
}

interface IdentityStep {
  readonly platformIndex: number;
  readonly name: string;
  readonly text: string;
  readonly media: readonly IdentityMedia[];
  readonly previewMedia: readonly IdentityMedia[];
}

/** What a version of the script is, for its identity: never a price nor the moment. */
export interface IdentitySource {
  readonly name: string;
  readonly steps: readonly IdentityStep[];
}

/** sha256 of what an identity is written from, in a stable form. */
export function identityInputHash(script: IdentitySource): string {
  const media = (each: IdentityMedia) => [each.ref, each.kind, each.descriptionId];
  const canonical = JSON.stringify([
    script.name,
    script.steps.map((step) => [
      step.platformIndex,
      step.name,
      step.text,
      step.media.map(media),
      step.previewMedia.map(media),
    ]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Every photo and video of the script has a validated description: the brain may write its identity. A voice note is
 * never described by the vision AI, so it does not hold it back.
 */
export function identityReady(script: IdentitySource): boolean {
  return script.steps
    .flatMap((step) => [...step.media, ...step.previewMedia])
    .every((media) => media.kind === 'audio' || media.descriptionId !== null);
}

/**
 * Two steps on the same platform rank: branches of one step that a human chooses between (Reveal's sequences), not
 * two steps one after the other. Such a script is never offered until the model of branched scripts exists (ADR 0112).
 */
export function hasBranches(steps: readonly { readonly platformIndex: number }[]): boolean {
  return new Set(steps.map((step) => step.platformIndex)).size < steps.length;
}

/** An identity as the base keeps it, for one version of the script (`inputHash`). */
export interface KnownIdentity {
  readonly id: string;
  readonly inputHash: string;
  readonly validatedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * The identity the agency sees for the script's current version: the latest validated one, else the latest written.
 * `null` when none was written for this version: an identity of an older version is never shown as the current one.
 */
export function currentIdentity<T extends KnownIdentity>(
  identities: readonly T[],
  inputHash: string,
): T | null {
  const ofVersion = identities.filter((identity) => identity.inputHash === inputHash);
  const latest = (rows: readonly T[]) =>
    rows.reduce<T | null>(
      (best, row) => (best === null || row.createdAt > best.createdAt ? row : best),
      null,
    );
  return latest(ofVersion.filter((identity) => identity.validatedAt !== null)) ?? latest(ofVersion);
}
