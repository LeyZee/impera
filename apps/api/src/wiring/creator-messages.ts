import type { CreatorId } from '@impera/contracts';

import { createCreatorMessagesModule, type CreatorMessagesModule } from '../modules/creator-messages';
import type { NotificationsModule } from '../modules/notifications';

import type { Routes, Shared } from './shared';

/** « Écrire à l'agence » (trous béants n° 13): hers to write, her owner's to answer. A leaf. */
export function wireCreatorMessages(
  shared: Shared,
  deps: {
    readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
    /** Her message rings the agency, the answer rings her (recette 27/11); `null` while push is off. */
    readonly notify: NotificationsModule['notify'];
    readonly agencyTimeZone: () => Promise<string>;
  },
): { readonly module: CreatorMessagesModule; readonly routes: readonly Routes[] } {
  const module = createCreatorMessagesModule({
    db: shared.db,
    requireRole: shared.requireRole,
    allCreatorIds: deps.allCreatorIds,
    phones: { adminDb: shared.adminDb, agencyTimeZone: deps.agencyTimeZone, notify: deps.notify },
  });
  return { module, routes: [module.routes] };
}
