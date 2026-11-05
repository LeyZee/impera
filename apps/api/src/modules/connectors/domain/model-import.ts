import {
  creatorNameKey,
  CreatorDisplayNameSchema,
  type CreatorId,
  type PlatformModel,
  type SalesFeedImportCandidate,
  type SalesFeedImportProposal,
} from '@impera/contracts';

/**
 * The import of a platform's models as creators (CRM-07, ADR 0069): what the review proposes, line by line. Pure: the
 * live list, the links, the dismissals, the accounts and the creators come in; nothing is written.
 */

export interface ImportableCreator {
  readonly creatorId: CreatorId;
  readonly displayName: string;
}

interface ImportableAccount {
  readonly creatorId: CreatorId;
  readonly handle: string;
}

interface ProposalInputs {
  readonly models: readonly PlatformModel[];
  readonly linked: ReadonlySet<string>;
  readonly dismissed: ReadonlySet<string>;
  readonly accounts: readonly ImportableAccount[];
  readonly creators: readonly ImportableCreator[];
}

/** Ticked in advance: `validated` and active only; any other status, known or not, is shown unticked (§ 2). */
export function isPreselected(model: PlatformModel): boolean {
  return model.status === 'validated' && model.isActive;
}

/**
 * The name a created creator takes: the platform's display name, or the handle when it is empty or no name (§ 3);
 * `null` when neither is a name (no letter), and the line is refused.
 */
export function importedNameOf(model: Pick<PlatformModel, 'displayName' | 'handle'>): string | null {
  for (const candidate of [model.displayName, model.handle]) {
    const parsed = CreatorDisplayNameSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * One line per live model without a link and not dismissed, in the platform's order. The proposal links to a creator
 * when one of her accounts has the model's handle (any case), else when her name matches the name the model would
 * take; it creates her otherwise. Only a proposal: the owner changes it.
 */
export function proposeImports(inputs: ProposalInputs): SalesFeedImportCandidate[] {
  const creatorOf = new Map(inputs.creators.map((creator) => [creator.creatorId, creator]));
  const byName = new Map(inputs.creators.map((creator) => [creatorNameKey(creator.displayName), creator]));
  const candidates: SalesFeedImportCandidate[] = [];
  for (const model of inputs.models) {
    if (inputs.linked.has(model.platformModelId) || inputs.dismissed.has(model.platformModelId)) continue;
    candidates.push({ model, proposal: proposalFor(model), preselected: isPreselected(model) });
  }
  return candidates;

  function proposalFor(model: PlatformModel): SalesFeedImportProposal {
    const handle = model.handle.toLowerCase();
    const owners = new Set(
      inputs.accounts.filter((account) => account.handle.toLowerCase() === handle).map((a) => a.creatorId),
    );
    const [owner] = owners;
    const byHandle = owners.size === 1 && owner !== undefined ? creatorOf.get(owner) : undefined;
    if (byHandle !== undefined) return link(byHandle, 'handle');
    const name = importedNameOf(model);
    const byKey = name === null ? undefined : byName.get(creatorNameKey(name));
    if (byKey !== undefined) return link(byKey, 'name');
    return { kind: 'create' };
  }
}

function link(creator: ImportableCreator, match: 'handle' | 'name'): SalesFeedImportProposal {
  return { kind: 'link', creatorId: creator.creatorId, creatorDisplayName: creator.displayName, match };
}
