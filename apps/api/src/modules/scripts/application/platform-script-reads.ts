import type {
  BranchCondition,
  CreatorId,
  Currency,
  MediaSlotKind,
  PlatformAccountId,
  PlatformStepDiscount,
  UserRole,
} from '@impera/contracts';

import { branchGaps, conditionOf, ranksOf, stepsWithoutDefault } from '../domain/branches';
import {
  platformScriptGaps,
  priceWarnings,
  type PlatformScriptGap,
  type PlatformScriptWarning,
} from '../domain/platform-scripts';
import type {
  BranchInput,
  DescriptionReview,
  DiscountedPlatformScript,
  IdentityReview,
  PlatformScriptReadStore,
  ScriptBranchStore,
  SetBranchesOutcome,
  ScriptIdentityReviewStore,
  ShownDescription,
  StoredPlatformScript,
  StoredScriptIdentity,
  StoredStepMedia,
} from '../domain/ports';
import { currentIdentity, identityInputHash, type IdentitySource } from '../domain/script-identity';

/** Who reads her native scripts: the owner and the team; the store then keeps the team's scope and her RLS. */
export interface PlatformScriptsReader {
  readonly userId: string;
  readonly role: UserRole;
}

/** A media of a step, and where it stands in the vault. */
interface PlatformStepMediaView {
  readonly ref: string;
  readonly kind: MediaSlotKind;
  /** `false`: absent from the vault, the step is incomplete. */
  readonly inVault: boolean;
  /** In the vault and chosen for the CRM (ADR 0145 § 5). */
  readonly imported: boolean;
  /** The media it is once its file is read; `null` before, or absent from the vault. */
  readonly mediaAssetId: string | null;
  readonly described: boolean;
  /** The description the agency reviews: the latest validated, else the latest written; `null` while none. */
  readonly description: ShownDescription | null;
}

interface PlatformStepView {
  readonly position: number;
  /** The platform's own rank: two steps on the same are branches (ADR 0112). */
  readonly platformIndex: number;
  /** What `sendScriptStep` names. */
  readonly ref: string;
  readonly name: string;
  readonly text: string;
  /** As the platform gives it: minor units, VAT included; 0 for an offered step. Never recalculated. */
  readonly priceMinor: number;
  readonly currency: Currency;
  /** A « Tarif réduit » set on the platform; `null` when none. The step is blocked while it has one. */
  readonly discount: PlatformStepDiscount | null;
  readonly media: readonly PlatformStepMediaView[];
  readonly previewMedia: readonly PlatformStepMediaView[];
  /** Every media of the step is in the vault. */
  readonly complete: boolean;
  /**
   * Its condition when its step has several branches (ADR 0112 § 5): `null` while unset, and for the only branch of a
   * step.
   */
  readonly condition: BranchCondition | null;
  /** How many branches its step has: 1 for a step without branches. */
  readonly branches: number;
}

/** A native script of hers, with what the agency should look at and why it cannot be offered yet. */
export interface PlatformScriptView extends Omit<StoredPlatformScript, 'steps' | 'identities' | 'branches'> {
  readonly steps: readonly PlatformStepView[];
  readonly warnings: readonly PlatformScriptWarning[];
  readonly gaps: readonly PlatformScriptGap[];
  /** Active, and nothing in `gaps`: the agent may offer it for sale. */
  readonly proposable: boolean;
  /**
   * The identity of its current version (SC-04 lot c8): the latest validated, else the latest written, to validate;
   * `null` while none was written for this version.
   */
  readonly identity: StoredScriptIdentity | null;
}

interface Deps {
  readonly store: PlatformScriptReadStore;
}

/** What the identity of a script is written from, as the base keeps it now (`identityInputHash`). */
export function identitySourceOf(script: StoredPlatformScript): IdentitySource {
  const media = (each: StoredStepMedia) => ({
    ref: each.ref,
    kind: each.kind,
    descriptionId: each.vault?.descriptionId ?? null,
  });
  return {
    name: script.name,
    steps: script.steps.map((step) => ({
      platformIndex: step.platformIndex,
      name: step.name,
      text: step.text,
      media: step.media.map(media),
      previewMedia: step.previewMedia.map(media),
    })),
  };
}

/** The version of the script as it is now, for its identity. */
function currentInputHash(script: StoredPlatformScript): string {
  return identityInputHash(identitySourceOf(script));
}

function viewOf(script: StoredPlatformScript): PlatformScriptView {
  const mediaView = (media: StoredStepMedia): PlatformStepMediaView => ({
    ref: media.ref,
    kind: media.kind,
    inVault: media.vault !== null,
    imported: media.vault?.imported ?? false,
    mediaAssetId: media.vault?.mediaAssetId ?? null,
    described: (media.vault?.descriptionId ?? null) !== null,
    description: media.vault?.shown ?? null,
  });
  // By rank, then the branches of a rank in the agency's order (ADR 0112 § 6): how the screen and the agent read them.
  const ranks = ranksOf(script.steps, script.branches);
  const steps = ranks.flatMap((rank) =>
    rank.branches.map((step): PlatformStepView => {
      const media = step.media.map(mediaView);
      const previewMedia = step.previewMedia.map(mediaView);
      return {
        ...step,
        media,
        previewMedia,
        complete: [...media, ...previewMedia].every((each) => each.inVault),
        condition: conditionOf(rank, step.ref, script.branches),
        branches: rank.branches.length,
      };
    }),
  );
  const identity = currentIdentity(script.identities, currentInputHash(script));
  const branchSteps = script.steps.map((step) => ({
    ...step,
    soldMediaRefs: step.media.map((media) => media.ref),
  }));
  const gaps = platformScriptGaps(
    steps.map((step) => ({
      discounted: step.discount !== null,
      media: [...step.media, ...step.previewMedia],
    })),
    identity?.validatedAt != null,
    branchGaps(branchSteps, script.branches),
  );
  const warnings = [
    ...priceWarnings(script.steps),
    ...stepsWithoutDefault(branchSteps, script.branches).map((position) => ({
      code: 'step_without_default' as const,
      position,
    })),
  ].sort((a, b) => a.position - b.position);
  return {
    id: script.id,
    creatorId: script.creatorId,
    platformAccountId: script.platformAccountId,
    ref: script.ref,
    name: script.name,
    moment: script.moment,
    active: script.active,
    deactivatedAt: script.deactivatedAt,
    syncedAt: script.syncedAt,
    steps,
    warnings,
    gaps,
    proposable: script.active && gaps.length === 0,
    identity,
  };
}

/** Her native scripts, as the agency's screen and the MCP read them; `null` for a reader who may not read her. */
export async function creatorPlatformScripts(
  deps: Deps,
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
): Promise<readonly PlatformScriptView[] | null> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return null;
  const scripts = await deps.store.ofCreator(creatorId, reader.userId);
  if (scripts === null) return null;
  return scripts.map(viewOf);
}

/**
 * Her active native scripts kept from being offered by a « Tarif réduit » on the platform (recette 16/11: bloquer et
 * alerter), the longest waiting first: what « À traiter » warns of until the agency takes the discount off in Reveal.
 * The owner and her active managers only, like `creatorPlatformScripts`; `null` for a reader who may not read her.
 */
export async function discountedPlatformScripts(
  deps: Deps,
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
): Promise<readonly DiscountedPlatformScript[] | null> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return null;
  return deps.store.discountedOf(creatorId, reader.userId);
}

/**
 * One native script of hers, out of any person and as the service role: what a job of the agent reads before sending a
 * step (ADR 0111, the reward: its step's ref and price, its media and the media they are). For a job only: its ids come
 * from the base (a run, a reward), never from a request, which reads through `creatorPlatformScripts`. `null` when it
 * is not hers.
 */
export async function platformScriptForJob(
  deps: Deps,
  creatorId: CreatorId,
  scriptId: string,
): Promise<PlatformScriptView | null> {
  const script = await deps.store.oneForJob(creatorId, scriptId);
  return script === null ? null : viewOf(script);
}

/**
 * Her native scripts on one account, out of any person and as the service role: what the agent decides a script on
 * for a fan (ADR 0098), each with its `proposable` and its steps by rank. For a job only, like `platformScriptForJob`.
 */
export async function accountPlatformScriptsForJob(
  deps: Deps,
  creatorId: CreatorId,
  platformAccountId: PlatformAccountId,
): Promise<readonly PlatformScriptView[]> {
  return (await deps.store.ofAccountForJob(creatorId, platformAccountId)).map(viewOf);
}

/**
 * The agency validates the identity shown for the script's current version, or writes one by hand (SC-04 lot c8, ADR
 * 0030 § 3): the owner and the active managers of her list. An identity of another version is `stale`.
 */
export async function reviewScriptIdentity(
  deps: { readonly store: ScriptIdentityReviewStore },
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
  scriptId: string,
  review: IdentityReview,
): Promise<'validated' | 'already' | 'corrected' | 'stale' | 'not_found'> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return 'not_found';
  return deps.store.review(creatorId, scriptId, review, reader.userId, currentInputHash);
}

/**
 * The agency validates the descriptions of a native script's media as shown, or rewrites one by hand (ADR 0030 § 3,
 * ADR 0099 § 4): the owner and the active managers of her list, as for its identity. Each write asks the identity
 * again, which is told only from validated descriptions.
 */
export async function reviewScriptDescriptions(
  deps: { readonly store: ScriptIdentityReviewStore },
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
  scriptId: string,
  review: DescriptionReview,
  correlationId: string,
): Promise<'validated' | 'already' | 'corrected' | 'stale' | 'alone' | 'not_found'> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return 'not_found';
  return deps.store.describe(creatorId, scriptId, review, reader.userId, correlationId);
}

/**
 * The agency sets every branch of one step, in its order, each with its condition (ADR 0112 §§ 5-6): the owner and the
 * active managers of her list. The branches named must be exactly those the step has now (`stale` otherwise).
 */
export async function setScriptBranches(
  deps: { readonly store: ScriptBranchStore },
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
  scriptId: string,
  platformIndex: number,
  branches: readonly BranchInput[],
): Promise<SetBranchesOutcome> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return 'not_found';
  return deps.store.setStep(creatorId, scriptId, platformIndex, branches, reader.userId);
}
