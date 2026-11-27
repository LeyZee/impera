import {
  AuditEntryIdSchema,
  BlindTestIdSchema,
  CalibrationRatingIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  EventIdSchema,
  ExternalMediaSchema,
  FanFlagsSchema,
  JOB_MAX_ATTEMPTS,
  KillSwitchIdSchema,
  JOB_PAYLOADS,
  LIVE_WINDOW,
  MessageAuthorSchema,
  MessageOriginSchema,
  MessageDirectionSchema,
  MessageIdSchema,
  newId,
  type CreatorId,
  type FanId,
  type OpenCustomOrder,
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
import { z } from 'zod';

import type { CardReadMessage, KeptCustomOrderTurn, Transaction, UnitOfWork } from '../../domain/ports';

import { fanStanding, timeWasterSettingOf } from './fan-standing';
import { heldBy } from './holds';
import { toConversation, toDraft, toStoredBrief, toStoredEvent, toStoredPolicyTrace } from './rows';
import { bindScriptRuns } from './script-runs';

const OPEN_DRAFT_STATUSES = ['pending', 'approved', 'edited'];

const PlatformMediaSchema = z.array(ExternalMediaSchema);
/** The latest switch of each scope, read through its end: a pause past its end reads as off (ADR 0148 § 1). */
const SwitchStateRowsSchema = z.array(
  z.object({ scope: z.string(), active: z.boolean(), until: z.coerce.date().nullable() }),
);

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
      async idOfFan(platformAccountId, platformFanId) {
        const [row] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .innerJoin(schema.fans, eq(schema.fans.id, schema.conversations.fanId))
          .where(
            and(
              eq(schema.fans.platformAccountId, platformAccountId),
              eq(schema.fans.platformFanId, platformFanId),
              eq(schema.conversations.platformAccountId, platformAccountId),
            ),
          )
          .orderBy(sql`${schema.conversations.lastInboundAt} desc nulls last`, schema.conversations.id)
          .limit(1);
        return row === undefined ? null : ConversationIdSchema.parse(row.id);
      },
      async isHeldBy(id, userId) {
        const [row] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.id, id), heldBy(sql`${userId}`)));
        return row !== undefined;
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
        if (inserted.length > 0) return true;
        // A script step is recorded at send with no text (the platform writes it): the synced copy fills it once.
        if (message.direction === 'outbound' && (message.text !== '' || message.platformMedia.length > 0))
          await tx
            .update(schema.messages)
            .set({ text: message.text, platformMedia: [...message.platformMedia] })
            .where(
              and(
                eq(schema.messages.platformAccountId, message.platformAccountId),
                eq(schema.messages.platformMessageId, message.platformMessageId),
                eq(schema.messages.direction, 'outbound'),
                eq(schema.messages.text, ''),
                sql`${schema.messages.platformMedia} = '[]'::jsonb`,
              ),
            );
        // A paid step he bought since (ADR 0156 § 2): the synced copy says it is paid, so it is, with its media as
        // the platform now shows them. Only from locked to paid, never back: a later copy cannot unbuy it.
        if (message.direction === 'outbound' && message.isPaid)
          await tx
            .update(schema.messages)
            .set({ isPaid: true, platformMedia: [...message.platformMedia] })
            .where(
              and(
                eq(schema.messages.platformAccountId, message.platformAccountId),
                eq(schema.messages.platformMessageId, message.platformMessageId),
                eq(schema.messages.direction, 'outbound'),
                eq(schema.messages.isPaid, false),
              ),
            );
        return false;
      },
      async countForDraft(draftId) {
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.messages)
          .where(eq(schema.messages.draftId, draftId));
        return row?.count ?? 0;
      },
      async textsForDraft(draftId) {
        const rows = await tx
          .select({ text: schema.messages.text })
          .from(schema.messages)
          .where(eq(schema.messages.draftId, draftId))
          .orderBy(schema.messages.platformCreatedAt, schema.messages.id);
        return rows.map((row) => row.text);
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
          origin: row.origin === null ? null : MessageOriginSchema.parse(row.origin),
        }));
      },
      async fanStats(fanId, now) {
        const [totals] = await tx
          .select({
            spentMinor: sql<number>`coalesce(sum(${schema.messages.priceMinor}) filter (where ${schema.messages.isPaid}), 0)::int`,
            firstMessageAt: sql<string | null>`min(${schema.messages.platformCreatedAt})`,
          })
          .from(schema.messages)
          .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
          .where(eq(schema.conversations.fanId, fanId));
        const firstMessageAt = totals?.firstMessageAt ?? null;
        // His tier and last purchase from her sales register (ADR 0132 § 1), the figures « Fans » shows.
        const standing = await fanStanding(tx, CreatorIdSchema.parse(creatorId), fanId, now);
        const timeWaster = await timeWasterSettingOf(tx, CreatorIdSchema.parse(creatorId));
        return {
          spentMinor: totals?.spentMinor ?? 0,
          firstMessageAt: firstMessageAt === null ? null : new Date(firstMessageAt),
          ...(standing !== null && {
            tier: standing.tier,
            lastPurchaseAt: standing.lastPurchaseAt === null ? null : new Date(standing.lastPurchaseAt),
            registerSpentMinor: standing.spentMinor,
          }),
          ...(timeWaster !== undefined && { timeWaster }),
        };
      },
    },

    cardReads: {
      async pace(conversationId) {
        const [row] = await tx
          .select({
            lastReadAt: schema.conversations.cardReadAt,
            through: schema.conversations.cardReadThrough,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId));
        const through = row?.through ?? null;
        const [count] = await tx
          .select({ unread: sql<number>`count(*)::int` })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, conversationId),
              eq(schema.messages.author, 'fan'),
              // Compared to the millisecond, as `toRead` compares them once read in JavaScript.
              through === null
                ? undefined
                : sql`date_trunc('milliseconds', ${schema.messages.createdAt}) > ${through.toISOString()}::timestamptz`,
            ),
          );
        return { unread: count?.unread ?? 0, lastReadAt: row?.lastReadAt ?? null };
      },
      async toRead(conversationId, limit) {
        const [conversation] = await tx
          .select({ through: schema.conversations.cardReadThrough })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId));
        const readThrough = conversation?.through ?? null;
        const rows = await tx
          .select({
            id: schema.messages.id,
            author: schema.messages.author,
            text: schema.messages.text,
            at: schema.messages.platformCreatedAt,
            createdAt: schema.messages.createdAt,
          })
          .from(schema.messages)
          .where(and(eq(schema.messages.conversationId, conversationId), sql`${schema.messages.text} <> ''`))
          .orderBy(sql`${schema.messages.platformCreatedAt} desc, ${schema.messages.id} desc`)
          .limit(limit);
        const messages: CardReadMessage[] = rows.reverse().map((row) => {
          const isFan = MessageAuthorSchema.parse(row.author) === 'fan';
          return {
            id: MessageIdSchema.parse(row.id),
            from: isFan ? 'fan' : 'creator',
            text: row.text,
            isNew: isFan && (readThrough === null || row.createdAt.getTime() > readThrough.getTime()),
            at: row.at,
          };
        });
        const newest = Math.max(
          ...rows
            .filter((row, index) => messages[index]?.isNew === true)
            .map((row) => row.createdAt.getTime()),
        );
        const through = Number.isFinite(newest) ? new Date(newest) : null;
        return { messages, through };
      },
      async markRead(conversationId, through, at) {
        await tx
          .update(schema.conversations)
          .set({
            cardReadAt: at,
            cardReadThrough: sql`greatest(${schema.conversations.cardReadThrough}, ${through.toISOString()}::timestamptz)`,
          })
          .where(eq(schema.conversations.id, conversationId));
      },
    },

    drafts: {
      async lock(id) {
        const [row] = await tx.select().from(schema.drafts).where(eq(schema.drafts.id, id)).for('update');
        return row === undefined ? null : toDraft(row);
      },
      async paceSince(conversationId, since) {
        const [row] = await tx
          .select({
            count: sql<number>`count(*)::int`,
            lastAt: sql<Date | null>`max(${schema.drafts.createdAt})`.mapWith(schema.drafts.createdAt),
          })
          .from(schema.drafts)
          .where(
            and(
              eq(schema.drafts.conversationId, conversationId),
              sql`${schema.drafts.createdAt} >= ${since.toISOString()}::timestamptz`,
            ),
          );
        return { count: row?.count ?? 0, lastAt: row?.lastAt ?? null };
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
      async existsWithKey(idempotencyKey) {
        const [row] = await tx
          .select({ id: schema.drafts.id })
          .from(schema.drafts)
          .where(eq(schema.drafts.idempotencyKey, idempotencyKey))
          .limit(1);
        return row !== undefined;
      },
      async insert({
        bubbles,
        softViolations,
        voice,
        personaVersionId,
        facts,
        scriptStep,
        copilot,
        translation,
        ...draft
      }) {
        await tx.insert(schema.drafts).values({
          ...draft,
          creatorId,
          ...((scriptStep !== undefined || copilot !== undefined || translation !== undefined) && {
            policyTrace: toStoredPolicyTrace({ scriptStep, copilot, translation }),
          }),
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
      async place(id, placedBy, at) {
        const placed = await tx
          .update(schema.drafts)
          .set({ placedBy, placedAt: at })
          .where(and(eq(schema.drafts.id, id), sql`${schema.drafts.placedAt} is null`))
          .returning({ id: schema.drafts.id });
        return placed.length > 0;
      },
      async rateLive(id, verdict, at) {
        // The version is the draft's own (ADR 0019): a draft written by no model has none, and no rating. Its bubbles
        // are hers; the fan's words are never copied here (migration 0149).
        const rows = await tx.execute(sql`
          insert into calibration_ratings
            (id, creator_id, source, draft_id, rated_at, voice_prompt, voice_model, verdict_kind, verdict, bubbles)
          select ${newId(CalibrationRatingIdSchema)}, creator_id, 'live', id, ${at}, prompt_hashes->>'voicePrompt',
            prompt_hashes->>'voiceModel', ${verdict.kind}, ${JSON.stringify(verdict)}::jsonb, to_jsonb(bubbles)
          from drafts
          where id = ${id} and prompt_hashes ? 'voicePrompt' and prompt_hashes ? 'voiceModel'
          on conflict (draft_id) where draft_id is not null do nothing
          returning id`);
        return rows.rows.length > 0;
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
      async scriptsExhaustedSaid(conversationId) {
        const [last] = await tx
          .select({ type: schema.conversationEvents.type })
          .from(schema.conversationEvents)
          .where(
            and(
              eq(schema.conversationEvents.conversationId, conversationId),
              inArray(schema.conversationEvents.type, ['scripts_exhausted', 'script_started']),
            ),
          )
          .orderBy(sql`${schema.conversationEvents.seq} desc`)
          .limit(1);
        return last?.type === 'scripts_exhausted';
      },
      async abandonTeases(conversationId, scriptRunId) {
        const rows = await tx
          .select({ seq: schema.conversationEvents.seq })
          .from(schema.conversationEvents)
          .where(
            and(
              eq(schema.conversationEvents.conversationId, conversationId),
              eq(schema.conversationEvents.type, 'script_abandon_teased'),
              sql`${schema.conversationEvents.payload} ->> 'scriptRunId' = ${scriptRunId}`,
            ),
          );
        return rows.length;
      },
      async salesState(conversationId) {
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
                'sale_trouble',
              ]),
            ),
          )
          .orderBy(schema.conversationEvents.seq);
        let customOrderOpen = false;
        const usedObjectionReplies: string[] = [];
        let paymentHelpAt: Date | null = null;
        let complaintAt: Date | null = null;
        for (const { body, at } of rows.map(toStoredEvent)) {
          if (body.type === 'custom_order_opened') customOrderOpen = true;
          if (body.type === 'objection_reply_used') usedObjectionReplies.push(body.payload.replyId);
          // A human took the conversation: what was open is theirs, and a trouble after them is a new one.
          if (body.type === 'takeover_started') {
            customOrderOpen = false;
            paymentHelpAt = null;
            complaintAt = null;
          }
          if (body.type === 'sale_trouble' && body.payload.kind === 'payment_help') paymentHelpAt = at;
          if (body.type === 'sale_trouble' && body.payload.kind === 'purchase_complaint') complaintAt = at;
        }
        return { customOrderOpen, usedObjectionReplies, saleTrouble: { paymentHelpAt, complaintAt } };
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
      async archived() {
        const [creator] = await tx
          .select({ archivedAt: schema.creators.archivedAt })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        return creator !== undefined && creator.archivedAt !== null;
      },
      async isOn() {
        const rows = await tx.execute(sql`
          select distinct on (scope) scope, (active and (active_until is null or active_until > now())) as active,
                 case when active and active_until > now() then active_until end as until
          from kill_switches
          where scope = 'global' or (scope = 'creator' and scope_id = ${creatorId})
          order by scope, set_at desc`);
        const switches = SwitchStateRowsSchema.parse(rows.rows);
        const on = (scope: string) => switches.some((row) => row.scope === scope && row.active);
        const creatorUntil = switches.find((row) => row.scope === 'creator')?.until ?? null;
        return { global: on('global'), creator: on('creator'), creatorUntil };
      },
      async setCreator(entry) {
        await tx.insert(schema.killSwitches).values({
          id: newId(KillSwitchIdSchema),
          scope: 'creator',
          scopeId: creatorId,
          creatorId,
          active: entry.active,
          activeUntil: entry.until ?? null,
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
        // Archived, she speaks no more (ADR 0071 § 2): a rule of the code, before any switch.
        const [creator] = await tx
          .select({ archivedAt: schema.creators.archivedAt })
          .from(schema.creators)
          .where(eq(schema.creators.id, conversation.creatorId));
        if (creator !== undefined && creator.archivedAt !== null) return 'creator_archived';
        // The latest switch of each scope decides; a global one has no creator and stays visible (RLS).
        const switches = await tx.execute<{ active: boolean }>(sql`
          select distinct on (scope, scope_id) (active and (active_until is null or active_until > now())) as active
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
      async fanFlags(conversation) {
        const [fan] = await tx
          .select({ flags: schema.fans.flags })
          .from(schema.fans)
          .where(eq(schema.fans.id, conversation.fanId));
        if (fan === undefined) return null;
        const parsed = FanFlagsSchema.safeParse(fan.flags ?? {});
        return parsed.success ? parsed.data : null;
      },
    },

    scriptRuns: bindScriptRuns(tx, creatorId),
  };
}

/**
 * The custom-orders module's store (ADR 0159 § A.2, `CustomOrdersModule.orders`), matched by shape: it works in the
 * turn's own transaction, under her tenant.
 */
export interface CustomOrderStorePort {
  openFor(
    tx: DbTransaction,
    who: { readonly creatorId: CreatorId; readonly fanId: FanId },
  ): Promise<OpenCustomOrder | null>;
  record(
    tx: DbTransaction,
    record: {
      readonly creatorId: CreatorId;
      readonly fanId: FanId;
      readonly inboundMessageId: string;
      readonly turn: KeptCustomOrderTurn;
      readonly at: Date;
    },
  ): Promise<void>;
}

/** His custom order in this transaction, bound to her tenant. */
const bindCustomOrders = (
  store: CustomOrderStorePort,
  tx: DbTransaction,
  creatorId: CreatorId,
): NonNullable<Transaction['customOrders']> => ({
  open: (fanId) => store.openFor(tx, { creatorId, fanId }),
  record: (entry) => store.record(tx, { creatorId, ...entry }),
});

export function createDrizzleUnitOfWork(
  db: Database,
  options: { readonly customOrders?: CustomOrderStorePort } = {},
): UnitOfWork {
  const { customOrders } = options;
  return {
    inTenant: (creatorId, work) =>
      withTenant(db, creatorId, (tx) =>
        work(
          customOrders === undefined
            ? bind(tx, creatorId)
            : { ...bind(tx, creatorId), customOrders: bindCustomOrders(customOrders, tx, creatorId) },
        ),
      ),
  };
}
