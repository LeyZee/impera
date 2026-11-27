import type { CreatorId } from '@impera/contracts';

import { createCreatorMessagesModule, type CreatorMessagesModule } from '../modules/creator-messages';

import type { Routes, Shared } from './shared';

/** « Écrire à l'agence » (trous béants n° 13): hers to write, her owner's to answer. A leaf. */
export function wireCreatorMessages(
  shared: Shared,
  deps: { readonly allCreatorIds: () => Promise<readonly CreatorId[]> },
): { readonly module: CreatorMessagesModule; readonly routes: readonly Routes[] } {
  const module = createCreatorMessagesModule({
    db: shared.db,
    requireRole: shared.requireRole,
    allCreatorIds: deps.allCreatorIds,
  });
  return { module, routes: [module.routes] };
}
