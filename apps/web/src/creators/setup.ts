import type { CreatorAccount } from '@impera/contracts';

import type { CreatorSheet } from './search';

/*
 * What is left to set up for a creator (CRM-07 b2): a creator made by the import of Reveal has her name, her handle
 * and Paris as her zone (ADR 0069 § 3); her persona, the agency's percentage and her access are the owner's to do.
 * Pure, so that the card only lays it out.
 */

/** One thing to set up, the sheet where it is done, and whether it is. */
export interface SetupStep {
  readonly sheet: CreatorSheet;
  readonly label: string;
  /** Done; `waiting` when it was started and waits on her (an invitation out, not opened yet). */
  readonly state: 'todo' | 'waiting' | 'done';
  /** What it says when it is not done. */
  readonly hint: string;
}

export interface SetupFacts {
  /** Versions of her persona ever stored. */
  readonly personaVersions: number;
  /** The agency's percentage in force today. */
  readonly hasRate: boolean;
  /** Her own account, `null` before her first invitation. */
  readonly account: CreatorAccount['account'];
}

export function setupSteps(facts: SetupFacts): readonly SetupStep[] {
  return [
    {
      sheet: 'persona',
      label: 'Sa persona',
      state: facts.personaVersions > 0 ? 'done' : 'todo',
      hint: 'À écrire : ce que l’agent sait d’elle et sa façon de parler.',
    },
    {
      sheet: 'rate',
      label: 'Le pourcentage de l’agence',
      state: facts.hasRate ? 'done' : 'todo',
      hint: 'À régler : aucune part de l’agence n’est montrée sans lui.',
    },
    {
      sheet: 'access',
      label: 'Son accès à son espace',
      state: facts.account === null ? 'todo' : facts.account.invitationPending ? 'waiting' : 'done',
      hint:
        facts.account === null
          ? 'À créer : son lien d’invitation.'
          : 'Invitation envoyée, pas encore ouverte.',
    },
  ];
}

/** The card shows while anything is left, a step waiting on her included. */
export const isSetUp = (steps: readonly SetupStep[]): boolean => steps.every((step) => step.state === 'done');
