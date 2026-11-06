import { CreatorIdSchema, type CreatorId } from '@impera/contracts';

import { sampleReplyFaults } from '../modules/agent';
import { createPersonaModule, type PersonaModule } from '../modules/persona';

import type { Routes, Shared } from './shared';

export interface WiredPersona {
  readonly module: PersonaModule;
  /**
   * Her active persona version, the one the owner activates in Créatrices › Persona: the agent writes with it, and
   * « Tester » an alert reads her phrase with it (ADR 0010, 0022; recette G4, M13). Read at each call, under RLS.
   */
  readonly activePersona: (creatorId: string) => ReturnType<PersonaModule['versions']['active']>;
  /** The ids of every creator not archived (ADR 0071 § 2), read as the system: the owner's « À traiter ». */
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  readonly routes: readonly Routes[];
}

export function wirePersona(shared: Shared): WiredPersona {
  const module = createPersonaModule({
    db: shared.db,
    requireRole: shared.requireRole,
    recentLogin: shared.recentLogin,
    // An example the voice imitates never teaches what a hard guard blocks (P5-01).
    sampleReplyFaults,
  });
  return {
    module,
    activePersona: (creatorId) => module.versions.active(CreatorIdSchema.parse(creatorId)),
    allCreatorIds: async () => (await module.creators.unarchived('all')).map((creator) => creator.id),
    routes: [module.routes],
  };
}
