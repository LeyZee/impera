import {
  BLIND_TEST_TARGET,
  ConversationIdSchema,
  DomainError,
  jobKeyFor,
  MessageIdSchema,
  newId,
  queueNameFor,
  resumeRunAt,
  type AgentMode,
  type AutomaticGate,
  type BlindTestResult,
  type LiveRateReading,
  type ConversationId,
  type ConversationMode,
  type CreatorId,
  type DraftId,
  type ExternalMessage,
  type PlatformAccountId,
  type UserId,
} from '@nirvana/contracts';

import {
  AutomaticLocked,
  CreatorNotFound,
  DraftGuarded,
  PersonaInactive,
  SendBlocked,
} from '../domain/errors';
import type {
  BubbleGuard,
  Clock,
  Conversation,
  DraftVoice,
  EventMeta,
  FanDirectory,
  Transaction,
  UnitOfWork,
} from '../domain/ports';
import { rebuildProjection, type ConversationProjection } from '../domain/projection';
import { debounceFor } from '../domain/rules';
import { MAX_SEND_ATTEMPTS } from '../domain/state-machine';

import { closeAutomaticIfLocked, readAutomaticGate, readAutomaticLock } from './automatic';
import { appendEvent, lockConversation, lockDraftFor, setDraftStatus } from './journal';

interface IngestMessage {
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  /** The platform's ids for the conversation and its fan, opaque to the core. */
  readonly platformConversationId: string;
  readonly platformFanId: string;
  readonly fanDisplayName: string;
  readonly message: ExternalMessage;
  readonly correlationId: string;
}

interface IngestResult {
  readonly conversationId: ConversationId;
  /** `false` when the platform message was already known: nothing was written. */
  readonly isNew: boolean;
}

/** Who acts and in which conversation, for every dashboard command. */
interface ConversationCommand {
  readonly creatorId: CreatorId;
  readonly conversationId: ConversationId;
  readonly userId: UserId;
  readonly correlationId: string;
}

export interface ConversationCommands {
  ingestMessage(input: IngestMessage): Promise<IngestResult>;
  approveDraft(input: ConversationCommand & { draftId: DraftId; bubbles?: readonly string[] }): Promise<void>;
  rejectDraft(input: ConversationCommand & { draftId: DraftId; reason?: string }): Promise<void>;
  expireDraft(
    input: Omit<ConversationCommand, 'userId'> & { draftId: DraftId; reason: string },
  ): Promise<void>;
  takeover(input: ConversationCommand & { reason?: string }): Promise<void>;
  /** `note`: what the chatter wants her to remember about the fan, kept as an `operator_note` fact (P3-02). */
  release(input: ConversationCommand & { note?: string }): Promise<void>;
  setMode(input: ConversationCommand & { mode: ConversationMode }): Promise<void>;
  /**
   * The Dashboard's control (Arrêt, Copilote, Automatique) for all her conversations. Returns the mode now in
   * force: Arrêt while the global switch stays on, whatever she asked. Automatique only behind its lock (ADR 0019).
   */
  setAgentMode(
    input: Omit<ConversationCommand, 'conversationId'> & { mode: AgentMode },
  ): Promise<{ mode: AgentMode; globalStop: boolean }>;
  /**
   * Whether Automatique may open for her now, what is missing (ADR 0019), and the live rate it was decided on:
   * what the Dashboard shows.
   */
  automaticLock(
    creatorId: CreatorId,
  ): Promise<{ readonly gate: AutomaticGate; readonly reading: LiveRateReading }>;
  /** The owner records the blind test of the voice version the server writes with now. */
  recordBlindTest(input: {
    creatorId: CreatorId;
    userId: UserId;
    rate: number;
    correlationId: string;
  }): Promise<BlindTestResult>;
  /** Recomputes the projection columns from the journal (ADR 0007) and saves them. */
  rebuildProjection(creatorId: CreatorId, conversationId: ConversationId): Promise<ConversationProjection>;
}

export interface CommandDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: FanDirectory;
  /** The voice version the server writes with now (prompt and model): what Automatique is proved on. */
  readonly voice: DraftVoice;
  /** The hard guards, read again on every approval: nothing leaves without them. */
  readonly guard: BubbleGuard;
}

const NEW_FAN_MESSAGE = 'Nouveau message du fan';
const TAKEN_OVER = 'Conversation reprise par un humain';
/** How far back the guards read what she already sent (P3-13): the conversation's last twenty messages. */
const GUARD_HISTORY_MESSAGES = 20;

/** Expires every draft still open: they answer a conversation that has moved on. */
async function expireOpenDrafts(
  tx: Transaction,
  conversation: Conversation,
  reason: string,
  meta: EventMeta,
): Promise<Conversation> {
  let current = conversation;
  for (const draft of await tx.drafts.openFor(conversation.id)) {
    current = await appendEvent(
      tx,
      current,
      { type: 'draft_expired', payload: { draftId: draft.id, status: 'expired', reason } },
      meta,
    );
    await setDraftStatus(tx, draft, 'expired', { decidedBy: null, at: meta.at });
  }
  return current;
}

/** Opens the lock and holds it for the transaction, or refuses Automatique with what is missing. */
async function requireAutomaticOpen(tx: Transaction, voice: DraftVoice): Promise<void> {
  const gate = await readAutomaticGate(tx, voice);
  if (!gate.open) throw new AutomaticLocked(gate.missing);
}

export function createConversationCommands({
  uow,
  clock,
  fans,
  voice,
  guard,
}: CommandDeps): ConversationCommands {
  const humanMeta = (input: { userId: UserId; correlationId: string }): EventMeta => ({
    actor: `human:${input.userId}`,
    correlationId: input.correlationId,
    at: clock.now(),
  });
  /** After a chatter's decision: the live rate moved, Automatique may have to close (ADR 0019). */
  const afterDecision = (creatorId: CreatorId, correlationId: string) =>
    closeAutomaticIfLocked(uow, creatorId, voice, { actor: 'system', correlationId, at: clock.now() });

  return {
    async ingestMessage(input) {
      const at = clock.now();
      const { message } = input;
      const isInbound = message.direction === 'inbound';
      // Its own transaction, before the conversation's: idempotent, and keeps `fans` behind its index.
      const fan = await fans.upsertFanByPlatformId({
        creatorId: input.creatorId,
        platformAccountId: input.platformAccountId,
        platformFanId: input.platformFanId,
        displayName: input.fanDisplayName,
        seenAt: at,
      });
      return uow.inTenant(input.creatorId, async (tx) => {
        let conversation = await tx.conversations.lockOrCreate({
          id: newId(ConversationIdSchema),
          creatorId: input.creatorId,
          platformAccountId: input.platformAccountId,
          fanId: fan.id,
          platformConversationId: input.platformConversationId,
        });
        const messageId = newId(MessageIdSchema);
        // An outbound message we did not send ourselves was written by someone on the platform.
        const author = isInbound ? 'fan' : 'human';
        const isNew = await tx.messages.insertIfNew({
          id: messageId,
          conversationId: conversation.id,
          platformAccountId: input.platformAccountId,
          platformMessageId: message.ref.id,
          direction: message.direction,
          author,
          text: message.text,
          priceMinor: message.priceMinor,
          currency: message.currency,
          isPaid: message.isPaid,
          platformMedia: message.media,
          platformCreatedAt: new Date(message.createdAt),
          draftId: null,
        });
        if (!isNew) return { conversationId: conversation.id, isNew: false };

        const meta: EventMeta = {
          actor: isInbound ? 'fan' : 'system',
          correlationId: input.correlationId,
          at,
        };
        conversation = await appendEvent(
          tx,
          conversation,
          {
            type: 'message_received',
            payload: {
              messageId,
              platformMessageId: message.ref.id,
              direction: message.direction,
              author,
              // Media are matched to `media_assets` by the media module (P3-04).
              mediaIds: [],
            },
          },
          meta,
        );
        if (isInbound) {
          conversation = await expireOpenDrafts(tx, conversation, NEW_FAN_MESSAGE, {
            ...meta,
            actor: 'system',
          });
          if (conversation.state === 'pending') {
            // Debounce: each new message replaces the pending job, so a burst gets one answer (ADR 0006).
            await tx.jobs.enqueue(
              'conversation.respond',
              {
                creatorId: input.creatorId,
                conversationId: conversation.id,
                correlationId: input.correlationId,
              },
              {
                queueName: queueNameFor(conversation.id),
                jobKey: jobKeyFor('conversation.respond', conversation.id),
                runAt: new Date(at.getTime() + debounceFor() * 1_000),
              },
            );
          }
        }
        return { conversationId: conversation.id, isNew: true };
      });
    },

    async approveDraft(input) {
      // Her guards, from her active persona, read before the transaction: no second connection held inside it.
      const herGuard = await guard.forCreator(input.creatorId);
      await uow.inTenant(input.creatorId, async (tx) => {
        const conversation = await lockConversation(tx, input.conversationId);
        const isEdited = input.bubbles !== undefined;
        const status = isEdited ? 'edited' : 'approved';
        const draft = await lockDraftFor(tx, conversation, input.draftId, status);
        // Nothing is approved while nothing may leave: the draft stays pending (message-flow.md §6).
        const blocked = await tx.gate.blockedReason(conversation);
        if (blocked !== null) throw new SendBlocked(blocked);
        const bubbles = input.bubbles ?? draft.bubbles;
        if (bubbles.length === 0 || bubbles.some((bubble) => bubble.trim() === '')) {
          throw new DomainError('draft_invalid', 'Le brouillon est vide');
        }
        // Rewritten or not, what leaves passes the hard guards again: a chatter's words speak for her too, read
        // against what she already sent him (P3-13).
        // Without her active persona, her guards cannot be read: nothing leaves (fail closed).
        if (herGuard === null) throw new PersonaInactive();
        const history = await tx.messages.history(conversation.id, GUARD_HISTORY_MESSAGES);
        const verdict = herGuard.check(bubbles, {
          history: history.map((message) => ({
            from: message.direction === 'inbound' ? 'fan' : 'creator',
            text: message.text,
          })),
        });
        if (verdict.isBlocked) throw new DraftGuarded(verdict.codes);
        const meta = humanMeta(input);
        await appendEvent(
          tx,
          conversation,
          {
            type: isEdited ? 'draft_edited' : 'draft_approved',
            payload: {
              draftId: draft.id,
              status,
              decidedBy: input.userId,
              ...(isEdited ? { editedBubbles: [...bubbles] } : {}),
            },
          },
          meta,
        );
        await setDraftStatus(tx, draft, status, {
          decidedBy: meta.actor,
          at: meta.at,
          ...(isEdited ? { finalBubbles: bubbles } : {}),
        });
        await tx.jobs.enqueue(
          'conversation.send',
          {
            creatorId: input.creatorId,
            conversationId: conversation.id,
            draftId: draft.id,
            correlationId: input.correlationId,
          },
          { queueName: queueNameFor(conversation.id), maxAttempts: MAX_SEND_ATTEMPTS },
        );
        // A human approved what the brief read about him: it becomes facts, on a queue of its own so the send
        // never waits for it (P3-02).
        if (draft.facts.length > 0) {
          await tx.jobs.enqueue(
            'conversation.record_facts',
            {
              creatorId: input.creatorId,
              conversationId: conversation.id,
              correlationId: input.correlationId,
              source: { kind: 'draft', draftId: draft.id },
            },
            {},
          );
        }
      });
      await afterDecision(input.creatorId, input.correlationId);
    },

    async rejectDraft(input) {
      await uow.inTenant(input.creatorId, async (tx) => {
        const conversation = await lockConversation(tx, input.conversationId);
        const draft = await lockDraftFor(tx, conversation, input.draftId, 'rejected');
        const meta = humanMeta(input);
        await appendEvent(
          tx,
          conversation,
          {
            type: 'draft_rejected',
            payload: {
              draftId: draft.id,
              status: 'rejected',
              decidedBy: input.userId,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
          },
          meta,
        );
        await setDraftStatus(tx, draft, 'rejected', { decidedBy: meta.actor, at: meta.at });
      });
      await afterDecision(input.creatorId, input.correlationId);
    },

    expireDraft(input) {
      return uow.inTenant(input.creatorId, async (tx) => {
        const conversation = await lockConversation(tx, input.conversationId);
        const draft = await lockDraftFor(tx, conversation, input.draftId, 'expired');
        const meta: EventMeta = { actor: 'system', correlationId: input.correlationId, at: clock.now() };
        await appendEvent(
          tx,
          conversation,
          { type: 'draft_expired', payload: { draftId: draft.id, status: 'expired', reason: input.reason } },
          meta,
        );
        await setDraftStatus(tx, draft, 'expired', { decidedBy: null, at: meta.at });
      });
    },

    takeover(input) {
      return uow.inTenant(input.creatorId, async (tx) => {
        const meta = humanMeta(input);
        let conversation = await lockConversation(tx, input.conversationId);
        // Before the state changes: a draft is expired from the state it was written for.
        conversation = await expireOpenDrafts(tx, conversation, TAKEN_OVER, { ...meta, actor: 'system' });
        await appendEvent(
          tx,
          conversation,
          {
            type: 'takeover_started',
            payload: {
              conversationId: conversation.id,
              userId: input.userId,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
          },
          meta,
        );
        await tx.audit.record({
          userId: input.userId,
          action: 'conversation.takeover',
          entityId: conversation.id,
          details: { correlationId: input.correlationId },
        });
      });
    },

    release(input) {
      return uow.inTenant(input.creatorId, async (tx) => {
        const conversation = await lockConversation(tx, input.conversationId);
        const meta = humanMeta(input);
        await appendEvent(
          tx,
          conversation,
          { type: 'takeover_ended', payload: { conversationId: conversation.id, userId: input.userId } },
          meta,
        );
        if (input.note !== undefined) {
          await tx.jobs.enqueue(
            'conversation.record_facts',
            {
              creatorId: input.creatorId,
              conversationId: conversation.id,
              correlationId: input.correlationId,
              source: { kind: 'operator_note', note: input.note, at: meta.at.toISOString() },
            },
            {},
          );
        }
        await tx.audit.record({
          userId: input.userId,
          action: 'conversation.release',
          entityId: conversation.id,
          details: { correlationId: input.correlationId },
        });
      });
    },

    setMode(input) {
      return uow.inTenant(input.creatorId, async (tx) => {
        // The creator's lock first, as every mode change takes it: the lock cannot close in between.
        await tx.switches.lockCreator();
        if (input.mode === 'auto') await requireAutomaticOpen(tx, voice);
        const conversation = await lockConversation(tx, input.conversationId);
        if (conversation.mode === input.mode) return;
        await appendEvent(
          tx,
          conversation,
          { type: 'mode_changed', payload: { userId: input.userId, mode: input.mode } },
          humanMeta(input),
        );
      });
    },

    setAgentMode(input) {
      const stop = input.mode === 'stop';
      const target = input.mode === 'auto' ? 'auto' : 'copilot';
      return uow.inTenant(input.creatorId, async (tx) => {
        // Two clicks in a row apply in the order they took the lock, and the later one stays the latest row.
        if (!(await tx.switches.lockCreator())) throw new CreatorNotFound();
        // Automatique opens behind the server lock of ADR 0019, read under the creator's lock.
        if (input.mode === 'auto') await requireAutomaticOpen(tx, voice);
        const meta = humanMeta(input);
        const switches = await tx.switches.isOn();
        if (switches.creator !== stop) {
          const reason = stop
            ? 'Arrêt depuis le Dashboard'
            : `Reprise en ${target === 'auto' ? 'automatique' : 'copilote'} depuis le Dashboard`;
          await tx.switches.setCreator({ active: stop, reason, setBy: meta.actor });
          await tx.events.publish(
            input.creatorId,
            {
              type: 'kill_switch_toggled',
              payload: { scope: 'creator', scopeId: input.creatorId, active: stop, reason },
            },
            meta,
          );
          await tx.audit.record({
            userId: input.userId,
            action: stop ? 'kill_switch.on' : 'kill_switch.off',
            entity: 'kill_switch',
            entityId: input.creatorId,
            details: { scope: 'creator', correlationId: input.correlationId },
          });
        }
        if (switches.creator && !stop && !switches.global) {
          // A fan who wrote during the stop was left `pending` (respond saw the switch and did nothing): each of
          // them gets an answer now, instead of waiting for the fan to write again (recette R-G2).
          // One after the other, the longest wait first: a long stop does not wake them all at the same second.
          const waiting = await tx.conversations.idsInState('pending');
          for (const [index, id] of waiting.entries()) {
            await tx.jobs.enqueue(
              'conversation.respond',
              { creatorId: input.creatorId, conversationId: id, correlationId: input.correlationId },
              {
                queueName: queueNameFor(id),
                jobKey: jobKeyFor('conversation.respond', id),
                runAt: resumeRunAt(index, meta.at),
              },
            );
          }
        }
        if (!stop) {
          const from = target === 'auto' ? 'copilot' : 'auto';
          for (const id of await tx.conversations.idsInMode(from)) {
            const conversation = await lockConversation(tx, id);
            if (conversation.mode !== from) continue;
            await appendEvent(
              tx,
              conversation,
              { type: 'mode_changed', payload: { userId: input.userId, mode: target } },
              meta,
            );
          }
        }
        return { mode: stop || switches.global ? 'stop' : target, globalStop: switches.global };
      });
    },

    automaticLock(creatorId) {
      return uow.inTenant(creatorId, (tx) => readAutomaticLock(tx, voice));
    },

    async recordBlindTest(input) {
      const ratePerMille = Math.round(input.rate * 10);
      const recorded = await uow.inTenant(input.creatorId, async (tx) => {
        const recordedAt = await tx.automatic.recordBlindTest({
          voice,
          ratePerMille,
          recordedBy: `human:${input.userId}`,
        });
        await tx.audit.record({
          userId: input.userId,
          action: 'blind_test.record',
          entity: 'creator',
          entityId: input.creatorId,
          details: { ...voice, ratePerMille, correlationId: input.correlationId },
        });
        return recordedAt;
      });
      // A failed test closes Automatique at once, like a fall of the live rate.
      await afterDecision(input.creatorId, input.correlationId);
      return {
        ...voice,
        rate: ratePerMille / 10,
        passed: ratePerMille >= BLIND_TEST_TARGET * 10,
        recordedAt: recorded.toISOString(),
        automatic: await uow.inTenant(input.creatorId, (tx) => readAutomaticGate(tx, voice)),
      };
    },

    rebuildProjection(creatorId, conversationId) {
      return uow.inTenant(creatorId, async (tx) => {
        await lockConversation(tx, conversationId);
        const projection = rebuildProjection(await tx.events.list(conversationId));
        await tx.conversations.saveProjection(conversationId, projection);
        return projection;
      });
    },
  };
}
