import {
  DESIRE_SIGNALS_MAX,
  DraftIdSchema,
  jobKeyFor,
  newId,
  nextReplyOpening,
  queueNameFor,
  replyOpenAt,
  reopenJobKey,
  type AgentHours,
  type AlertTrigger,
  type HandoffCause,
  type JobPayload,
} from '@nirvana/contracts';

import type {
  Clock,
  ComposeInput,
  ComposeResult,
  Conversation,
  DraftComposer,
  DraftVoice,
  EventMeta,
  FanDirectory,
  HoldReason,
  JobLogger,
  ReplyHours,
  Transaction,
  UnitOfWork,
} from '../../domain/ports';
import { deferredRespondAt } from '../../domain/rules';
import { closeAutomaticIfLocked } from '../automatic';
import { readProposedFacts } from '../facts';
import { appendEvent } from '../journal';

export interface RespondDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** The voice version the server writes with now: an answer in automatic needs its lock open (ADR 0019). */
  readonly voice: DraftVoice;
  /** Her facts about the fan, read for the engine (P3-02). */
  readonly fans: Pick<FanDirectory, 'activeFacts'>;
  /** The engine; without it the draft stays empty and the operator writes it (P0-05 behaviour). */
  readonly composer?: DraftComposer;
  /** Her hours (P3-14); without them she is always open, as before. */
  readonly replyHours?: ReplyHours;
}

/** Messages the engine reads. */
export const HISTORY_LIMIT = 40;

/** Holds that give the conversation to the chatters; the others put it back to `idle`. */
const HANDOFF_REASONS: readonly HoldReason[] = [
  'guard_blocked',
  'handoff',
  'budget_reached',
  'llm_unavailable',
];

/** The cause a hold implies when the engine gives none: alerts rank on it. */
export const DEFAULT_CAUSES: Partial<Record<HoldReason, HandoffCause>> = {
  guard_blocked: 'guard',
  budget_reached: 'budget',
  llm_unavailable: 'llm_unavailable',
};

/** The code of the handoff when the second pass after a wait wrote nothing. */
const WAITED_NO_REPLY = 'waited_no_reply';

/**
 * What an engine handoff keeps in the journal: its codes in `detail`, never in `reason`, which a chatter reads. The
 * cause already says why in her words (the reader's labels).
 */
export const handoffDetail = (codes: readonly string[]): readonly string[] =>
  codes
    .map((code) => code.slice(0, 500))
    .filter((code) => code !== '')
    .slice(0, 20);

/** After a wait, a known situation, not a technical cause: the chatter reads why he takes over (P3-11). */
const WAITED_NO_REPLY_REASON = 'après l’attente, l’agent n’avait plus rien à lui écrire';

const EMPTY_DRAFT: ComposeResult = { kind: 'draft', bubbles: [], softViolations: [], costUsd: 0 };

/** One line of her notes about the fan; a chatter's note reads as such, its dated key says nothing to the engine. */
export const noteLine = (fact: {
  readonly category: string;
  readonly key: string;
  readonly value: string;
}): string => (fact.category === 'operator_note' ? `Note : ${fact.value}` : `${fact.key} : ${fact.value}`);

/** The same alert, however it matched: a custom one by its row, a system one by its code. */
const alertKey = ({ alert }: AlertTrigger): string => (alert.kind === 'custom' ? alert.id : alert.code);

/** Her alerts not yet sounded since her last answer: the team hears of each once until she answers. */
function unsounded<T extends { readonly trigger: AlertTrigger }>(
  alerts: readonly T[],
  sounded: readonly AlertTrigger[],
): T[] {
  const done = new Set(sounded.map(alertKey));
  return alerts.filter((alert) => !done.has(alertKey(alert.trigger)));
}

const lastInboundKey = (conversation: Conversation): number => conversation.lastInboundAt?.getTime() ?? 0;

/**
 * Journals the engine's desire score with the result it came with (P3-12). The engine gives one only when the score
 * moved from the stored one cooled down to now: otherwise nothing is written, not even its time, so that it keeps
 * cooling from its last computation, the projection is the last `desire_scored`, and a rebuild finds it exactly.
 */
async function recordDesire(
  tx: Transaction,
  conversation: Conversation,
  result: ComposeResult,
  meta: EventMeta,
): Promise<Conversation> {
  const desire = result.desire;
  if (desire === undefined) return conversation;
  return appendEvent(
    tx,
    conversation,
    {
      type: 'desire_scored',
      payload: {
        before: desire.before,
        score: desire.score,
        signals: desire.signals.slice(0, DESIRE_SIGNALS_MAX),
        weightsVersion: desire.weightsVersion,
      },
    },
    meta,
  );
}

/** Why the second pass after a wait has nothing to do: he wrote since (another job answers), or she did. */
function waitedOver(conversation: Conversation, waitedFor: Date): string | null {
  if (conversation.state !== 'idle') return `state ${conversation.state}`;
  if (conversation.lastInboundAt?.getTime() !== waitedFor.getTime()) return 'fan_wrote';
  const answered = conversation.lastOutboundAt;
  return answered !== null && answered.getTime() >= waitedFor.getTime() ? 'answered' : null;
}

/**
 * The conversation still waits for this answer: same state, no fan message since, nothing blocking. The second pass
 * after a wait (P3-11) finds it at rest, his message still the last one and still unanswered.
 */
async function stillPending(
  tx: Transaction,
  conversation: Conversation | null,
  logger: JobLogger,
  waitedFor: Date | null = null,
) {
  if (conversation === null) {
    logger.warn({}, 'respond: conversation not found');
    return false;
  }
  if (waitedFor !== null) {
    const over = waitedOver(conversation, waitedFor);
    if (over !== null) {
      logger.info({ over }, 'respond: the wait is over');
      return false;
    }
  } else if (conversation.state !== 'pending') {
    logger.info({ state: conversation.state }, 'respond: nothing to answer');
    return false;
  }
  const blocked = await tx.gate.blockedReason(conversation);
  if (blocked !== null) {
    logger.info({ blocked }, 'respond: blocked');
    return false;
  }
  return true;
}

/**
 * No draft out of her hours (P3-14): the conversation stays `pending`, his message waits, and her next opening answers
 * it. Every deferral of hers points at one `conversation.reopen` job (its key), which answers all the fans who
 * wrote, the longest wait first. A wait she chose (P3-11) leaves the conversation at rest, so it keeps its own job,
 * at the opening, with `waitedFor`.
 */
async function deferReply(
  tx: Transaction,
  conversation: Conversation,
  until: Date,
  payload: JobPayload<'conversation.respond'>,
  at: Date,
): Promise<void> {
  await appendEvent(
    tx,
    conversation,
    { type: 'reply_deferred', payload: { reason: 'outside_hours', until: until.toISOString() } },
    { actor: 'system', correlationId: payload.correlationId, at },
  );
  if (payload.waitedFor !== undefined) {
    await tx.jobs.enqueue('conversation.respond', payload, {
      queueName: queueNameFor(conversation.id),
      jobKey: jobKeyFor('conversation.respond', conversation.id),
      runAt: until,
    });
    return;
  }
  await tx.jobs.enqueue(
    'conversation.reopen',
    { creatorId: conversation.creatorId, correlationId: payload.correlationId },
    { jobKey: reopenJobKey(conversation.creatorId), runAt: until },
  );
}

/**
 * Out of her reply slots (P3-14), the opening of her next slot: no draft until then, whoever is on shift. A chatter on
 * shift is not bound by her hours, but answers in Reveal (ADR 0025): a draft of the agent at 4:00 would serve nobody,
 * and her hours exist so that she does not answer at 4:00. `null` when she may answer now.
 */
function closedUntil(
  her: { readonly hours: AgentHours; readonly timeZone: string } | null,
  now: Date,
): Date | null {
  if (her === null || replyOpenAt(her.hours, her.timeZone, now)) return null;
  const opening = nextReplyOpening(her.hours, her.timeZone, now);
  // Her hours always have an active slot (the contract); stored hours that had none never put a job off to now.
  return opening.getTime() > now.getTime() ? opening : null;
}

/**
 * `conversation.respond`, after the debounce (message-flow.md §1). Three steps, so that no lock is held while the
 * engine thinks (seconds): read the gates and the context; compose outside any transaction; re-lock and write,
 * unless the fan wrote again meanwhile (the next debounce answers) or a gate closed. Never sends anything: the
 * draft waits for an operator (copilot). Replayed after a crash, it finds the conversation past `pending`.
 */
export function createRespondJob({ uow, clock, voice, fans, composer, replyHours }: RespondDeps) {
  return async (payload: JobPayload<'conversation.respond'>, logger: JobLogger): Promise<void> => {
    const waitedFor = payload.waitedFor === undefined ? null : new Date(payload.waitedFor);
    // Before the engine: if the lock closed (the live rate fell, the voice changed), automatic is over for her.
    const closed = await closeAutomaticIfLocked(uow, payload.creatorId, voice, {
      actor: 'system',
      correlationId: payload.correlationId,
      at: clock.now(),
    });
    if (closed) logger.info({}, 'respond: Automatique closed, back to the copilot');
    const draftId = newId(DraftIdSchema);
    const hours = replyHours === undefined ? null : await replyHours.of(payload.creatorId);
    const until = closedUntil(hours, clock.now());
    const read = await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(payload.conversationId);
      if (conversation === null || !(await stillPending(tx, conversation, logger, waitedFor))) return null;
      if (until !== null) {
        await deferReply(tx, conversation, until, payload, clock.now());
        logger.info({ until: until.toISOString() }, 'respond: out of her hours, deferred');
        return null;
      }
      return {
        conversation,
        history: await tx.messages.history(conversation.id, HISTORY_LIMIT),
        stats: await tx.messages.fanStats(conversation.fanId),
        lastInbound: lastInboundKey(conversation),
      };
    });
    if (read === null) return;
    // Her facts come from the `fans` module, which reads them in its own transaction: outside the lock above.
    const notes = await fans.activeFacts(read.conversation.creatorId, read.conversation.fanId);
    const now = clock.now();
    const input: ComposeInput = {
      creatorId: read.conversation.creatorId,
      conversationId: read.conversation.id,
      fanId: read.conversation.fanId,
      draftId,
      correlationId: payload.correlationId,
      now,
      platformAccountId: read.conversation.platformAccountId,
      platformConversationId: read.conversation.platformConversationId,
      history: read.history,
      fan: { ...read.stats, notes: notes.map(noteLine) },
      ...(waitedFor !== null && { waited: 1 }),
      ...(hours !== null && { hours: hours.hours }),
      ...(read.conversation.desireScore !== null &&
        read.conversation.desireAt !== null && {
          desire: { score: read.conversation.desireScore, at: read.conversation.desireAt },
        }),
    };
    const source = read.history.findLast((message) => message.author === 'fan') ?? null;

    let result: ComposeResult;
    try {
      result = composer === undefined ? EMPTY_DRAFT : await composer.compose(input);
    } catch (error) {
      // The engine is expected to answer `held`; anything thrown counts as no model reachable.
      logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'respond: composer failed');
      result = { kind: 'held', reason: 'llm_unavailable', detail: [], costUsd: 0 };
    }

    await uow.inTenant(payload.creatorId, async (tx) => {
      const locked = await tx.conversations.lock(payload.conversationId);
      if (locked === null || !(await stillPending(tx, locked, logger, waitedFor))) return;
      if (lastInboundKey(locked) !== read.lastInbound) {
        logger.info({ draftId }, 'respond: fan wrote again, result dropped');
        return;
      }
      const meta: EventMeta = { actor: 'ai', correlationId: payload.correlationId, at: clock.now() };
      let conversation = await recordDesire(tx, locked, result, meta);
      // Her alerts that only let a human know (P4-01), whatever the answer becomes: named, never his words. One
      // already sounded since her last answer (a second pass after a wait, another message of his) is not again.
      const sounded =
        result.alerts === undefined || result.alerts.length === 0
          ? []
          : await tx.events.alertsSince(conversation.id, conversation.lastOutboundAt);
      for (const alert of unsounded(result.alerts ?? [], sounded)) {
        conversation = await appendEvent(
          tx,
          conversation,
          {
            type: 'alert_triggered',
            payload: { conversationId: conversation.id, trigger: alert.trigger, notify: alert.notify },
          },
          meta,
        );
      }
      if (result.kind === 'draft') {
        await tx.drafts.insert({
          id: draftId,
          conversationId: conversation.id,
          // One draft per fan message answered: a replay with the same last message cannot write a second one.
          idempotencyKey: `respond:${conversation.id}:${String(read.lastInbound)}`,
          createdAt: meta.at,
          bubbles: result.bubbles,
          softViolations: result.softViolations,
          ...(result.voice !== undefined && { voice: result.voice }),
          ...(result.personaVersionId !== undefined && { personaVersionId: result.personaVersionId }),
          facts: readProposedFacts(result.factsProposed ?? [], source, now),
        });
        await appendEvent(
          tx,
          conversation,
          { type: 'draft_created', payload: { draftId, status: 'pending' } },
          meta,
        );
        logger.info(
          { draftId, bubbles: result.bubbles.length, costUsd: result.costUsd, mode: conversation.mode },
          'respond: draft created',
        );
        return;
      }
      // After a wait, nothing written is nothing to wait for any more: a human answers him (P3-11).
      if (HANDOFF_REASONS.includes(result.reason) || waitedFor !== null) {
        const held = waitedFor !== null && !HANDOFF_REASONS.includes(result.reason);
        const detail = handoffDetail([held ? WAITED_NO_REPLY : result.reason, ...result.detail]);
        const cause = result.cause ?? DEFAULT_CAUSES[result.reason] ?? 'other';
        await appendEvent(
          tx,
          conversation,
          {
            type: 'handoff_requested',
            payload: {
              conversationId: conversation.id,
              cause,
              ...(held && { reason: WAITED_NO_REPLY_REASON }),
              detail: [...detail],
              ...(result.trigger !== undefined && { trigger: result.trigger }),
            },
          },
          meta,
        );
      } else {
        // She chose to wait (« attends, je reviens »): her answer is tried once more, unless he writes first.
        const retryAt =
          conversation.lastInboundAt === null ? null : deferredRespondAt(result.retryAt, meta.at);
        await appendEvent(
          tx,
          conversation,
          {
            type: 'reply_skipped',
            payload: {
              reason: 'no_reply',
              detail: result.detail.map((line) => line.slice(0, 500)).slice(0, 20),
              ...(retryAt !== null && { retryAt: retryAt.toISOString() }),
            },
          },
          meta,
        );
        if (retryAt !== null && conversation.lastInboundAt !== null) {
          await tx.jobs.enqueue(
            'conversation.respond',
            {
              creatorId: conversation.creatorId,
              conversationId: conversation.id,
              correlationId: payload.correlationId,
              waitedFor: conversation.lastInboundAt.toISOString(),
            },
            {
              queueName: queueNameFor(conversation.id),
              // His next message replaces it: the debounce answers that one instead.
              jobKey: jobKeyFor('conversation.respond', conversation.id),
              runAt: retryAt,
            },
          );
        }
      }
      logger.info({ reason: result.reason, costUsd: result.costUsd }, 'respond: held');
    });
  };
}
