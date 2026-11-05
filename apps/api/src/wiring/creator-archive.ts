import { UserIdSchema } from '@impera/contracts';

import { revokeCreatorLinksUnscoped } from '../invitation-links';
import type { ConversationsModule } from '../modules/conversations';
import type { PersonaModule } from '../modules/persona';
import type { SchedulingModule } from '../modules/scheduling';

import type { Routes, Shared } from './shared';

/**
 * A creator's archiving (ADR 0071 § 2): refused while the planning still has her, then her links out revoked and her
 * agent's switch on, so it stays off if she is reopened. The agent's gate refuses her by code besides
 * (`creator_archived`), and her sessions by `auth`.
 */
export function wireCreatorArchive(
  shared: Shared,
  deps: {
    readonly persona: PersonaModule;
    readonly scheduling: SchedulingModule;
    readonly conversations: ConversationsModule;
  },
): readonly Routes[] {
  return [
    deps.persona.archiveRoutes({
      planned: (creatorId) => deps.scheduling.planned(creatorId),
      close: async ({ creatorId, userId, correlationId }) => {
        await revokeCreatorLinksUnscoped(shared.adminDb, { creatorId, ownerId: userId });
        await deps.conversations.setAgentMode({
          creatorId,
          userId: UserIdSchema.parse(userId),
          mode: 'stop',
          reason: 'Créatrice archivée',
          correlationId,
        });
      },
    }),
  ];
}
