import {
  VAULT_EXCERPT_MAX,
  type CreatorId,
  type MediaDescriptionId,
  type PlatformAccountId,
  type VaultChoicesChange,
  type VaultChoicesView,
  type VaultDescribeAnswer,
  type VaultDescribeAsk,
  type VaultDescriptionReview,
} from '@impera/contracts';

import {
  VaultAccountNotFound,
  VaultChoiceForbidden,
  VaultDescribeOverCap,
  VaultDescriptionNotFound,
  VaultDescriptionStale,
} from '../domain/errors';
import {
  capLeftCents,
  confirms,
  descriptionStateOf,
  estimateVaultDescriptions,
  excerptOf,
  type DescribeCandidate,
} from '../domain/vault-choice';

/** A media of her vault as the choices read it, with its latest detailed description. */
export interface VaultChoiceMedia extends DescribeCandidate {
  readonly platformAccountId: PlatformAccountId;
  readonly detailed: string | null;
  /** That description's id and whether a person validated it; `null` and `false` while it has none. */
  readonly descriptionId: MediaDescriptionId | null;
  readonly validated: boolean;
}

/** What a request decides, in the store's transaction: the media to ask, or none. */
interface AskDecision<T> {
  readonly insert: readonly string[];
  readonly answer: T;
}

/**
 * The vault's ticks and requests (ADR 0145 § 5), in the person's own transaction under her RLS: the owner, or an active
 * manager of her list to read. `forbidden` for anyone else; `unknown_account` for an account that is not hers.
 */
export interface VaultChoiceStore {
  view(
    creatorId: CreatorId,
    userId: string,
  ): Promise<{
    readonly folders: readonly {
      readonly platformAccountId: PlatformAccountId;
      readonly folderRef: string | null;
      readonly imported: boolean;
    }[];
    readonly media: readonly VaultChoiceMedia[];
  } | null>;
  /** A folder's change also removes its media's own ticks: the folder is ticked or unticked whole. */
  set(
    creatorId: CreatorId,
    userId: string,
    change: VaultChoicesChange,
  ): Promise<'set' | 'forbidden' | 'unknown_account'>;
  /**
   * In one transaction: a gesture already made under `key` answers its count; else the media named are read, `decide`
   * says what to ask, and those are written and their account's run queued.
   */
  ask<T>(
    creatorId: CreatorId,
    userId: string,
    request: {
      readonly platformAccountId: string;
      readonly platformMediaIds: readonly string[];
      readonly key: string;
      readonly correlationId: string;
    },
    decide: (known: ReadonlyMap<string, DescribeCandidate>) => AskDecision<T>,
  ): Promise<T | { readonly replayed: number } | 'forbidden' | 'unknown_account'>;
  /**
   * A media's latest description validated as it is, or rewritten and validated, from its sheet: by the owner or an
   * active manager of her list, each with a line in the audit trail. `stale` when the one named is no longer its
   * latest; `not_found` when the media or its description is not hers.
   */
  review(
    creatorId: CreatorId,
    userId: string,
    platformMediaId: string,
    review: VaultDescriptionReview,
  ): Promise<'validated' | 'already' | 'corrected' | 'stale' | 'not_found' | 'forbidden'>;
}

export interface VaultChoiceDeps {
  readonly store: VaultChoiceStore;
  /** Today's spend against the AI cap, as the gateway counts it (`health().budget`). */
  readonly budget: () => { readonly spentEur: number; readonly capEur: number };
}

/** Her vault's ticks and where each media's description stands, for the owner and an active manager of her list. */
export async function readVaultChoices(
  deps: Pick<VaultChoiceDeps, 'store'>,
  creatorId: CreatorId,
  userId: string,
): Promise<VaultChoicesView> {
  const read = await deps.store.view(creatorId, userId);
  if (read === null) throw new VaultChoiceForbidden('read');
  return {
    creatorId,
    folders: read.folders.map((folder) => ({
      platformAccountId: folder.platformAccountId,
      folderRef: folder.folderRef,
      imported: folder.imported,
    })),
    media: read.media.map((media) => ({
      platformAccountId: media.platformAccountId,
      platformMediaId: media.platformMediaId,
      imported: media.imported,
      description: descriptionStateOf(media),
      excerpt: excerptOf(media.detailed, VAULT_EXCERPT_MAX),
      descriptionId: media.descriptionId,
      detailed: media.detailed,
      validated: media.validated,
    })),
  };
}

/** The owner ticks or unticks what enters the CRM; nothing is read at the platform nor described. */
export async function setVaultChoices(
  deps: Pick<VaultChoiceDeps, 'store'>,
  creatorId: CreatorId,
  userId: string,
  change: VaultChoicesChange,
): Promise<VaultChoicesView> {
  const outcome = await deps.store.set(creatorId, userId, change);
  if (outcome === 'forbidden') throw new VaultChoiceForbidden('choose');
  if (outcome === 'unknown_account') throw new VaultAccountNotFound();
  return readVaultChoices(deps, creatorId, userId);
}

/**
 * « Décrire par IA » (ADR 0145 § 5), the owner's, in two steps: the count and the cost of what would be described,
 * then, with that same count and cost confirmed, the requests written and the account's run queued. A confirmation
 * of an estimate that moved meanwhile asks nothing and answers the new estimate. Replayable under its key.
 */
export async function askVaultDescriptions(
  deps: VaultChoiceDeps,
  creatorId: CreatorId,
  userId: string,
  ask: VaultDescribeAsk,
  correlationId: string,
): Promise<VaultDescribeAnswer> {
  const outcome = await deps.store.ask<VaultDescribeAnswer | 'over_cap'>(
    creatorId,
    userId,
    {
      platformAccountId: ask.platformAccountId,
      platformMediaIds: ask.platformMediaIds,
      key: ask.idempotencyKey,
      correlationId,
    },
    (known) => {
      const estimate = estimateVaultDescriptions(ask.platformMediaIds, known);
      const capLeft = capLeftCents(deps.budget());
      if (confirms(ask.confirm, estimate)) {
        // Never a run dearer than what is left of the day: refused at the confirmation, nothing asked.
        if (estimate.costCents > capLeft) return { insert: [], answer: 'over_cap' };
        return { insert: estimate.toAsk, answer: { status: 'asked', count: estimate.count } };
      }
      return {
        insert: [],
        answer: {
          status: 'estimate',
          count: estimate.count,
          photos: estimate.photos,
          videos: estimate.videos,
          alreadyDescribed: estimate.alreadyDescribed,
          alreadyAsked: estimate.alreadyAsked,
          notImported: estimate.notImported,
          notDescribable: estimate.notDescribable,
          costCents: estimate.costCents,
          capLeftCents: capLeft,
        },
      };
    },
  );
  if (outcome === 'forbidden') throw new VaultChoiceForbidden('choose');
  if (outcome === 'unknown_account') throw new VaultAccountNotFound();
  if (outcome === 'over_cap') throw new VaultDescribeOverCap();
  if ('replayed' in outcome) return { status: 'asked', count: outcome.replayed };
  return outcome;
}

/**
 * « Valider la description » and « Corriger » on a media's sheet (ADR 0145 § 5): a script made of her vault asks a
 * description a person validated for each of its media, so the sheet is where it is given. Validating twice is no
 * error; a description changed meanwhile is refused, never another one validated in its place.
 */
export async function reviewVaultDescription(
  deps: Pick<VaultChoiceDeps, 'store'>,
  creatorId: CreatorId,
  userId: string,
  platformMediaId: string,
  review: VaultDescriptionReview,
): Promise<VaultChoicesView> {
  const outcome = await deps.store.review(creatorId, userId, platformMediaId, review);
  if (outcome === 'forbidden') throw new VaultChoiceForbidden('read');
  if (outcome === 'not_found') throw new VaultDescriptionNotFound();
  if (outcome === 'stale') throw new VaultDescriptionStale();
  return readVaultChoices(deps, creatorId, userId);
}
