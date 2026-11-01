import {
  AuditEntryIdSchema,
  BlindTestIdSchema,
  ConversationIdSchema,
  EventIdSchema,
  ExternalMediaSchema,
  JOB_MAX_ATTEMPTS,
  KillSwitchIdSchema,
  JOB_PAYLOADS,
  LIVE_WINDOW,
  MessageAuthorSchema,
  MessageDirectionSchema,
  MessageIdSchema,
  newId,
} from '@nirvana/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withTenant,
  type Database,
  type Transaction as DbTransaction,
} from '@nirvana/db';
import { z } from 'zod';

import type { Transaction, UnitOfWork } from '../../domain/ports';

import { toConversation, toDraft, toStoredBrief, toStoredEvent } from './rows';

const OPEN_DRAFT_STATUSES = ['pending', 'approved', 'edited'];

const PlatformMediaSchema = z.array(ExternalMediaSchema);

/** The repositories of one tenant transaction (`withTenant`: RLS scopes every statement to the creator). */
function bind(tx: DbTransaction, creatorId: string): Transaction {
  // Her active persona, read inside the statement that needs it: part of the version Automatique is proved on (ADR 0022).
  const activePersona = sql`(select id from persona_versions where creator_id = ${creatorId} and is_active)`;
  return {
    conversations: {
      async lockOrCreate(key) {
        await tx
          .insert(schema.conversations)
          .values({ ...key })
          .onConflictDoNothing({
            target: [schema.conversations.platformAccountId, schema.conversations.platformConversationId],
          });
        const [row] = await tx
          .select()
          .from(schema.conversations)
          .where(
            and(
              eq(schema.conversations.platformAccountId, key.platformAccountId),
              eq(schema.conversations.platformConversationId, key.platformConversationId),
            ),
          )
          .for('update');
        if (row === undefined) throw new Error('Conversation upsert returned no row');
        return toConversation(row);
      },
      async lock(id) {
        const [row] = await tx
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, id))
          .for('update');
        return row === undefined ? null : toConversation(row);
      },
      async saveProjection(id, projection) {
        await tx
          .update(schema.conversations)
          .set({ ...projection, updatedAt: sql`now()` })
          .where(eq(schema.conversations.id, id));
      },
      async idsInMode(mode) {
        const rows = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.mode, mode))
          .orderBy(schema.conversations.id);
        return rows.map((row) => ConversationIdSchema.parse(row.id));
      },
      async idsInState(state) {
        const rows = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.state, state))
          .orderBy(sql`${schema.conversations.lastInboundAt} asc nulls last`, schema.conversations.id);
        return rows.map((row) => ConversationIdSchema.parse(row.id));
      },
    },

    messages: {
      async insertIfNew(message) {
        const inserted = await tx
          .insert(schema.messages)
          .values({ ...message, platformMedia: [...message.platformMedia], creatorId })
          .onConflictDoNothing({
            target: [schema.messages.platformAccountId, schema.messages.platformMessageId],
          })
          .returning({ id: schema.messages.id });
        return inserted.length > 0;
      },
      async countForDraft(draftId) {
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.messages)
          .where(eq(schema.messages.draftId, draftId));
        return row?.count ?? 0;
      },
      async history(conversationId, limit) {
        const rows = await tx
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, conversationId))
          .orderBy(sql`${schema.messages.platformCreatedAt} desc, ${schema.messages.id} desc`)
          .limit(limit);
        return rows.reverse().map((row) => ({
          id: MessageIdSchema.parse(row.id),
          direction: MessageDirectionSchema.parse(row.direction),
          author: MessageAuthorSchema.parse(row.author),
          text: row.text,
          at: row.platformCreatedAt,
          priceMinor: row.priceMinor,
          isPaid: row.isPaid,
          platformMessageId: row.platformMessageId,
          // Written by ingestion only, through the contract's schema: read back through it too (a column is a boundary).
          media: PlatformMediaSchema.parse(row.platformMedia).map((media) => ({
            kind: media.kind,
            platformMediaId: media.ref.id,
            isLocked: media.isLocked,
          })),
        }));
      },
      async fanStats(fanId) {
        const [totals] = await tx
          .select({
            spentMinor: sql<number>`coalesce(sum(${schema.messages.priceMinor}) filter (where ${schema.messages.isPaid}), 0)::int`,
            firstMessageAt: sql<string | null>`min(${schema.messages.platformCreatedAt})`,
          })
          .from(schema.messages)
          .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
          .where(eq(schema.conversations.fanId, fanId));
        const firstMessageAt = totals?.firstMessageAt ?? null;
        return {
          spentMinor: totals?.spentMinor ?? 0,
          firstMessageAt: firstMessageAt === null ? null : new Date(firstMessageAt),
        };
      },
    },

    drafts: {
      async lock(id) {
        const [row] = await tx.select().from(schema.drafts).where(eq(schema.drafts.id, id)).for('update');
        return row === undefined ? null : toDraft(row);
      },
      async openFor(conversationId) {
        const rows = await tx
          .select()
          .from(schema.drafts)
          .where(
            and(
              eq(schema.drafts.conversationId, conversationId),
              sql`${schema.drafts.status} in ${OPEN_DRAFT_STATUSES}`,
            ),
          )
          .orderBy(schema.drafts.createdAt)
          .for('update');
        return rows.map(toDraft);
      },
      async insert({ bubbles, softViolations, voice, personaVersionId, facts, ...draft }) {
        await tx.insert(schema.drafts).values({
          ...draft,
          creatorId,
          ...(facts !== undefined && facts.length > 0 && { brief: toStoredBrief(facts) }),
          bubbles: [...(bubbles ?? [])],
          guardTrace: { softViolations: [...(softViolations ?? [])] },
          ...(voice !== undefined && {
            promptHashes: { ...voice },
            personaVersionId: personaVersionId ?? activePersona,
          }),
        });
      },
      async setStatus(id, status, decision) {
        await tx
          .update(schema.drafts)
          .set({
            status,
            ...(decision === undefined
              ? {}
              : {
                  decidedBy: decision.decidedBy,
                  decidedAt: decision.at,
                  ...(decision.finalBubbles === undefined
                    ? {}
                    : { finalBubbles: [...decision.finalBubbles] }),
                }),
          })
          .where(eq(schema.drafts.id, id));
      },
    },

    events: {
      async append(conversation, body, meta) {
        // The caller holds the conversation's row lock, so `max(seq) + 1` cannot race; the unique index
        // `(conversation_id, seq)` would reject it anyway.
        const [row] = await tx
          .insert(schema.conversationEvents)
          .values({
            id: newId(EventIdSchema),
            creatorId,
            conversationId: conversation.id,
            seq: sql`(select coalesce(max(seq), 0) + 1 from conversation_events where conversation_id = ${conversation.id})`,
            type: body.type,
            payload: body.payload,
            actor: meta.actor,
            correlationId: meta.correlationId,
            createdAt: meta.at,
          })
          .returning({ seq: schema.conversationEvents.seq });
        if (row === undefined) throw new Error('Event insert returned no row');
        return row.seq;
      },
      async publish(eventCreatorId, body, meta) {
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: eventCreatorId,
          type: body.type,
          payload: body.payload,
          actor: meta.actor,
          correlationId: meta.correlationId,
          createdAt: meta.at,
        });
      },
      async alertsSince(conversationId, since) {
        const rows = await tx
          .select()
          .from(schema.conversationEvents)
          .where(
            and(
              eq(schema.conversationEvents.conversationId, conversationId),
              eq(schema.conversationEvents.type, 'alert_triggered'),
              since === null
                ? undefined
                : sql`${schema.conversationEvents.createdAt} > ${since.toISOString()}`,
            ),
          )
          .orderBy(schema.conversationEvents.seq);
        return rows
          .map(toStoredEvent)
          .flatMap(({ body }) => (body.type === 'alert_triggered' ? [body.payload.trigger] : []));
      },
      async list(conversationId) {
        const rows = await tx
          .select()
          .from(schema.conversationEvents)
          .where(eq(schema.conversationEvents.conversationId, conversationId))
          .orderBy(schema.conversationEvents.seq);
        return rows.map(toStoredEvent);
      },
    },

    jobs: {
      async enqueue(job, payload, options) {
        // Validated here too: a job is a boundary (CLAUDE.md rule 6), and a bad payload must fail the command.
        const parsed: unknown = JOB_PAYLOADS[job].parse(payload);
        await tx.execute(
          sql`select public.enqueue_job(
            task => ${job},
            payload => ${JSON.stringify(parsed)}::jsonb,
            queue_name => ${options.queueName ?? null},
            run_at => ${options.runAt?.toISOString() ?? null}::timestamptz,
            max_attempts => ${options.maxAttempts ?? JOB_MAX_ATTEMPTS[job]}::int,
            job_key => ${options.jobKey ?? null},
            job_key_mode => ${options.jobKeyMode ?? 'replace'}
          )`,
        );
      },
    },

    switches: {
      async lockCreator() {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`agent_mode:${creatorId}`}, 0))`,
        );
        const rows = await tx.execute<{ found: boolean }>(
          sql`select exists (select 1 from creators where id = ${creatorId}) as found`,
        );
        return rows.rows[0]?.found === true;
      },
      async isOn() {
        const rows = await tx.execute<{ scope: string; active: boolean }>(sql`
          select distinct on (scope) scope, active
          from kill_switches
          where scope = 'global' or (scope = 'creator' and scope_id = ${creatorId})
          order by scope, set_at desc`);
        const on = (scope: string) => rows.rows.some((row) => row.scope === scope && row.active);
        return { global: on('global'), creator: on('creator') };
      },
      async setCreator(entry) {
        await tx.insert(schema.killSwitches).values({
          id: newId(KillSwitchIdSchema),
          scope: 'creator',
          scopeId: creatorId,
          creatorId,
          active: entry.active,
          reason: entry.reason,
          setBy: entry.setBy,
          setAt: sql`clock_timestamp()`,
        });
      },
    },

    automatic: {
      async personaActive() {
        const [row] = await tx
          .select({ id: schema.personaVersions.id })
          .from(schema.personaVersions)
          .where(
            and(eq(schema.personaVersions.creatorId, creatorId), eq(schema.personaVersions.isActive, true)),
          );
        return row !== undefined;
      },
      async decided(voice) {
        // Approved as is: neither edited nor rejected, and sent with the bubbles it was written with (ADR 0019).
        const rows = await tx.execute<{ as_is: boolean }>(sql`
          select (status not in ('rejected', 'edited') and final_bubbles is null) as as_is
          from drafts
          where decided_at is not null
            and status in ('approved', 'edited', 'rejected', 'sent', 'failed')
            and prompt_hashes->>'voicePrompt' = ${voice.voicePrompt}
            and prompt_hashes->>'voiceModel' = ${voice.voiceModel}
            and persona_version_id is not distinct from ${activePersona}
          order by decided_at desc, id desc limit ${LIVE_WINDOW}`);
        return rows.rows.map((row) => ({ asIs: row.as_is }));
      },
      async latestBlindTest(voice) {
        const [row] = await tx
          .select({ ratePerMille: schema.blindTests.ratePerMille })
          .from(schema.blindTests)
          .where(
            and(
              eq(schema.blindTests.voicePrompt, voice.voicePrompt),
              eq(schema.blindTests.voiceModel, voice.voiceModel),
              sql`${schema.blindTests.personaVersionId} is not distinct from ${activePersona}`,
            ),
          )
          .orderBy(sql`${schema.blindTests.recordedAt} desc`)
          .limit(1);
        return row?.ratePerMille ?? null;
      },
      async recordBlindTest(entry) {
        const [row] = await tx
          .insert(schema.blindTests)
          .values({
            id: newId(BlindTestIdSchema),
            creatorId,
            voicePrompt: entry.voice.voicePrompt,
            voiceModel: entry.voice.voiceModel,
            personaVersionId: activePersona,
            ratePerMille: entry.ratePerMille,
            recordedBy: entry.recordedBy,
            recordedAt: sql`clock_timestamp()`,
          })
          .returning({ recordedAt: schema.blindTests.recordedAt });
        if (row === undefined) throw new Error('blind test insert returned no row');
        return row.recordedAt;
      },
    },

    audit: {
      async record(entry) {
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: entry.userId,
          action: entry.action,
          entity: entry.entity ?? 'conversation',
          entityId: entry.entityId,
          details: entry.details ?? {},
        });
      },
    },

    gate: {
      async blockedReason(conversation) {
        // The latest switch of each scope decides; a global one has no creator and stays visible (RLS).
        const switches = await tx.execute<{ active: boolean }>(sql`
          select distinct on (scope, scope_id) active
          from kill_switches
          where scope = 'global'
             or (scope = 'creator' and scope_id = ${conversation.creatorId})
             or (scope = 'conversation' and scope_id = ${conversation.id})
          order by scope, scope_id, set_at desc`);
        if (switches.rows.some((row) => row.active)) return 'kill_switch';
        const [account] = await tx
          .select({ sessionState: schema.platformAccounts.sessionState })
          .from(schema.platformAccounts)
          .where(eq(schema.platformAccounts.id, conversation.platformAccountId));
        return account?.sessionState === 'expired' ? 'session_expired' : null;
      },
    },
  };
}

export function createDrizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    inTenant: (creatorId, work) => withTenant(db, creatorId, (tx) => work(bind(tx, creatorId))),
  };
}
