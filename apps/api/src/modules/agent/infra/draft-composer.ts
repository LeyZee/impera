import type {
  AgentHours,
  AlertTrigger,
  FanFlags,
  HandoffCause,
  MediaDescription,
  MediaFlag,
  ObjectionReplies,
  Result,
} from '@impera/contracts';
import {
  BRAIN_ALERTS_MAX,
  brainAlertId,
  type Brief,
  type ConversationTurn,
  type LlmFailure,
  type LlmGateway,
} from '@impera/llm';

import {
  briefAlerts,
  keywordAlerts,
  noticeOf,
  phraseAlerts,
  settleAlerts,
  type AlertNotice,
  type AlertSettings,
  type FiredAlert,
  type PhraseAlert,
} from '../domain/alerts';
import type { FanAvailabilityRecord } from '../domain/availability';
import { helpBubble, helpLanguageOf } from '../domain/care';
import { measureDesire, type DesireReading } from '../domain/desire';
import { followUpDecision } from '../domain/follow-up';
import {
  holdDecision,
  isCareRisk,
  protectionFor,
  protectionWhileAnswering,
  waitRetryAt,
  type HoldDecision,
} from '../domain/hold';
import { withoutOrders } from '../domain/injection';
import type { PickedObjectionReply } from '../domain/objections';
import type { OfferLimits } from '../domain/policy';
import { safetySigns } from '../domain/safety-net';
import type { PlatformScriptView, ScriptHistoryView, ScriptRun } from '../domain/script-run';
import type { ScriptJournalEvent, ScriptTurn } from '../domain/script-turn';
import type { SexualizationLimits } from '../domain/sexualization';
import { handoffCauseOf } from '../domain/traps';

import {
  composeTurn,
  type ComposedTurn,
  type ComposerPersona,
  type OfferInput,
  type ScriptsInput,
} from './compose';
import type { FanLimits } from './fan-limits';

/**
 * The agent seen by `conversation.respond` (conversations' `DraftComposer` port, matched by shape: `agent` does
 * not import `conversations`). The draft waits for a human: the composer never sends anything.
 */
export interface AgentComposeInput {
  readonly creatorId: string;
  readonly conversationId: string;
  readonly fanId: string;
  readonly draftId: string;
  /** Carried to the events the policy writes (a limit set on a risk). */
  readonly correlationId: string;
  readonly now: Date;
  /** Where the conversation lives on the platform: the connector fetches his media there. */
  readonly platformAccountId?: string;
  readonly platformConversationId?: string;
  readonly history: readonly {
    readonly direction: 'inbound' | 'outbound';
    readonly text: string;
    readonly at: Date;
    /** Its id on the platform: a media link expires, a fresh one is read on the message. */
    readonly platformMessageId?: string;
    /** The media the message carries (photo, video, voice note), as `conversations` read them. */
    readonly media?: readonly HistoryMedia[];
  }[];
  readonly fan: {
    readonly notes: readonly string[];
    /** Read by the brain alone (ADR 0085 § 9): when he has money, his attachment, his moods. */
    readonly brainNotes?: readonly string[];
    readonly spentMinor: number;
    readonly firstMessageAt: Date | null;
  };
  /** His desire score as stored on the conversation (P3-12), and when it was counted; absent, he starts at 0. */
  readonly desire?: { readonly score: number; readonly at: Date };
  /**
   * Her hours (P3-14), as `creators.agent_hours` reads them; absent, the defaults. Whether she answers now is the
   * worker's call; here they set her night and when a follow-up may go out.
   */
  readonly hours?: AgentHours;
  /** How many times she already waited for his last message (P3-11): from 1, she does not wait again. */
  readonly waited?: number;
  /** A follow-up on his silence (P3-10), not an answer to a message of his. */
  readonly followUp?: {
    /** The index of her delay, from 0. */
    readonly step: number;
    readonly steps: number;
    /** His last message: the silence it follows up on. */
    readonly silentSince: Date;
  };
  /** A custom order of his already waits for the team (ADR 0090 § A): she does not open another. */
  readonly customOrderOpen?: boolean;
  /** The replies of her objection bank he already received (ADR 0090 § B): never twice. */
  readonly usedObjectionReplies?: readonly string[];
  /** His latest script run, open or ended (ADR 0098); `null` when he never had one. */
  readonly scriptRun?: ScriptRun | null;
  /** His availability as the conversation keeps it (ADR 0103, amendement du 13/11); `null` before the first. */
  readonly fanAvailability?: FanAvailabilityRecord | null;
  /**
   * The care mode open on this conversation (ADR 0088), as `conversations` stores it: she answers him with care
   * whatever he writes, until a manager or the owner closes it. `helpGiven`: the help bubble already went out in it.
   */
  readonly care?: { readonly since: Date; readonly helpGiven: boolean };
}

/** A run that changed at this message, with its journal (ADR 0098 § 2). */
interface ScriptRunChange {
  readonly run: ScriptRun;
  readonly events: readonly ScriptJournalEvent[];
}

interface HistoryMedia {
  readonly kind: string;
  readonly platformMediaId?: string;
  /** Behind a price: nobody can open it to look. */
  readonly isLocked?: boolean;
}

/** One media of his to look at: what the platform calls it, in the message and conversation it came in. */
export interface MediaToSee {
  readonly creatorId: string;
  readonly conversationId: string;
  readonly platformAccountId: string;
  readonly platformConversationId: string;
  readonly platformMessageId: string;
  readonly platformMediaId: string;
  readonly kind: 'image' | 'video';
}

/** The vision seen by the composer: the file fetched from the platform, then described (`media` module). */
export interface MediaSight {
  see(media: MediaToSee): Promise<Result<MediaDescription, string>>;
}

/** His desire score after his message, only when it changed (P3-12): `conversations` journals and projects it. */
type ScoredDesire = Pick<DesireReading, 'before' | 'score' | 'signals' | 'weightsVersion'>;

type AgentComposeResult = (
  | {
      readonly kind: 'draft';
      readonly bubbles: readonly string[];
      readonly softViolations: readonly string[];
      readonly costUsd: number;
      /** Absent when no model is known: no voice is better than a false one on the live rate (ADR 0019). */
      readonly voice?: { readonly voicePrompt: string; readonly voiceModel: string };
      /**
       * The persona version it was written with, read with her persona for this draft: a version activated while it
       * was written never takes its place (ADR 0019, the live rate and the lock of Automatique per version).
       */
      readonly personaVersionId?: string;
      /** What the brief read about the fan; `conversations` keeps the categories it knows (P3-02). */
      readonly factsProposed: readonly {
        readonly category: string;
        readonly key: string;
        readonly value: string;
        readonly kind: 'declared' | 'inferred';
        readonly confidence: number;
      }[];
    }
  | {
      readonly kind: 'held';
      readonly reason: 'guard_blocked' | 'handoff' | 'budget_reached' | 'llm_unavailable' | 'no_reply';
      /** Why a human must answer, when the vision knows it: the alert ranks on it. */
      readonly cause?: HandoffCause;
      /** The alert that paused the agent (P4-01), journaled on the handoff: never also a notice. */
      readonly trigger?: AlertTrigger;
      readonly detail: readonly string[];
      readonly costUsd: number;
      /**
       * A follow-up put off (her quiet hours), or his message she waits on (« attends, je reviens »): the same is due
       * again at that time.
       */
      readonly retryAt?: Date;
    }
) & {
  readonly desire?: ScoredDesire;
  /** His availability after this message, only when it changed (`fan_availability_changed`, ADR 0103). */
  readonly fanAvailability?: FanAvailabilityRecord;
  /**
   * The care mode (ADR 0088), on a draft or a hold: the signs that opened or kept it, and whether this draft closes on
   * the help bubble. A care hold means the AI could not answer him: a human writes to him.
   */
  readonly care?: { readonly signs: readonly string[]; readonly help: boolean };
  /** Her alerts that went off on his message and only let a human know (`alert_triggered` each, P4-01). */
  readonly alerts?: readonly AlertNotice[];
  /** He asked for a custom order and it now waits for the team (`custom_order_opened`, ADR 0090 § A). */
  readonly customOrderOpened?: true;
  /** The reply of her objection bank given to the voice (`objection_reply_used`, ADR 0090 § B). */
  readonly objectionReply?: Pick<PickedObjectionReply, 'objection' | 'replyId'>;
  /**
   * His script runs after this message (ADR 0098): the stored run moved, a run opened, a paid step offered. Without a
   * draft, only what his message and Reveal changed: a step not written was not sent.
   */
  readonly scriptRun?: {
    readonly moved?: ScriptRunChange;
    readonly opened?: ScriptRunChange;
    readonly offer?: { readonly amountMinor: number; readonly currency: 'EUR' };
  };
};

export interface AgentDraftComposer {
  compose(input: AgentComposeInput): Promise<AgentComposeResult>;
}

/** What her persona gives the composer: who she is for the models, and the limits code applies (CLAUDE.md rule 3). */
export interface ComposerPersonaFields {
  readonly persona: ComposerPersona;
  readonly followUpSpirit: string | null;
  readonly offerLimits: OfferLimits;
  readonly sexualizationLimits: SexualizationLimits;
  readonly alertKeywords: readonly string[];
  /** Her replies to a price objection (ADR 0090 § B); absent, the voice answers alone. */
  readonly objectionReplies?: ObjectionReplies;
  /** The version these fields were read from: the draft carries it, never the one active when it is saved. */
  readonly personaVersionId?: string;
}

export interface DraftComposerDeps {
  readonly gateway: LlmGateway;
  /**
   * A fixed persona, with the fields below, when nothing reads hers per creator (`personaOf`): tests and the terminal.
   * Absent beside `personaOf`: a composer that reads hers has no other persona to fall back on.
   */
  readonly persona?: ComposerPersona;
  /**
   * Her active persona version for this draft (ADR 0010, 0022), read at each message: it replaces `persona` and the
   * fields her persona gives. `null` (she has none) or a failed read: nothing is written, a human answers him.
   */
  readonly personaOf?: (creatorId: string, now: Date) => Promise<ComposerPersonaFields | null>;
  /** Set from `personaOf`: the persona version this draft was written with. */
  readonly personaVersionId?: string;
  /** The spirit of her follow-ups (`PersonaForModels.followUps.spirit`), for the voice. */
  readonly followUpSpirit?: string | null;
  /** Her clock (day and night, the time she answers at), from the creator of the conversation. */
  readonly timeZoneOf: (creatorId: string) => Promise<string>;
  /** Version of the voice prompt, written on each draft with the model that answered (ADR 0019). */
  readonly voicePrompt: string;
  /** Without it, any media of his goes to a human: nothing is answered unseen. */
  readonly sight?: MediaSight;
  /** His limits: read before anything is written, set on a detected risk (P3-02). */
  readonly limits?: FanLimits;
  /** When she goes sexual (`PersonaForModels.sexualizationLimits`): without it, she never does. */
  readonly sexualizationLimits?: SexualizationLimits;
  /** Her pace of scripts (`PersonaForModels.offerLimits`): without it, or without his limits, she offers nothing. */
  readonly offerLimits?: OfferLimits;
  /**
   * When a script was last offered to him, bought or not: Reveal's script history (ADR 0018, P6-01). Without it
   * the cooldown cannot be read, so she offers nothing.
   */
  readonly lastOfferAt?: (creatorId: string, fanId: string) => Promise<Date | null>;
  /** A limit the policy could not save without holding the draft (his declared age): counted, never silent. */
  readonly onLimitsNotSaved?: (event: {
    readonly conversationId: string;
    readonly limit: 'ageConfirmedAt';
  }) => void;
  /**
   * Her alert keywords (`PersonaForModels.alertKeywords`): one in what he wrote since her last answer pauses the agent
   * for him, before any model is called (P4-01). Without them, nothing is watched.
   */
  readonly alertKeywords?: readonly string[];
  /** Her replies to a price objection (`ComposerPersonaFields.objectionReplies`). */
  readonly objectionReplies?: ObjectionReplies;
  /**
   * Her own alerts that are on and the system's that are on for her (P4-01). Without it, only her persona's words are
   * watched; unreadable, a human answers him, as with his limits.
   */
  readonly alertsOf?: (creatorId: string) => Promise<AlertSettings>;
  /**
   * Whether a chatter is on shift on her accounts now: a doubt on who she is (P4-01) and a custom order (ADR 0090)
   * go to them. Unknown: no.
   */
  readonly chatterOnShift?: (creatorId: string, at: Date) => Promise<boolean>;
  /** Lines of her notes kept out of the prompt for looking like an order: counted, never their text. */
  readonly onDroppedNotes?: (event: { readonly conversationId: string; readonly count: number }) => void;
  /**
   * Her scripts on the platform (ADR 0098, ADR 0018 § 5): her catalogue and Reveal's history of his. Without it, or
   * with his history unreadable, no script moves and nothing is sold (fail closed); a brain's « offer » is written
   * as a plain answer.
   */
  readonly scripts?: ScriptSource;
}

/**
 * The connector's reads a script decision needs, as minimal views until the contract carries them (P2-02:
 * `listPlatformScripts`, `getScriptHistory`). A failed read throws: the composer decides.
 */
export interface ScriptSource {
  catalogue(creatorId: string, platformAccountId: string): Promise<readonly PlatformScriptView[]>;
  history(
    creatorId: string,
    platformAccountId: string,
    platformConversationId: string,
  ): Promise<ScriptHistoryView>;
}

/** Her scripts for this message: what the source reads, and nothing readable when it cannot (fail closed). */
async function scriptsInput(deps: DraftComposerDeps, input: AgentComposeInput): Promise<ScriptsInput> {
  const { platformAccountId, platformConversationId } = input;
  const closed: ScriptsInput = {
    conversationRef: platformConversationId ?? input.conversationId,
    catalogue: [],
    history: null,
    latest: input.scriptRun ?? null,
    countsHisMessage: (input.waited ?? 0) === 0,
  };
  if (deps.scripts === undefined || platformAccountId === undefined || platformConversationId === undefined)
    return closed;
  try {
    const [catalogue, history] = await Promise.all([
      deps.scripts.catalogue(input.creatorId, platformAccountId),
      deps.scripts.history(input.creatorId, platformAccountId, platformConversationId),
    ]);
    return { ...closed, catalogue, history };
  } catch {
    return closed;
  }
}

/** The price alert of a step that did not go (ADR 0098 § 5): the team is told, the agent goes on. */
const SCRIPT_PRICE: AlertNotice = {
  trigger: { alert: { kind: 'system', code: 'script_price' }, matchedBy: 'rule' },
  notify: true,
};

/** A result with what this message did to his script runs: the step decided goes only with a draft. */
function withScripts(
  result: AgentComposeResult,
  turn: ScriptTurn | undefined,
  settings: AlertSettings,
): AgentComposeResult {
  if (turn === undefined) return result;
  const alerts =
    turn.priceMismatch !== null && settings.systemOn.has('script_price')
      ? [...(result.alerts ?? []), SCRIPT_PRICE]
      : result.alerts;
  const base = alerts === undefined ? result : { ...result, alerts };
  if (result.kind !== 'draft') {
    return turn.followed === null ? base : { ...base, scriptRun: { moved: turn.followed } };
  }
  const { decision } = turn;
  const price =
    (decision.kind === 'start' || decision.kind === 'send_step') && decision.step.priceMinor !== null
      ? decision.step.priceMinor
      : null;
  // Reveal sells in euros: the catalogue's minor units are cents.
  const offer: NonNullable<AgentComposeResult['scriptRun']>['offer'] =
    price === null ? undefined : { amountMinor: price, currency: 'EUR' };
  const scriptRun = {
    ...(turn.moved !== null && { moved: turn.moved }),
    ...(turn.opened !== null && { opened: turn.opened }),
    ...(offer !== undefined && { offer }),
  };
  return Object.keys(scriptRun).length === 0 ? base : { ...base, scriptRun };
}

const failureDetail = (error: LlmFailure): readonly string[] =>
  error.attempts.map((a) => `${a.model}: ${a.outcome}`);

const UNSEEN = (detail: readonly string[] = []): AgentComposeResult => ({
  kind: 'held',
  reason: 'handoff',
  detail: ['media_unscreened', ...detail],
  costUsd: 0,
});

/**
 * Every media he sent since her last answer, described before anything is written (minor, consent, weapon:
 * vision obligatoire). A media nobody can see (no vision wired, locked, a voice note, a message with nothing in
 * it, a failed or uncertain description) goes to a human: nothing is answered on a caption alone (revue 09, B2).
 * Looked at before the voice key is checked: a possible minor ranks as such even when no voice could answer.
 */
async function seeHisMedia(
  sight: MediaSight | undefined,
  input: AgentComposeInput,
  sinceAnswer: AgentComposeInput['history'],
): Promise<
  { readonly unseen: AgentComposeResult } | { readonly seen: readonly (readonly MediaDescription[])[] }
> {
  if (sinceAnswer.some((m) => m.text.trim() === '' && (m.media?.length ?? 0) === 0))
    return { unseen: UNSEEN() };
  if (sinceAnswer.every((m) => (m.media?.length ?? 0) === 0)) return { seen: sinceAnswer.map(() => []) };
  if (sight === undefined) return { unseen: UNSEEN() };
  const { platformAccountId, platformConversationId } = input;
  if (platformAccountId === undefined || platformConversationId === undefined) {
    return { unseen: UNSEEN(['no_platform_ref']) };
  }
  const seen: MediaDescription[][] = [];
  for (const message of sinceAnswer) {
    const toSee: MediaToSee[] = [];
    const { platformMessageId } = message;
    for (const m of message.media ?? []) {
      if (m.isLocked === true) return { unseen: UNSEEN(['locked']) };
      if (m.kind !== 'image' && m.kind !== 'video') return { unseen: UNSEEN([m.kind]) };
      if (m.platformMediaId === undefined || platformMessageId === undefined) {
        return { unseen: UNSEEN(['no_platform_ref']) };
      }
      toSee.push({
        creatorId: input.creatorId,
        conversationId: input.conversationId,
        platformAccountId,
        platformConversationId,
        platformMessageId,
        platformMediaId: m.platformMediaId,
        kind: m.kind,
      });
    }
    const described: MediaDescription[] = [];
    for (const result of await Promise.all(toSee.map((m) => sight.see(m)))) {
      if (!result.ok) return { unseen: UNSEEN([result.error]) };
      // Described but not seen (black, blurred, cut) or seen without certainty: a minor could hide there.
      if (result.value.notVisible) return { unseen: UNSEEN(['not_visible']) };
      if (result.value.confidenceLow) return { unseen: UNSEEN(['confidence_low']) };
      described.push(result.value);
    }
    seen.push(described);
  }
  return { seen };
}

/** No voice model with a key, main or fallback: no call is worth making. */
function voiceUnavailable(gateway: LlmGateway): boolean {
  const voice = gateway.health().roles.find((r) => r.role === 'voice');
  return voice === undefined || (!voice.hasKey && voice.fallback?.hasKey !== true);
}

type Held = Extract<AgentComposeResult, { kind: 'held' }>;

const HANDOFF: Held = { kind: 'held', reason: 'handoff', detail: [], costUsd: 0 };

/**
 * The AI could not answer him with care (a refusal, a failure, no budget, a guard): never silence, a human writes to
 * him (ADR 0088 § 5 bis), the care mode stays open.
 */
const careUnanswered = (signs: readonly string[], detail: readonly string[], costUsd: number) => ({
  ...HANDOFF,
  cause: 'distress' as const,
  detail: ['care_unanswered', ...detail],
  costUsd,
  care: { signs, help: false },
});

/**
 * A handoff on a risk also sets his limits until a human decides (P3-02): a possible minor is no longer
 * age-confirmed, distress or a threat stops everything written to him. The handoff goes out even when the limits
 * could not be saved: the chatter sees it in the detail.
 */
async function protect(
  limits: FanLimits | undefined,
  input: AgentComposeInput,
  signs: readonly string[],
  held: Held,
) {
  const protection = protectionFor(signs);
  if (limits === undefined || protection.because.length === 0) return held;
  try {
    await limits.protect(input.creatorId, input.fanId, protection, input.correlationId, input.now);
    return held;
  } catch {
    return { ...held, detail: [...held.detail, 'limits_not_saved'] };
  }
}

/**
 * Nothing is written to a fan a human stopped, or the policy did: a new message of his goes to a chatter.
 * Otherwise his limits, when there are any to read, for the offer.
 */
async function stopped(
  limits: FanLimits | undefined,
  input: AgentComposeInput,
): Promise<{ readonly held: Held } | { readonly flags: FanFlags | undefined }> {
  if (limits === undefined) return { flags: undefined };
  try {
    const flags = await limits.flags(input.creatorId, input.fanId);
    return flags.doNotContact === true ? { held: { ...HANDOFF, detail: ['do_not_contact'] } } : { flags };
  } catch {
    // His limits unknown, nothing is written: a chatter answers.
    return { held: { ...HANDOFF, detail: ['limits_unreadable'] } };
  }
}

/** What the policy needs to let her offer; any of it unknown, there is no offer to decide on (fail closed). */
async function offerInput(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
  flags: FanFlags | undefined,
): Promise<OfferInput | undefined> {
  if (flags === undefined || deps.offerLimits === undefined || deps.lastOfferAt === undefined)
    return undefined;
  try {
    const lastOfferAt = await deps.lastOfferAt(input.creatorId, input.fanId);
    return { now: input.now, lastOfferAt, hasNoBudget: false, flags, limits: deps.offerLimits };
  } catch {
    return undefined;
  }
}

async function keepWhileAnswering(
  limits: FanLimits | undefined,
  input: AgentComposeInput,
  risks: readonly string[],
): Promise<Held | null> {
  const protection = protectionWhileAnswering(risks);
  if (limits === undefined || protection.because.length === 0) return null;
  try {
    await limits.protect(input.creatorId, input.fanId, protection, input.correlationId, input.now);
    return null;
  } catch {
    return { ...HANDOFF, detail: [...protection.because, 'limits_not_saved'] };
  }
}

/**
 * Her persona for this message: her active version when the composer reads it per creator, the fixed one
 * otherwise. Without an active version, or unreadable, the code says which (`persona_inactive`,
 * `persona_unreadable`): never another persona, never the demo one.
 */
async function herPersona(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
): Promise<
  | { readonly deps: DraftComposerDeps & { readonly persona: ComposerPersona } }
  | { readonly missing: 'persona_inactive' | 'persona_unreadable' }
> {
  if (deps.personaOf === undefined) {
    return deps.persona === undefined
      ? { missing: 'persona_inactive' }
      : { deps: { ...deps, persona: deps.persona } };
  }
  try {
    const fields = await deps.personaOf(input.creatorId, input.now);
    return fields === null ? { missing: 'persona_inactive' } : { deps: { ...deps, ...fields } };
  } catch {
    return { missing: 'persona_unreadable' };
  }
}

const NOT_FOLLOWED_UP = (detail: string, costUsd = 0): Held => ({
  kind: 'held',
  reason: 'no_reply',
  detail: [detail],
  costUsd,
});

/**
 * A follow-up on his silence (P3-10): his limits read first, then `followUpDecision`, then the voice and every
 * guard. A silent fan is no emergency: whatever stops it (limits unknown, no model, no budget) writes nothing and
 * alerts nobody; only a blocking guard hands it to a human, as for an answer.
 */
async function followUp(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
  asked: NonNullable<AgentComposeInput['followUp']>,
): Promise<AgentComposeResult> {
  // His limits unknown, nothing is written to him: never a message to a fan who may have been stopped.
  if (deps.limits === undefined) return NOT_FOLLOWED_UP('follow_up_limits_unknown');
  let flags: FanFlags;
  try {
    flags = await deps.limits.flags(input.creatorId, input.fanId);
  } catch {
    return NOT_FOLLOWED_UP('follow_up_limits_unreadable');
  }
  const timeZone = await deps.timeZoneOf(input.creatorId);
  const decision = followUpDecision({
    step: asked.step,
    steps: asked.steps,
    flags,
    now: input.now,
    timeZone,
    ...(input.hours !== undefined && { hours: input.hours }),
  });
  if (decision.kind === 'skip') return NOT_FOLLOWED_UP(decision.reason);
  if (decision.kind === 'later') return { ...NOT_FOLLOWED_UP(decision.reason), retryAt: decision.at };
  // Without her active persona, nothing is written to a silent fan: no alert either, he is no emergency.
  const her = await herPersona(deps, input);
  if ('missing' in her) return NOT_FOLLOWED_UP(`follow_up_${her.missing}`);
  if (voiceUnavailable(deps.gateway)) return NOT_FOLLOWED_UP('follow_up_no_voice');
  const composed = await composeTurn(deps.gateway, her.deps.persona, {
    history: input.history.map((m) => ({
      from: m.direction === 'inbound' ? 'fan' : 'creator',
      text: m.text,
    })),
    fanText: '',
    media: [],
    fanNotes: input.fan.notes.join('\n'),
    situation: {
      now: input.now,
      timeZone,
      relationshipStartedAt: input.fan.firstMessageAt ?? input.now,
      spentCents: input.fan.spentMinor,
      ...(input.hours !== undefined && { night: input.hours.night }),
    },
    trace: { creatorId: input.creatorId, conversationId: input.conversationId, draftId: input.draftId },
    followUp: {
      silentHours: (input.now.getTime() - asked.silentSince.getTime()) / 3_600_000,
      spirit: her.deps.followUpSpirit ?? null,
    },
  });
  const { costUsd } = composed;
  if (composed.droppedNotes !== undefined) {
    deps.onDroppedNotes?.({ conversationId: input.conversationId, count: composed.droppedNotes.length });
  }
  if (composed.voiceFailure !== undefined) {
    const reason = composed.voiceFailure.code === 'budget_reached' ? 'budget_reached' : 'llm_unavailable';
    return { kind: 'held', reason, detail: failureDetail(composed.voiceFailure), costUsd };
  }
  const blocking = composed.violations.filter((v) => v.severity === 'blocking');
  if (blocking.length > 0) {
    return { kind: 'held', reason: 'guard_blocked', detail: blocking.map((v) => v.code), costUsd };
  }
  return {
    kind: 'draft',
    bubbles: composed.bubbles,
    softViolations: composed.violations.map((v) => v.code),
    costUsd,
    factsProposed: [],
    ...(composed.model !== undefined && {
      voice: { voicePrompt: deps.voicePrompt, voiceModel: composed.model },
    }),
    ...(her.deps.personaVersionId !== undefined && { personaVersionId: her.deps.personaVersionId }),
  };
}

/** Her alerts for this message; unreadable, nothing is written and a human answers him (fail closed). */
async function alertSettings(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
): Promise<{ readonly held: Held } | { readonly settings: AlertSettings }> {
  if (deps.alertsOf === undefined) return { settings: { custom: [], systemOn: new Set() } };
  try {
    return { settings: await deps.alertsOf(input.creatorId) };
  } catch {
    return { held: { ...HANDOFF, detail: ['alerts_unreadable'] } };
  }
}

/** Whether a chatter is on shift: a doubt on who she is and a custom order go to them. Unknown: no. */
async function onShift(deps: DraftComposerDeps, input: AgentComposeInput) {
  if (deps.chatterOnShift === undefined) return false;
  return deps.chatterOnShift(input.creatorId, input.now).catch(() => false);
}

/** The alerts of his message read from the brief, beside those read in code. */
const firedWith = (
  coded: readonly FiredAlert[],
  brief: Pick<Brief, 'intent' | 'alertsSeen'> | undefined,
  asked: readonly PhraseAlert[],
  settings: AlertSettings,
  chatter: boolean,
): FiredAlert[] =>
  brief === undefined ? [...coded] : [...coded, ...briefAlerts(brief, asked, settings.systemOn, chatter)];

/**
 * A result with what ADR 0090 journals: a custom order that now waits for the team (taken by a chatter, or answered
 * without a commitment), and the objection reply given to a draft that goes to a human for approval.
 */
function withSales(result: AgentComposeResult, composed: ComposedTurn): AgentComposeResult {
  const order = composed.customOrder;
  const opened =
    (order?.kind === 'handoff' && result.kind === 'held' && result.cause === 'custom_order') ||
    (order?.kind === 'reply' && order.opens);
  const reply = composed.objectionReply;
  return {
    ...result,
    ...(opened && { customOrderOpened: true }),
    ...(reply !== undefined &&
      result.kind === 'draft' && { objectionReply: { objection: reply.objection, replyId: reply.replyId } }),
  };
}

/** A result with the notices of her alerts that went off, when there are any. */
const withNotices = (result: AgentComposeResult, notices: readonly AlertNotice[]): AgentComposeResult =>
  notices.length === 0 ? result : { ...result, alerts: notices };

/** What code already knows of the care mode before any model: an episode open, or his words (ADR 0088). */
interface CareKnown {
  /** The signs code read, or `care_open` for an episode already open; empty, only the brain can open it. */
  readonly signs: readonly string[];
  readonly helpGiven: boolean;
}

/**
 * A care answer (ADR 0088): his limits of the care mode set, then the voice's answer as a draft a human validates,
 * closed on the help bubble the first time he speaks of dark thoughts in the episode. Anything that kept the voice
 * from answering hands him to a human, never silence.
 */
async function settleCare(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
  composed: ComposedTurn,
  known: CareKnown,
): Promise<AgentComposeResult> {
  const { costUsd } = composed;
  const signs = [...new Set([...known.signs, ...(composed.brief?.risks.filter(isCareRisk) ?? [])])];
  // His money trouble is kept too: `protectionWhileAnswering` keeps what she keeps while answering.
  const kept = await keepWhileAnswering(deps.limits, input, [...signs, ...(composed.brief?.risks ?? [])]);
  if (kept !== null) return careUnanswered(signs, kept.detail, costUsd);
  if (composed.voiceFailure !== undefined)
    return careUnanswered(signs, failureDetail(composed.voiceFailure), costUsd);
  const blocking = composed.violations.filter((v) => v.severity === 'blocking');
  if (blocking.length > 0)
    return careUnanswered(signs, ['guard_blocked', ...blocking.map((v) => v.code)], costUsd);
  if (composed.bubbles.length === 0) return careUnanswered(signs, ['no_voice'], costUsd);
  const help = signs.includes('self_harm') && !known.helpGiven;
  const fanText = input.history
    .slice(input.history.findLastIndex((m) => m.direction === 'outbound') + 1)
    .map((m) => m.text)
    .join('\n');
  return {
    kind: 'draft',
    bubbles: help ? [...composed.bubbles, helpBubble(helpLanguageOf(fanText))] : composed.bubbles,
    softViolations: composed.violations.map((v) => v.code),
    costUsd,
    factsProposed: composed.brief === undefined ? [] : withoutOrders(composed.brief.factsProposed),
    ...(composed.model !== undefined && {
      voice: { voicePrompt: deps.voicePrompt, voiceModel: composed.model },
    }),
    ...(deps.personaVersionId !== undefined && { personaVersionId: deps.personaVersionId }),
    care: { signs, help },
  };
}

/** What his composed answer becomes: a draft, or held for a human, a wait or a failure. */
async function settle(
  deps: DraftComposerDeps,
  input: AgentComposeInput,
  composed: ComposedTurn,
  flags: FanFlags | undefined,
  waited: boolean,
  alertPause: ReturnType<typeof settleAlerts>['pause'],
  known: CareKnown,
): Promise<AgentComposeResult> {
  const { costUsd } = composed;
  if (composed.droppedNotes !== undefined) {
    deps.onDroppedNotes?.({ conversationId: input.conversationId, count: composed.droppedNotes.length });
  }
  if (composed.handoff !== undefined) {
    return protect(deps.limits, input, composed.handoff, {
      ...HANDOFF,
      detail: composed.handoff,
      costUsd,
    });
  }
  // Code already knew, or the brain read distress: she answers him with care, unless a handoff risk outranks it.
  const decision0 = composed.brief === undefined ? undefined : holdDecision(composed.brief, waited);
  if (composed.care === true && decision0?.kind !== 'handoff' && alertPause === null)
    return settleCare(deps, input, composed, known);
  if (composed.brief === undefined) {
    const failure = composed.briefFailure;
    const reason = failure?.code === 'budget_reached' ? 'budget_reached' : 'llm_unavailable';
    return { kind: 'held', reason, detail: failure === undefined ? [] : failureDetail(failure), costUsd };
  }
  const decision: HoldDecision = decision0 ?? holdDecision(composed.brief, waited);
  if (decision.kind === 'handoff') {
    const held: Held = { ...HANDOFF, detail: decision.detail, costUsd };
    return protect(deps.limits, input, composed.brief.risks, held);
  }
  // One of her alerts pauses the agent (P4-01): a human answers him, the voice did not write.
  if (alertPause !== null)
    return {
      ...HANDOFF,
      cause: alertPause.cause,
      trigger: alertPause.trigger,
      detail: [alertPause.cause],
      costUsd,
    };
  // A custom order with a chatter on shift (ADR 0090 § A): they take it, the voice did not write.
  if (composed.customOrder?.kind === 'handoff')
    return { ...HANDOFF, cause: 'custom_order', detail: ['custom_order'], costUsd };
  // He stated an adult age himself: confirmed for his next messages (Charles, 27/10), never once his age was
  // taken back. Not saved, his age stays unconfirmed and she keeps steering back, the safe side: counted.
  const his = flags;
  if (
    composed.ageDeclared !== undefined &&
    his !== undefined &&
    his.ageConfirmedAt === undefined &&
    his.ageDisputed === undefined
  ) {
    await deps.limits?.confirmAge(input.creatorId, input.fanId, input.correlationId, input.now).catch(() => {
      deps.onLimitsNotSaved?.({ conversationId: input.conversationId, limit: 'ageConfirmedAt' });
    });
  }
  // He said he cannot pay: whatever is written now, the policy remembers it for his next messages. Not
  // saved, a chatter answers: the next message would forget it.
  const kept = await keepWhileAnswering(deps.limits, input, composed.brief.risks);
  if (kept !== null) return { ...kept, costUsd };
  // He asked her to wait: she is asked again a little later, and then asks whether he is back (P3-11).
  if (decision.kind === 'no_reply')
    return {
      kind: 'held',
      reason: 'no_reply',
      detail: decision.detail,
      costUsd,
      retryAt: waitRetryAt(input.now),
    };
  if (composed.voiceFailure !== undefined) {
    const reason = composed.voiceFailure.code === 'budget_reached' ? 'budget_reached' : 'llm_unavailable';
    return { kind: 'held', reason, detail: failureDetail(composed.voiceFailure), costUsd };
  }
  const blocking = composed.violations.filter((v) => v.severity === 'blocking');
  if (blocking.length > 0) {
    return { kind: 'held', reason: 'guard_blocked', detail: blocking.map((v) => v.code), costUsd };
  }
  return {
    kind: 'draft',
    bubbles: composed.bubbles,
    softViolations: composed.violations.map((v) => v.code),
    costUsd,
    factsProposed: withoutOrders(composed.brief.factsProposed),
    ...(composed.model !== undefined && {
      voice: { voicePrompt: deps.voicePrompt, voiceModel: composed.model },
    }),
    ...(deps.personaVersionId !== undefined && { personaVersionId: deps.personaVersionId }),
  };
}

export function createDraftComposer(deps: DraftComposerDeps): AgentDraftComposer {
  return {
    async compose(input) {
      if (input.followUp !== undefined) return followUp(deps, input, input.followUp);
      const stop = await stopped(deps.limits, input);
      if ('held' in stop) return stop.held;
      const lastAnswer = input.history.findLastIndex((m) => m.direction === 'outbound');
      const sinceAnswer = input.history.slice(lastAnswer + 1);
      const lastFanAt = sinceAnswer.at(-1)?.at;
      const looked = await seeHisMedia(deps.sight, input, sinceAnswer);
      if ('unseen' in looked) return looked.unseen;
      const media = looked.seen.flat();
      const flags = media.flatMap((d): MediaFlag[] => d.flags);
      if (flags.length > 0) {
        const held: Held = { ...HANDOFF, cause: handoffCauseOf(flags), detail: flags };
        return protect(deps.limits, input, flags, held);
      }
      // What he wrote since her last answer: her alerts, the traps and the safety net read it as one message.
      const fanText = sinceAnswer.map((m) => m.text).join('\n');
      // He says plainly he is a minor (recette AGT-01): a human answers him before any model, whatever the brain would
      // have read, and his limits are set until a human decides. He says he wants to hurt himself: she answers him
      // with care, a human validating it (ADR 0088), as she does while a care episode is open.
      const signs = safetySigns(fanText);
      if (signs.includes('minor_suspected')) {
        const held: Held = { ...HANDOFF, cause: 'minor', detail: ['safety_net', ...signs] };
        return protect(deps.limits, input, signs, held);
      }
      const known: CareKnown = {
        signs: [...signs, ...(input.care !== undefined ? ['care_open'] : [])],
        helpGiven: input.care?.helpGiven === true,
      };
      const careForced = known.signs.length > 0;
      // Her active persona, after what safety reads without it (his limits, his media, his words): none, a human
      // answers him.
      const her = await herPersona(deps, input);
      if ('missing' in her) {
        if (careForced) return careUnanswered(known.signs, [her.missing], 0);
        return { ...HANDOFF, cause: 'persona_inactive', detail: [her.missing] };
      }
      const withHer = her.deps;
      const read = await alertSettings(deps, input);
      if ('held' in read) return read.held;
      const { settings } = read;
      // Her words, in code and at no cost (P4-01): one that pauses hands him over before any model. The journal names
      // the word she declared, never his.
      const coded = keywordAlerts(fanText, withHer.alertKeywords ?? [], settings);
      const early = settleAlerts(coded);
      if (early.pause !== null)
        return withNotices(
          { ...HANDOFF, cause: early.pause.cause, trigger: early.pause.trigger, detail: ['alert_keyword'] },
          early.notices,
        );
      const asked = phraseAlerts(settings, coded, brainAlertId, BRAIN_ALERTS_MAX);
      const chatter = await onShift(deps, input);
      if (voiceUnavailable(deps.gateway)) {
        if (careForced) return careUnanswered(known.signs, ['no voice key'], 0);
        return { kind: 'held', reason: 'llm_unavailable', detail: ['no voice key'], costUsd: 0 };
      }
      const history: ConversationTurn[] = input.history.map((m, i) => {
        const described = i > lastAnswer ? (looked.seen[i - lastAnswer - 1] ?? []) : [];
        return {
          from: m.direction === 'inbound' ? 'fan' : 'creator',
          text: m.text,
          ...(described.length > 0 && { media: described.map((description) => ({ description })) }),
        };
      });
      const offer = await offerInput(withHer, input, stop.flags);
      const scripts = await scriptsInput(deps, input);
      const waited = (input.waited ?? 0) >= 1;
      const composed = await composeTurn(deps.gateway, withHer.persona, {
        history,
        fanText,
        media,
        fanNotes: input.fan.notes.join('\n'),
        ...(input.fan.brainNotes !== undefined &&
          input.fan.brainNotes.length > 0 && { brainNotes: input.fan.brainNotes.join('\n') }),
        ...(offer !== undefined && { offer }),
        ...(withHer.sexualizationLimits !== undefined && {
          sexualization: {
            limits: withHer.sexualizationLimits,
            ageConfirmed: stop.flags?.ageConfirmedAt !== undefined,
            noExplicit: stop.flags?.noExplicit === true,
          },
        }),
        situation: {
          now: input.now,
          timeZone: await deps.timeZoneOf(input.creatorId),
          relationshipStartedAt: input.fan.firstMessageAt ?? input.now,
          spentCents: input.fan.spentMinor,
          ...(input.hours !== undefined && { night: input.hours.night }),
        },
        trace: { creatorId: input.creatorId, conversationId: input.conversationId, draftId: input.draftId },
        ...(waited && { waited }),
        desire: {
          ...(input.desire !== undefined && { previous: input.desire }),
          measured: measureDesire(
            input.history.map((m) => ({ fromFan: m.direction === 'inbound', text: m.text, at: m.at })),
          ),
          ageDisputed: stop.flags?.ageDisputed !== undefined,
          // Counted once per message of his: a second pass after a wait, or a replay, reads it as stored.
          counted: input.desire !== undefined && lastFanAt !== undefined && input.desire.at >= lastFanAt,
        },
        // Safety first: a possible minor hands over even when he is testing her, and without the brain's reading of
        // the risks nobody knows, so the voice does not write either, unless code already knows he needs care.
        // An alert of hers that pauses the agent stops the voice too: a human answers him.
        care: (brief) => careForced || (brief !== undefined && holdDecision(brief, waited).kind === 'care'),
        skipVoice: (brief) => {
          if (brief === undefined) return !careForced;
          const kind = holdDecision(brief, waited).kind;
          if (kind === 'handoff') return true;
          if (kind === 'no_reply' && !careForced) return true;
          return settleAlerts(firedWith(coded, brief, asked, settings, chatter)).pause !== null;
        },
        ...(asked.length > 0 && { alerts: asked.map((a) => ({ id: a.brainId, phrase: a.alert.phrase })) }),
        customOrder: {
          chatterOnShift: chatter,
          orderOpen: input.customOrderOpen === true,
          flags: stop.flags,
        },
        ...(withHer.objectionReplies !== undefined && {
          objections: {
            bank: withHer.objectionReplies,
            usedReplyIds: new Set(input.usedObjectionReplies ?? []),
          },
        }),
        scripts,
        ...(input.fanAvailability !== undefined && { availability: input.fanAvailability }),
      });
      const fired = firedWith(coded, composed.brief, asked, settings, chatter);
      const alerts = settleAlerts(fired);
      // A risk of his outranks her alert: the handoff keeps the risk's cause, and the alert is a notice of its own.
      const riskFirst =
        composed.brief !== undefined && holdDecision(composed.brief, waited).kind === 'handoff';
      const pause = composed.handoff !== undefined || riskFirst ? null : alerts.pause;
      const notices = pause === null ? fired.map(noticeOf) : alerts.notices;
      const settled = withScripts(
        withSales(
          withNotices(await settle(withHer, input, composed, stop.flags, waited, pause, known), notices),
          composed,
        ),
        composed.scripts,
        settings,
      );
      const availability = composed.availability?.changed === true ? composed.availability.record : undefined;
      const withAvailability =
        availability === undefined ? settled : { ...settled, fanAvailability: availability };
      if (composed.desire === undefined) return withAvailability;
      const { before, score, signals, weightsVersion } = composed.desire;
      return { ...withAvailability, desire: { before, score, signals, weightsVersion } };
    },
  };
}
