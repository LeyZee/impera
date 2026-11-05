import type {
  CreatorId,
  CreatorSummary,
  PlatformModel,
  PlatformModelStatus,
  SalesFeedImportAction,
  SalesFeedImportCandidate,
  SalesFeedImportLineResult,
  SalesFeedImportRefusal,
} from '@impera/contracts';

/*
 * « N créatrices trouvées sur Reveal » (CRM-07, ADR 0069): what the review block shows and sends, kept apart from
 * React so that it is tested alone. The server proposes and ticks in advance; the owner changes a line, and only her
 * identifiers and choices go up.
 */

/** Her name as the platform gives it, her handle when it gives none (the server falls back the same way, § 3). */
export const modelName = (model: PlatformModel): string =>
  model.displayName.trim() === '' ? `@${model.handle}` : model.displayName;

/** « Nora (@nora) », the handle alone when the platform gives no name. */
export const modelLabel = (model: PlatformModel): string =>
  model.displayName.trim() === '' ? `@${model.handle}` : `${model.displayName} (@${model.handle})`;

/** Two letters for her tile: her photo stays at the platform until the import copies it (the page loads none). */
export function initialsOf(name: string): string {
  const letters = name
    .replace(/^@/u, '')
    .split(/[\s._-]+/u)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  return letters.toLocaleUpperCase('fr-FR');
}

const STATUSES: Readonly<Record<PlatformModelStatus, (platform: string) => string>> = {
  validated: () => 'Validée',
  pending: (platform) => `En attente chez ${platform}`,
  onboarding_changes_requested: () => 'Dossier à compléter',
  refused: (platform) => `Refusée par ${platform}`,
  banned: () => 'Bannie',
  other: () => 'Statut inconnu',
};

/** Where she stands with the platform, in a word; only a validated and active one is ticked in advance. */
export function statusLabel(model: PlatformModel, platform: string): string {
  if (model.status === 'validated' && !model.isActive) return 'Validée, inactive';
  return STATUSES[model.status](platform);
}

/** A status worth a second look before importing her: amber, never red (nothing is broken). */
export const isStatusWarning = (model: PlatformModel): boolean =>
  model.status === 'banned' || model.status === 'refused' || model.status === 'other' || !model.isActive;

/** One line's choice: ticked or not, and what to do with her. */
export interface ImportChoice {
  readonly selected: boolean;
  readonly action: SalesFeedImportAction;
}

/** What the server proposed, until the owner changes it. */
export function proposedChoice(candidate: SalesFeedImportCandidate): ImportChoice {
  const { proposal } = candidate;
  return {
    selected: candidate.preselected,
    action: proposal.kind === 'link' ? { kind: 'link', creatorId: proposal.creatorId } : { kind: 'create' },
  };
}

/** The value of the line's menu: « create », or « link:<her id> ». */
export const actionValue = (action: SalesFeedImportAction): string =>
  action.kind === 'create' ? 'create' : `link:${action.creatorId}`;

/** The action a menu value stands for; a creator not among the choices reads as « create ». */
export function actionOf(value: string, choices: readonly CreatorOption[]): SalesFeedImportAction {
  if (!value.startsWith('link:')) return { kind: 'create' };
  const id = value.slice('link:'.length);
  const known = choices.find((choice) => choice.id === id);
  return known === undefined ? { kind: 'create' } : { kind: 'link', creatorId: known.id };
}

export interface CreatorOption {
  readonly id: CreatorId;
  readonly name: string;
}

/**
 * The creators a line can be linked to: every creator the owner has, by name, and the one the server proposed even
 * before the list is read (or when it cannot be).
 */
export function creatorOptionsOf(
  creators: readonly CreatorSummary[],
  candidates: readonly SalesFeedImportCandidate[],
): CreatorOption[] {
  const byId = new Map<CreatorId, CreatorOption>();
  for (const creator of creators) byId.set(creator.id, { id: creator.id, name: creator.displayName });
  for (const { proposal } of candidates) {
    if (proposal.kind === 'link' && !byId.has(proposal.creatorId)) {
      byId.set(proposal.creatorId, { id: proposal.creatorId, name: proposal.creatorDisplayName });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr-FR'));
}

/** Why the server proposes a link, said under the line; nothing when it proposes to create her. */
export function proposalWhy(candidate: SalesFeedImportCandidate): string | null {
  const { proposal } = candidate;
  if (proposal.kind !== 'link') return null;
  return proposal.match === 'handle'
    ? `Même pseudo qu’un compte de ${proposal.creatorDisplayName}`
    : `Même nom que ${proposal.creatorDisplayName}`;
}

/** The lines ticked, in the order shown: what « Importer la sélection » sends. */
export function selectedLines(
  candidates: readonly SalesFeedImportCandidate[],
  choices: ReadonlyMap<string, ImportChoice>,
): { platformModelId: string; action: SalesFeedImportAction }[] {
  return candidates.flatMap((candidate) => {
    const id = candidate.model.platformModelId;
    const choice = choices.get(id) ?? proposedChoice(candidate);
    return choice.selected ? [{ platformModelId: id, action: choice.action }] : [];
  });
}

const REFUSALS: Readonly<Record<SalesFeedImportRefusal, (platform: string) => string>> = {
  not_listed: (platform) => `${platform} ne la liste plus.`,
  name_taken: () => 'Une créatrice d’Impera porte déjà ce nom\u00a0: relie-la à elle plutôt.',
  name_invalid: () => 'Ni son nom ni son pseudo ne font un nom\u00a0: crée-la à la main dans Créatrices.',
  handle_taken: () => 'Ce pseudo est déjà le compte d’une autre créatrice.',
  creator_not_found: () => 'La créatrice choisie n’existe plus.',
  link_conflict: (platform) => `Ce compte est déjà relié à un autre modèle de ${platform}.`,
};

export const refusalLine = (reason: SalesFeedImportRefusal, platform: string): string =>
  REFUSALS[reason](platform);

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** « 2 créées, 1 reliée, 1 refusée. », what an import did, in its order of importance. */
export function summaryOf(lines: readonly SalesFeedImportLineResult[]): string {
  const of = (outcome: SalesFeedImportLineResult['outcome']): number =>
    lines.filter((line) => line.outcome === outcome).length;
  const parts = [
    of('created') > 0 ? count(of('created'), 'créée', 'créées') : null,
    of('linked') > 0 ? count(of('linked'), 'reliée', 'reliées') : null,
    of('already_linked') > 0 ? count(of('already_linked'), 'déjà reliée', 'déjà reliées') : null,
    of('refused') > 0 ? count(of('refused'), 'refusée', 'refusées') : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Rien n’a été importé.' : `${parts.join(', ')}.`;
}

/** The title of the block: how many are waiting, or that none is. */
export const foundTitle = (n: number, platform: string): string =>
  n === 0
    ? `Aucune nouvelle créatrice sur ${platform}`
    : `${count(n, 'créatrice trouvée', 'créatrices trouvées')} sur ${platform}`;
