import {
  ConversationIdSchema,
  CreatorIdSchema,
  TeamMemberStatusSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { and, inArray, schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { AwayHolds } from '../../domain/ports';
import { statesAllowing } from '../../domain/state-machine';

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
 * and the members' statuses are the team's. Only those in a state `release` allows: one routed to him that the machine
 * cannot release (`idle`, say) is left out, rather than read again each minute and holding a place in the batch; he
 * reads it no more anyway. Read only; each release is then written in its creator's transaction.
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
          .where(
            and(
              sql`${teamMembers.status} <> 'active'`,
              inArray(conversations.state, [...statesAllowing('release')]),
            ),
          )
          .orderBy(conversations.creatorId, conversations.id)
          .limit(limit);
        return rows.map((row) => AwayHoldSchema.parse(row));
      }),
  };
}
