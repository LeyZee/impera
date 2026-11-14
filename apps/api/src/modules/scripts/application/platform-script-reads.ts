import type { CreatorId, Currency, MediaSlotKind, UserRole } from '@impera/contracts';

import {
  platformScriptGaps,
  priceWarnings,
  type PlatformScriptGap,
  type PlatformScriptWarning,
} from '../domain/platform-scripts';
import type { PlatformScriptReadStore, StoredPlatformScript, StoredStepMedia } from '../domain/ports';

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
  /** The media it is once its file is read; `null` before, or absent from the vault. */
  readonly mediaAssetId: string | null;
  readonly described: boolean;
}

interface PlatformStepView {
  readonly position: number;
  /** What `sendScriptStep` names. */
  readonly ref: string;
  readonly name: string;
  readonly text: string;
  /** As the platform gives it: minor units, VAT included; 0 for an offered step. Never recalculated. */
  readonly priceMinor: number;
  readonly currency: Currency;
  readonly media: readonly PlatformStepMediaView[];
  readonly previewMedia: readonly PlatformStepMediaView[];
  /** Every media of the step is in the vault. */
  readonly complete: boolean;
}

/** A native script of hers, with what the agency should look at and why it cannot be offered yet. */
export interface PlatformScriptView extends Omit<StoredPlatformScript, 'steps'> {
  readonly steps: readonly PlatformStepView[];
  readonly warnings: readonly PlatformScriptWarning[];
  readonly gaps: readonly PlatformScriptGap[];
  /** Active, and nothing in `gaps`: the agent may offer it for sale. */
  readonly proposable: boolean;
}

interface Deps {
  readonly store: PlatformScriptReadStore;
}

/**
 * Not yet: the script's identity (SC-04 lot c8) is not built, so no native script is proposable for sale until it is.
 * A reward (ADR 0111) does not ask it.
 */
const IDENTITY_VALIDATED = false;

function viewOf(script: StoredPlatformScript): PlatformScriptView {
  const mediaView = (media: StoredStepMedia): PlatformStepMediaView => ({
    ref: media.ref,
    kind: media.kind,
    inVault: media.vault !== null,
    mediaAssetId: media.vault?.mediaAssetId ?? null,
    described: media.vault?.described ?? false,
  });
  const steps = script.steps.map((step): PlatformStepView => {
    const media = step.media.map(mediaView);
    const previewMedia = step.previewMedia.map(mediaView);
    return {
      ...step,
      media,
      previewMedia,
      complete: [...media, ...previewMedia].every((each) => each.inVault),
    };
  });
  const gaps = platformScriptGaps(
    steps.map((step) => ({ media: [...step.media, ...step.previewMedia] })),
    IDENTITY_VALIDATED,
  );
  return {
    ...script,
    steps,
    warnings: priceWarnings(script.steps),
    gaps,
    proposable: script.active && gaps.length === 0,
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
