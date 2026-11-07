import type {
  LinkSalesFeedChatterBody,
  PlatformChatter,
  TeamImportOverview,
  TeamImportRow,
  TeamImportSuggestion,
  TeamMember,
} from '@impera/contracts';

/**
 * Équipe › Reveal, without React (ADR 0076): where each account of the platform's team shows, what its list offers,
 * and how a proposal, a model and a gap read. The server proposes and decides; this only says it.
 */

/** The list's value for a row: `member:<id>`, `agent`, `none`, or `invite` (never in the batch, § 1). */
export type Choice = `member:${string}` | 'agent' | 'none' | 'invite';

export const chatterName = (chatter: PlatformChatter): string =>
  `${chatter.firstName} ${chatter.lastName}`.trim() || chatter.platformChatterId;

/**
 * The three parts of the page: the rows to confirm (no link, not set aside, not an API key's bot), the rows linked,
 * and the folded list (set aside, and the bots of the API keys, linked or not).
 */
export function sectionsOf(rows: readonly TeamImportRow[]): {
  toConfirm: TeamImportRow[];
  linked: TeamImportRow[];
  folded: TeamImportRow[];
} {
  const isFolded = (row: TeamImportRow): boolean => row.dismissedAt !== null || row.chatter.isBot;
  return {
    toConfirm: rows.filter((row) => !isFolded(row) && row.link === null),
    linked: rows.filter((row) => !isFolded(row) && row.link !== null),
    folded: rows.filter(isFolded),
  };
}

/** The proposal as the list's value; `none` for a row without one. */
export function choiceOf(suggestion: TeamImportSuggestion | null): Choice {
  if (suggestion === null) return 'none';
  if (suggestion.kind === 'member') return `member:${suggestion.memberId}`;
  return suggestion.kind;
}

/** The link in place as the list's value. */
export function linkedChoiceOf(row: TeamImportRow): Choice {
  if (row.link === null || row.link.kind === 'none') return 'none';
  return row.link.kind === 'agent' ? 'agent' : `member:${row.link.memberId}`;
}

/** The body of a choice; `null` for an invitation, which never goes in the batch. */
export function linkOf(choice: Choice): LinkSalesFeedChatterBody | null {
  if (choice === 'invite') return null;
  if (choice === 'agent' || choice === 'none') return { kind: choice };
  return { kind: 'member', memberId: choice.slice('member:'.length) };
}

export interface ChoiceOption {
  readonly value: Choice;
  readonly label: string;
}

/**
 * What a row's list offers, from what this viewer may do there (`actions`): the members still in the team, the
 * agent, nobody, an invitation. A member already named on the row stays in the list even when the team cannot be read.
 */
export function optionsOf(row: TeamImportRow, members: readonly TeamMember[]): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  if (row.actions.includes('link_member')) {
    const named =
      row.link?.kind === 'member'
        ? { id: row.link.memberId, name: row.link.memberDisplayName }
        : row.suggestion?.kind === 'member'
          ? { id: row.suggestion.memberId, name: row.suggestion.memberDisplayName }
          : null;
    const here = members.filter((member) => member.status !== 'left');
    if (named !== null && !here.some((member) => member.id === named.id)) {
      options.push({ value: `member:${named.id}`, label: named.name });
    }
    for (const member of [...here].sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))) {
      options.push({ value: `member:${member.id}`, label: member.displayName });
    }
  }
  if (row.actions.includes('link_agent')) options.push({ value: 'agent', label: 'L’agent' });
  if (row.actions.includes('invite')) options.push({ value: 'invite', label: 'Inviter dans l’équipe' });
  if (row.actions.includes('link_none')) options.push({ value: 'none', label: 'Personne' });
  return options;
}

/** Why the proposal was made, after its name: the reader checks it before ticking. */
export function matchLine(suggestion: TeamImportSuggestion | null): string | null {
  if (suggestion === null) return null;
  switch (suggestion.kind) {
    case 'member':
      return suggestion.match === 'email' ? 'Même e-mail' : 'Mêmes prénom et nom';
    case 'agent':
      return suggestion.match === 'session' ? 'Compte de la session capturée' : 'Nommé « bot »';
    case 'invite':
      return 'Personne de l’équipe Impera avec cet e-mail';
    case 'none':
      return 'Bot d’une clé d’API';
  }
}

/** « L’agent », « Personne », or the member's name: the link as the row says it. */
export function linkLabel(row: TeamImportRow): string {
  if (row.link === null || row.link.kind === 'none') return 'Personne';
  return row.link.kind === 'agent' ? 'L’agent' : row.link.memberDisplayName;
}

/** The models the platform assigns the account (§ 7): its creator in Impera, else its handle, said as not imported. */
export function modelsLine(row: TeamImportRow, platform: string): string | null {
  if (row.models.length === 0) return null;
  const names = row.models.map(
    (model) => model.creatorDisplayName ?? `${model.handle} (modèle ${platform} non importée)`,
  );
  return `Modèles sur ${platform} : ${names.join(', ')}`;
}

/** The gap between the member's creators in Impera and the platform's models (§ 7): information, nothing rewritten. */
export function gapLine(row: TeamImportRow, platform: string): string | null {
  const parts: string[] = [];
  const onlyHere = row.modelGap.inImperaOnly.map((creator) => creator.creatorDisplayName);
  if (onlyHere.length > 0) parts.push(`chez Impera seulement : ${onlyHere.join(', ')}`);
  if (row.modelGap.onPlatformOnly.length > 0)
    parts.push(`sur ${platform} seulement : ${row.modelGap.onPlatformOnly.join(', ')}`);
  if (parts.length === 0) return null;
  const line = parts.join(' ; ');
  return `Écart de créatrices, ${line}.`;
}

/** « 2 nouveaux chatteurs sur Reveal » (§ 6). */
export const newcomersLine = (count: number, platform: string): string =>
  count === 1 ? `1 nouveau chatteur sur ${platform}` : `${String(count)} nouveaux chatteurs sur ${platform}`;

/** « 1 retiré de Reveal, toujours dans l’équipe » (§ 5). */
export const removalsLine = (count: number, platform: string): string =>
  count === 1
    ? `1 retiré de ${platform}, toujours dans l’équipe`
    : `${String(count)} retirés de ${platform}, toujours dans l’équipe`;

/** The tab's count: what waits for the reader, the newcomers and the removals. */
export const toTreat = (counts: Pick<TeamImportOverview, 'newCount' | 'removalCount'>): number =>
  counts.newCount + counts.removalCount;

/** The first values of the batch: each row to confirm on its proposal, ticked when the server says so. */
export function initialBatch(rows: readonly TeamImportRow[]): {
  choices: Record<string, Choice>;
  ticked: string[];
} {
  const choices: Record<string, Choice> = {};
  const ticked: string[] = [];
  for (const row of rows) {
    if (row.link !== null || row.dismissedAt !== null || row.actions.length === 0) continue;
    const choice = choiceOf(row.suggestion);
    choices[row.chatter.platformChatterId] = choice;
    if (row.preselected && choice !== 'invite') ticked.push(row.chatter.platformChatterId);
  }
  return { choices, ticked };
}

/**
 * What a member invited from the platform starts with (§ 3): his names and e-mail from the platform, the team name
 * his first name, and his creators the platform's models linked to a creator the inviter may give.
 */
export function invitePrefill(
  row: TeamImportRow,
  givable: readonly string[],
): { firstName: string; lastName: string; displayName: string; email: string; creatorIds: string[] } {
  const creatorIds = row.models.flatMap((model) =>
    model.creatorId !== null && givable.includes(model.creatorId) ? [model.creatorId] : [],
  );
  return {
    firstName: row.chatter.firstName,
    lastName: row.chatter.lastName,
    displayName: row.chatter.firstName,
    email: row.chatter.email ?? '',
    creatorIds: [...new Set(creatorIds)],
  };
}

/** « 3 cochés, dont 1 dans « Bots et comptes écartés » »: a ticked row of the fold is said, never counted in silence. */
export function tickedCount(count: number, folded: number): string {
  const ticked = `${String(count)} coché${count > 1 ? 's' : ''}`;
  if (folded === 0) return ticked;
  return `${ticked}, dont ${String(folded)} dans « Bots et comptes écartés »`;
}
