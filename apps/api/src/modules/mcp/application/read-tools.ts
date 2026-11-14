import {
  CreatorIdSchema,
  McpCreatorGetSchema,
  McpCreatorListSchema,
  type McpCreator,
} from '@impera/contracts';
import { z } from 'zod';

import type { CreatorEntry, CreatorReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

const creatorOf = (entry: CreatorEntry): McpCreator => ({
  id: CreatorIdSchema.parse(entry.id),
  displayName: entry.displayName,
  timezone: entry.timezone,
});

/**
 * The tools of the persona module's directory (ADR 0026 § 5, `read:status`): its creators without their persona. The
 * call is already confined by `decideCall`: to the access's creator when it has one, else to those the person reads.
 */
export function creatorTools(reader: CreatorReader): Readonly<Record<string, ServedTool>> {
  return {
    creators_list: {
      description:
        'Les créatrices que cet accès peut lire (la sienne seule pour un accès borné à une créatrice), sans les archivées : identifiant, nom, fuseau horaire. Jamais la persona.',
      input: z.strictObject({}),
      output: McpCreatorListSchema,
      run: async ({ actor, creatorId }) => {
        const ids =
          creatorId !== null
            ? [CreatorIdSchema.parse(creatorId)]
            : actor.readableCreatorIds === 'all'
              ? 'all'
              : actor.readableCreatorIds.map((id) => CreatorIdSchema.parse(id));
        return { creators: (await reader.unarchived(ids)).map(creatorOf) };
      },
    },
    creator_get: {
      description:
        'La créatrice de cet accès : identifiant, nom, fuseau horaire ; `null` si elle est archivée. Jamais la persona.',
      input: z.strictObject({ creatorId: CreatorIdSchema.optional() }),
      output: McpCreatorGetSchema,
      run: async ({ creatorId }) => {
        if (creatorId === null) return { creator: null };
        const [entry] = await reader.unarchived([CreatorIdSchema.parse(creatorId)]);
        return { creator: entry === undefined ? null : creatorOf(entry) };
      },
    },
  };
}
