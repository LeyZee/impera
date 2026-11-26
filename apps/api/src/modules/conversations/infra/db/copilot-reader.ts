import {
  ConversationIdSchema,
  ConversationStateSchema,
  CreatorSettingsSchema,
  DraftIdSchema,
  FanFlagsSchema,
  FanIdSchema,
  type BankedObjectionKind,
  type FanFlags,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withTenant,
  type Database,
  type Transaction as DbTransaction,
} from '@impera/db';

import type { CopilotLive } from '../../domain/copilot-assist';
import type { CopilotReader } from '../../domain/ports';

import { openedLately, writeOpening } from './openings';
import { readCopilotTrace, readDraftTranslation, toStoredEvent } from './rows';

/** A fan's message waits for the agent: queued, or being written. */
const WRITING_STATES = new Set(['pending', 'drafting']);

/** Her switches; a stored setting that does not read leaves the defaults (the card on, the drafts off). */
function switchesOf(settings: unknown) {
  const parsed = CreatorSettingsSchema.safeParse(settings);
  return (parsed.success ? parsed.data : CreatorSettingsSchema.parse({})).copilot;
}

/** His limits as stored; `null` when they do not read, and the panel cuts the sale (fail closed). */
async function flagsOf(tx: DbTransaction, fanId: string): Promise<FanFlags | null> {
  const [fan] = await tx
    .select({ flags: schema.fans.flags })
    .from(schema.fans)
    .where(eq(schema.fans.id, fanId));
  if (fan === undefined) return null;
  const parsed = FanFlagsSchema.safeParse(fan.flags ?? {});
  return parsed.success ? parsed.data : null;
}

/** What the journal says now (ADR 0141 § 3-4): objections answered, a custom order open, a follow-up due. */
async function journalOf(
  tx: DbTransaction,
  conversationId: string,
  times: { readonly lastInboundAt: Date | null; readonly lastOutboundAt: Date | null; readonly now: Date },
) {
  const rows = await tx
    .select()
    .from(schema.conversationEvents)
    .where(
      and(
        eq(schema.conversationEvents.conversationId, conversationId),
        inArray(schema.conversationEvents.type, [
          'custom_order_opened',
          'objection_reply_used',
          'takeover_started',
          'follow_up_scheduled',
          'follow_up_cancelled',
        ]),
      ),
    )
    .orderBy(schema.conversationEvents.seq);
  let customOrderOpen = false;
  const usedObjections: BankedObjectionKind[] = [];
  let followUp: { readonly runAt: Date; readonly at: Date } | null = null;
  for (const { body, at } of rows.map(toStoredEvent)) {
    if (body.type === 'custom_order_opened') customOrderOpen = true;
    // A human took the conversation: what was open is theirs (as `salesState` reads it).
    if (body.type === 'takeover_started') customOrderOpen = false;
    if (body.type === 'objection_reply_used') usedObjections.push(body.payload.objection);
    if (body.type === 'follow_up_scheduled')
      followUp = body.payload.runAt === undefined ? null : { runAt: new Date(body.payload.runAt), at };
    if (body.type === 'follow_up_cancelled') followUp = null;
  }
  // Due: its time has come, he has not written since, and nothing of hers left after it.
  const followUpDue =
    followUp !== null &&
    followUp.runAt <= times.now &&
    (times.lastInboundAt === null || times.lastInboundAt <= followUp.at) &&
    (times.lastOutboundAt === null || times.lastOutboundAt < followUp.runAt);
  return { customOrderOpen, usedObjections, followUpDue };
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
            careSince: schema.conversations.careSince,
            careClosedAt: schema.conversations.careClosedAt,
            lastInboundAt: schema.conversations.lastInboundAt,
            lastOutboundAt: schema.conversations.lastOutboundAt,
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
            policyTrace: schema.drafts.policyTrace,
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
        // Without a draft waiting, where the sale stood at his latest draft that has a trace (ADR 0141 § 3).
        const [traced] =
          draft === undefined
            ? await tx
                .select({ policyTrace: schema.drafts.policyTrace })
                .from(schema.drafts)
                .where(
                  and(eq(schema.drafts.conversationId, id), sql`${schema.drafts.policyTrace} ? 'copilot'`),
                )
                .orderBy(sql`${schema.drafts.createdAt} desc, ${schema.drafts.id} desc`)
                .limit(1)
            : [draft];
        const state = ConversationStateSchema.parse(conversation.state);
        const now = new Date();
        const live: CopilotLive = {
          trace: readCopilotTrace(traced?.policyTrace),
          flags: await flagsOf(tx, conversation.fanId),
          careSince: conversation.careSince,
          careClosedAt: conversation.careClosedAt,
          held: state === 'human',
          ...(await journalOf(tx, id, { ...conversation, now })),
        };
        return {
          conversationId: id,
          fanId: FanIdSchema.parse(conversation.fanId),
          writing: WRITING_STATES.has(state),
          switches: switchesOf(creator?.settings),
          draft:
            draft === undefined
              ? null
              : {
                  id: DraftIdSchema.parse(draft.id),
                  bubbles: draft.bubbles,
                  createdAt: draft.createdAt,
                  placedAt: draft.placedAt,
                  translation: readDraftTranslation(draft.policyTrace),
                },
          live,
        };
      }),
  };
}
