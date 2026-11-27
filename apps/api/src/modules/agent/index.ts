import type { AgencyStyleContent, KycSlot, Language } from '@impera/contracts';
import { loadPrompt, type LlmGateway } from '@impera/llm';

import type { FansModule } from '../fans';

import { activePersonaForModels, type ActivePersonaSource } from './infra/active-persona';
import { createBubbleGuard, type AgentBubbleGuard } from './infra/bubble-guard';
import { pickVoiceExamples, type VoiceExample } from './infra/calibration-record';
import { createCardReader, type AgentCardReader } from './infra/card-reader';
import {
  createDraftComposer,
  type AgentDraftComposer,
  type ComposerPersonaFields,
  type DraftComposerDeps,
  type MediaSight,
  type ScriptSource,
} from './infra/draft-composer';
import { createFanLimits } from './infra/fan-limits';
import { guardSettingsOf, languagesOf, type PersonaForModels } from './infra/persona-file';

/** Public entry point of the `agent` module (ADR 0002). Other modules import this file only. */
export {
  checkVoiceOutput,
  checkYouthWords,
  DEFAULT_GUARD_SETTINGS,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
} from './domain/guards';
/** @public The one reading of a persona's limits, for `scripts` too (SC-02, ADR 0056 § 1): whole words, plurals folded. */
export { touchesTerm } from './domain/guards';
/** @public The emoji rule (Charles 26/11), pure, for another surface of hers (her public replies): the chat's own reading. */
export {
  checkEmojiUse,
  DEFAULT_EMOJI_STREAK_MAX,
  emojisIn,
  type EmojiUse,
  type EmojiViolation,
} from './domain/emojis';
export type { TrapAssessment } from './domain/traps';
/** @public The policy, read by `pnpm evals` on the same path as a real fan (and by the composer at P6-01). */
export { holdDecision, type HoldDecision } from './domain/hold';
export type { SaleTroubleSeen } from './domain/sale-trouble';
export { withoutOrders } from './domain/injection';
/** The safety net in code, read by `conversation.respond` to answer a fan in distress out of her hours (ADR 0088). */
export { safetySigns } from './domain/safety-net';
export { declaredAdultAge } from './domain/sexualization';
export { fanStanding } from './domain/standing';
export {
  slowedReplyAt,
  timeWasterLevel,
  TIRESOME_WINDOW_DAYS,
  type TimeWasterLevel,
} from './domain/attention';
export { bubbleDelays } from './domain/bubbles';
/** @public */
export { offerDecision, offerSignals, type OfferContext, type OfferLimits } from './domain/policy';
export type { SexualizationLimits } from './domain/sexualization';
export { followUpDecision, type FollowUpDecision } from './domain/follow-up';
/**
 * @public His availability and the gate before the first teaser (ADR 0103, amendement du 13/11): the playground keeps
 * them as `conversations` does and shows which condition is missing.
 */
export {
  readAvailability,
  scriptStartGate,
  UNKNOWN_AVAILABILITY,
  type FanAvailabilityRecord,
  type ScriptStart,
  type ScriptStartBlock,
} from './domain/availability';
/** @public measureDesire and DesireState: the playground keeps his score as `conversations` would (P3-12). */
export {
  DESIRE_WEIGHTS_VERSION,
  desireSignalPoints,
  measureDesire,
  recountDesire,
  type DesireMeasure,
  type DesireState,
} from './domain/desire';
export { describeSituation, isNight, isTimeZone, nextLocalTime, type Situation } from './domain/situation';
export {
  parseRejection,
  rateReport,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  suggestDestination,
  RATE_TARGET,
  versionLabel,
  type Verdict,
} from './domain/calibration';
export {
  pickVoiceExamples,
  replayableTests,
  voiceExamples,
  type CalibrationRecord,
  type VoiceExample,
  type CalibrationStore,
  type RatedMoment,
} from './infra/calibration-record';
export { CalibrationRecordSchema, createJsonlCalibrationStore } from './infra/jsonl-calibration-store';
export {
  asSent,
  composeTurn,
  FRENCH_ONLY,
  guardContextOf,
  withExamples,
  type ComposedTurn,
  type OfferInput,
  type ScriptsInput,
} from './infra/compose';
export {
  guardSettingsOf,
  languagesOf,
  readPersonaFile,
  type PersonaForModels,
  type PersonaLanguages,
} from './infra/persona-file';
/** @public Her active persona version, the port the composition root wires to `persona` (ADR 0010, 0022). */
export { activePersonaForModels, type ActivePersonaSource } from './infra/active-persona';
/** @public Her scripts as the agent reads them (ADR 0098), for the adapter the composition root builds. */
export type { ScriptSource } from './infra/draft-composer';
export type { PlatformScriptView as AgentScriptView, ScriptHistoryView } from './domain/script-run';
/** @public The playground plays trial scripts by the same rules (ADR 0103 § 15-17): its fictive purchase and refusal. */
export { applyScriptRunEvent, paidWaiting, type ScriptRun } from './domain/script-run';

/** @public Her persona and guards for a post of her Telegram channel (ADR 0080 § 5), the `telegram` port. */
export { channelWriterPersona } from './infra/channel-persona';
/** @public Her public panels and guards for a reply to an Instagram comment (ADR 0122 § 2), the `instagram-comments` port. */
export { commentWriterPersona } from './infra/channel-persona';
/** @public Her public panels and guards for the caption of a Reel (ADR 0164 § 9), the `instagram-captions` port. */
export { captionWriterPersona } from './infra/channel-persona';
/** @public Réglages › Alertes tries an alert on an example message (`POST /v1/alerts/test`, P4-01). */
export { createAlertTester, type AlertTester } from './infra/alert-test';
/** @public The persona module refuses a version whose sample replies a hard guard would block (P5-01). */
export { sampleReplyFaults } from './infra/sample-replies';
export type { AgentDraftComposer } from './infra/draft-composer';
/** @public Wired by the composition root with the connector's `FetchMedia` (P3-04). */
export type { MediaSight } from './infra/draft-composer';
/** @public Wired by the composition root with the connector's `FetchMedia` (P3-04). */
export { createMediaSight, type FetchMedia } from './infra/media-sight';
/** @public The `BubbleGuard` port of `conversations`, matched by shape. */
export type { AgentBubbleGuard } from './infra/bubble-guard';

export interface DraftComposerStartOptions {
  readonly gateway: LlmGateway;
  /**
   * Her active persona version (`persona` module, `versions.active`), read at each draft: the agent writes with the
   * one the owner activated in Créatrices › Persona. Without one, nothing is written and a human answers (ADR 0022).
   */
  readonly activePersona: ActivePersonaSource;
  /** Her clock, read for each draft: the creator's time zone. */
  readonly timeZoneOf: (creatorId: string) => Promise<string>;
  /**
   * Her bio on her platform profile, as last read (ADR 0154), read at each draft beside her persona; `null`: none.
   * Without it, she writes from her sheet alone. A failed read writes without it, never stops the draft.
   */
  readonly profileBioOf?: (creatorId: string) => Promise<string | null>;
  /** His media seen before she answers; without it, any media goes to a human. */
  readonly sight?: MediaSight;
  /** His limits: nothing is written to a stopped fan, and a risk sets them itself (P3-02). */
  readonly fans?: Pick<
    FansModule,
    | 'flags'
    | 'setFlag'
    | 'setFlagIfUnset'
    | 'clearFlag'
    | 'confirmDeclaredAge'
    | 'language'
    | 'keepDetectedLanguage'
  >;
  /** A note of hers kept out of the prompt (it looked like an order): a chatter's real note would vanish unseen. */
  readonly onDroppedNotes?: DraftComposerDeps['onDroppedNotes'];
  /** His declared age could not be saved: he stays unconfirmed (the safe side), the log says so. */
  readonly onLimitsNotSaved?: DraftComposerDeps['onLimitsNotSaved'];
  /** Her alerts that are on (`alerts` module, P4-01); without it, only her persona's words are watched. */
  readonly alertsOf?: DraftComposerDeps['alertsOf'];
  /** Whether a chatter is on shift on her accounts (`scheduling`): a doubt on who she is goes to them (P4-01). */
  readonly chatterOnShift?: DraftComposerDeps['chatterOnShift'];
  /** Her scripts on the platform and his history (ADR 0098); without it, no script moves and nothing is sold. */
  readonly scripts?: ScriptSource;
  /** When a priced bundle was last offered to him (the policy's cooldown); without it, she offers nothing. */
  readonly lastOfferAt?: DraftComposerDeps['lastOfferAt'];
  /** When he last bought a priced step (the pause after a purchase, ADR 0128); without it, no pause. */
  readonly lastPurchaseAt?: DraftComposerDeps['lastPurchaseAt'];
  /** Her grid of custom prices (`custom-orders`, ADR 0159 § C), read when his order is kept. */
  readonly gridOf?: DraftComposerDeps['gridOf'];
  /**
   * Her bank of examples, newest first, withdrawn ones left out (ADR 0102): the playground's corrections filed as her
   * voice's examples, one bank whichever version they were made on. Without it, or unreadable, she writes from her
   * sheet alone.
   */
  readonly voiceExamplesOf?: (creatorId: string) => Promise<readonly VoiceExample[]>;
  /** Her bank could not be read: she wrote from her sheet alone, the log says so. */
  readonly onExamplesUnread?: (event: { readonly creatorId: string }) => void;
  /**
   * The agency's active base style (ADR 0173, `persona` module), read at each draft: its texts before her sheet, its
   * form under hers. `null`: none. A failed read writes without it, never stops the draft.
   */
  readonly baseStyleOf?: BaseStyleSource;
}

/** Reads the agency's active base style (ADR 0173); `null` without one. */
export type BaseStyleSource = () => Promise<AgencyStyleContent | null>;

/** The active base style, or none when there is none or it cannot be read: a draft never waits on it. */
async function baseStyleOrNone(source: BaseStyleSource | undefined): Promise<AgencyStyleContent | null> {
  if (source === undefined) return null;
  try {
    return await source();
  } catch {
    return null;
  }
}

/**
 * @public The public part of the agency's base style (ADR 0173), for her public replies (Instagram comments): trimmed, `null`
 * when empty, absent or unreadable. The private part never leaves the chat.
 */
export async function publicBaseStyleOf(source: BaseStyleSource): Promise<string | null> {
  const style = await baseStyleOrNone(source);
  const text = style?.publicStyle.trim() ?? '';
  return text === '' ? null : text;
}

/**
 * Her fields for the composer, from her persona: her sheet, her own sample replies in it (P5-01), and the examples of
 * her bank chosen as the playground chooses them (ADR 0102 § 2): what the owner sees there is what a fan receives.
 */
function composerFields(
  persona: PersonaForModels,
  bank: readonly VoiceExample[],
  profileBio: string | null = null,
  baseStyle: AgencyStyleContent | null = null,
): ComposerPersonaFields {
  // Her persona's form first, then the base style's, then the code's (ADR 0173).
  const guardSettings = guardSettingsOf(persona, baseStyle?.form);
  // Each turn takes the twelve this fan may read among them (`examplesForTurn`): his age decides the explicit ones.
  const examples = pickVoiceExamples(bank, guardSettings, bank.length);
  return {
    persona: {
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      guardSettings,
      splitMessages: persona.splitMessages,
      ...(profileBio !== null && profileBio.trim() !== '' && { profileBio }),
      ...(baseStyle !== null && {
        agencyStyle: { publicStyle: baseStyle.publicStyle, privateStyle: baseStyle.privateStyle },
      }),
      ...(examples.length > 0 && { voiceExamples: examples }),
      ...languagesOf(persona),
    },
    offerLimits: persona.offerLimits,
    sexualizationLimits: persona.sexualizationLimits,
    followUpSpirit: persona.followUps.spirit,
    alertKeywords: persona.alertKeywords,
    objectionReplies: persona.objectionReplies,
    ...(persona.versionId !== undefined && { personaVersionId: persona.versionId }),
  };
}

/** Her bank, for the version she writes with to choose from; none without a version, a reader, or when unreadable. */
async function bankOf(
  options: DraftComposerStartOptions,
  creatorId: string,
  personaVersionId: string | undefined,
): Promise<readonly VoiceExample[]> {
  if (personaVersionId === undefined || options.voiceExamplesOf === undefined) return [];
  try {
    return await options.voiceExamplesOf(creatorId);
  } catch {
    options.onExamplesUnread?.({ creatorId });
    return [];
  }
}

/**
 * The composer behind `conversation.respond`. Her persona is not read here, and there is no other: each draft reads
 * her active version (ADR 0022: nothing kept in memory can be stale), without one nothing is written.
 */
export function startDraftComposer(options: DraftComposerStartOptions): AgentDraftComposer {
  return createDraftComposer({
    gateway: options.gateway,
    personaOf: async (creatorId, now) => {
      const persona = await activePersonaForModels(options.activePersona, creatorId, now);
      if (persona === null) return null;
      const profileBio = await (options.profileBioOf?.(creatorId) ?? Promise.resolve(null)).catch(() => null);
      const baseStyle = await baseStyleOrNone(options.baseStyleOf);
      return composerFields(
        persona,
        await bankOf(options, creatorId, persona.versionId),
        profileBio,
        baseStyle,
      );
    },
    timeZoneOf: options.timeZoneOf,
    voicePrompt: loadPrompt('voice').header.version,
    ...(options.sight !== undefined && { sight: options.sight }),
    ...(options.fans !== undefined && { limits: createFanLimits(options.fans) }),
    ...(options.onDroppedNotes !== undefined && { onDroppedNotes: options.onDroppedNotes }),
    ...(options.onLimitsNotSaved !== undefined && { onLimitsNotSaved: options.onLimitsNotSaved }),
    ...(options.alertsOf !== undefined && { alertsOf: options.alertsOf }),
    ...(options.chatterOnShift !== undefined && { chatterOnShift: options.chatterOnShift }),
    ...(options.scripts !== undefined && { scripts: options.scripts }),
    ...(options.lastOfferAt !== undefined && { lastOfferAt: options.lastOfferAt }),
    ...(options.lastPurchaseAt !== undefined && { lastPurchaseAt: options.lastPurchaseAt }),
    ...(options.gridOf !== undefined && { gridOf: options.gridOf }),
  });
}

/**
 * His card read in his new messages (ADR 0085 § 7), on the app's gateway: wired for every conversation, whoever
 * answers him. A line of his card shaped like an order is counted here, never logged.
 */
export function startCardReader(options: {
  readonly gateway: LlmGateway;
  readonly onDroppedNotes?: (event: { readonly conversationId: string; readonly dropped: number }) => void;
}): AgentCardReader {
  return createCardReader(options);
}

/** Her follow-up delays: `conversations`' `FollowUpPlan` port, matched by shape. */
export interface AgentFollowUpPlan {
  delaysHours(creatorId: string): Promise<readonly number[]>;
}

/**
 * Her follow-up delays, read at each call from the persona the composer writes with, her active version
 * (`follow_ups`): none when she has them off, or has no active version (the composer would write none). A failed
 * read throws: `conversations` decides. Wired only beside `startDraftComposer`, which writes the follow-ups
 * `conversation.follow_up` asks for (P3-10).
 */
export function startFollowUpPlan(options: {
  readonly activePersona: ActivePersonaSource;
  readonly now?: () => Date;
}): AgentFollowUpPlan {
  const now = options.now ?? (() => new Date());
  return {
    delaysHours: async (creatorId) =>
      (await activePersonaForModels(options.activePersona, creatorId, now()))?.followUps.delaysHours ?? [],
  };
}

/**
 * The canvas lines her persona collects (P5-01), in her order, read from her active version at each call: what the
 * Suivi says is left to learn of a fan. `null` without an active version; a failed read throws.
 */
export function startKycSlots(options: {
  readonly activePersona: ActivePersonaSource;
  readonly now?: () => Date;
}): (creatorId: string) => Promise<readonly KycSlot[] | null> {
  const now = options.now ?? (() => new Date());
  return async (creatorId) =>
    (await activePersonaForModels(options.activePersona, creatorId, now()))?.kycSlots ?? null;
}

/**
 * The languages her active persona speaks, in her order (ADR 0168), for his language on his card: empty without an
 * active version. @public Wired by the composition root on the `fans` routes.
 */
export function startPersonaLanguages(options: {
  readonly activePersona: ActivePersonaSource;
  readonly now?: () => Date;
}): (creatorId: string) => Promise<readonly Language[]> {
  const now = options.now ?? (() => new Date());
  return async (creatorId) =>
    (await activePersonaForModels(options.activePersona, creatorId, now()))?.spokenLanguages ?? [];
}

/** The guards of a creator's approvals: her active version's hard limits, `null` without one (fail closed). */
export interface AgentApprovalGuard {
  forCreator(creatorId: string): Promise<AgentBubbleGuard | null>;
}

/**
 * The hard guards for the bubbles a chatter approves, with her disgusts, forbidden words and emojis and pet names,
 * read from her active persona version before each approval (recette 28/10, G4). Without one, `null`: the approval
 * is refused, never read against another persona nor the shared guards alone.
 * @public Wired by the composition root on the `BubbleGuard` port of `conversations` (revue 09, G5).
 */
export function startBubbleGuard(options: {
  readonly activePersona: ActivePersonaSource;
  readonly now?: () => Date;
}): AgentApprovalGuard {
  const now = options.now ?? (() => new Date());
  return {
    forCreator: async (creatorId) => {
      const persona = await activePersonaForModels(options.activePersona, creatorId, now());
      return persona === null ? null : createBubbleGuard(guardSettingsOf(persona));
    },
  };
}

export interface AgentModule {
  readonly name: 'agent';
}

/** Builds the module. Its dependencies arrive as arguments once the module has any (coding.md). */
export function createAgentModule(): AgentModule {
  return { name: 'agent' };
}
