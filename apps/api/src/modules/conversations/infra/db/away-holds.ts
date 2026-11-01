import {
  ConversationIdSchema,
  CreatorIdSchema,
  TeamMemberStatusSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { AwayHolds } from '../../domain/ports';

import { heldBy } from './holds';

const { conversations, teamMembers } = schema;

const AwayHoldSchema = z.object({
  creatorId: CreatorIdSchema,
  conversationId: ConversationIdSchema,
  userId: UserIdSchema,
  status: TeamMemberStatusSchema.exclude(['active']),
});

/**
 * The conversations held by members who are not `active` (EQ-13), on the admin connection: the job runs for no creator,
 * and the members' statuses are the team's. Read only; each release is then written in its creator's transaction.
 */
export function createDrizzleAwayHolds(adminDb: Database): AwayHolds {
  return {
    list: (limit) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            creatorId: conversations.creatorId,
            conversationId: conversations.id,
            userId: teamMembers.userId,
            status: teamMembers.status,
          })
          .from(teamMembers)
          .innerJoin(conversations, heldBy(sql`${teamMembers.userId}`))
          .where(sql`${teamMembers.status} <> 'active'`)
          .orderBy(conversations.creatorId, conversations.id)
          .limit(limit);
        return rows.map((row) => AwayHoldSchema.parse(row));
      }),
  };
}
