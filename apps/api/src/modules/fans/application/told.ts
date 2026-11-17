import type { CreatorId, FanId } from '@impera/contracts';

import type { FansService } from './fans';

/** The writes the platform's note follows (ADR 0117 § 5). */
export type ToldWrites = Pick<FansService, 'proposeFacts' | 'proposeRead' | 'editCard' | 'setFlag'>;

/**
 * The writes of facts, and the confirmation of his age (the Âge line, held while it was disputed, may then follow his
 * card, ADR 0117 § 4), each followed by `onFactsChanged` once it wrote something.
 */
export function told(
  service: ToldWrites,
  onFactsChanged: (creatorId: CreatorId, fanId: FanId) => Promise<void>,
): ToldWrites {
  return {
    proposeFacts: async (creatorId, fanId, proposals) => {
      const written = await service.proposeFacts(creatorId, fanId, proposals);
      if (written.length > 0) await onFactsChanged(creatorId, fanId);
      return written;
    },
    proposeRead: async (creatorId, fanId, read, sources) => {
      const written = await service.proposeRead(creatorId, fanId, read, sources);
      if (written.length > 0) await onFactsChanged(creatorId, fanId);
      return written;
    },
    editCard: async (creatorId, fanId, field, edit, author) => {
      const card = await service.editCard(creatorId, fanId, field, edit, author);
      await onFactsChanged(creatorId, fanId);
      return card;
    },
    setFlag: async (creatorId, fanId, change, command) => {
      const after = await service.setFlag(creatorId, fanId, change, command);
      if (change.flag === 'ageConfirmedAt') await onFactsChanged(creatorId, fanId);
      return after;
    },
  };
}
