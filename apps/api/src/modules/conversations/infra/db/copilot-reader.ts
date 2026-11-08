import {
  ConversationIdSchema,
  ConversationStateSchema,
  CreatorSettingsSchema,
  DraftIdSchema,
  FanIdSchema,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenant, type Database } from '@impera/db';

import type { CopilotReader } from '../../domain/ports';

import { openedLately, writeOpening } from './openings';

/** A fan's message waits for the agent: queued, or being written. */
const WRITING_STATES = new Set(['pending', 'drafting']);

/** Her switches; a stored setting that does not read leaves the defaults (the card on, the drafts off). */
function switchesOf(settings: unknown) {
  const parsed = CreatorSettingsSchema.safeParse(settings);
  return (parsed.success ? parsed.data : CreatorSettingsSchema.parse({})).copilot;
}

/** The copilot panel's read (ADR 0086), in one tenant transaction: RLS scopes every statement to the creator. */
export function createDrizzleCopilotReader(db: Database): CopilotReader {
  return {
    read: (creatorId, { platform, platformConversationId }, trace) =>
      withTenant(db, creatorId, async (tx) => {
        const [conversation] = await tx
          .select({
            id: schema.conversations.id,
            fanId: schema.conversations.fanId,
            state: schema.conversations.state,
          })
          .from(schema.conversations)
          .innerJoin(
            schema.platformAccounts,
            eq(schema.platformAccounts.id, schema.conversations.platformAccountId),
          )
          .where(
            and(
              eq(schema.conversations.platformConversationId, platformConversationId),
              eq(schema.platformAccounts.platform, platform),
            ),
          )
          .limit(1);
        if (conversation === undefined) return null;
        const id = ConversationIdSchema.parse(conversation.id);
        if (trace !== undefined && !(await openedLately(tx, trace.userId, id)))
          await writeOpening(tx, { ...trace, id, creatorId, by: 'chatter', via: 'copilot' });
        const [creator] = await tx
          .select({ settings: schema.creators.settings })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        const [draft] = await tx
          .select({
            id: schema.drafts.id,
            bubbles: schema.drafts.bubbles,
            createdAt: schema.drafts.createdAt,
            placedAt: schema.drafts.placedAt,
          })
          .from(schema.drafts)
          .where(
            and(
              eq(schema.drafts.conversationId, id),
              eq(schema.drafts.status, 'pending'),
              sql`cardinality(${schema.drafts.bubbles}) > 0`,
            ),
          )
          .orderBy(sql`${schema.drafts.createdAt} desc, ${schema.drafts.id} desc`)
          .limit(1);
        return {
          conversationId: id,
          fanId: FanIdSchema.parse(conversation.fanId),
          writing: WRITING_STATES.has(ConversationStateSchema.parse(conversation.state)),
          switches: switchesOf(creator?.settings),
          draft:
            draft === undefined
              ? null
              : {
                  id: DraftIdSchema.parse(draft.id),
                  bubbles: draft.bubbles,
                  createdAt: draft.createdAt,
                  placedAt: draft.placedAt,
                },
        };
      }),
  };
}
