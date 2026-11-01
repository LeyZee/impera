import type { KycSlot } from '@nirvana/contracts';
import { loadPrompt, type LlmGateway } from '@nirvana/llm';

import type { FansModule } from '../fans';

import { activePersonaForModels, type ActivePersonaSource } from './infra/active-persona';
import { createBubbleGuard, type AgentBubbleGuard } from './infra/bubble-guard';
import {
  createDraftComposer,
  type AgentDraftComposer,
  type ComposerPersonaFields,
  type DraftComposerDeps,
  type MediaSight,
} from './infra/draft-composer';
import { createFanLimits } from './infra/fan-limits';
import { guardSettingsOf, type PersonaForModels } from './infra/persona-file';

/** Public entry point of the `agent` module (ADR 0002). Other modules import this file only. */
export {
  checkVoiceOutput,
  DEFAULT_GUARD_SETTINGS,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
} from './domain/guards';
export type { TrapAssessment } from './domain/traps';
/** @public The policy, read by `pnpm evals` on the same path as a real fan (and by the composer at P6-01). */
export { holdDecision } from './domain/hold';
export { withoutOrders } from './domain/injection';
/** @public */
export { offerDecision, offerSignals, type OfferContext, type OfferLimits } from './domain/policy';
export type { SexualizationLimits } from './domain/sexualization';
export { followUpDecision, type FollowUpDecision } from './domain/follow-up';
/** @public measureDesire and DesireState: the playground keeps his score as `conversations` would (P3-12). */
export { measureDesire, type DesireState } from './domain/desire';
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
  replayableTests,
  voiceExamples,
  type CalibrationRecord,
  type CalibrationStore,
  type RatedMoment,
} from './infra/calibration-record';
export { createJsonlCalibrationStore } from './infra/jsonl-calibration-store';
export { asSent, composeTurn, guardContextOf, withExamples, type OfferInput } from './infra/compose';
export { guardSettingsOf, readPersonaFile, type PersonaForModels } from './infra/persona-file';
/** @public Her active persona version, the port the composition root wires to `persona` (ADR 0010, 0022). */
export { activePersonaForModels, type ActivePersonaSource } from './infra/active-persona';

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
  /** His media seen before she answers; without it, any media goes to a human. */
  readonly sight?: MediaSight;
  /** His limits: nothing is written to a stopped fan, and a risk sets them itself (P3-02). */
  readonly fans?: Pick<
    FansModule,
    'flags' | 'setFlag' | 'setFlagIfUnset' | 'clearFlag' | 'confirmDeclaredAge'
  >;
  /** A note of hers kept out of the prompt (it looked like an order): a chatter's real note would vanish unseen. */
  readonly onDroppedNotes?: DraftComposerDeps['onDroppedNotes'];
  /** His declared age could not be saved: he stays unconfirmed (the safe side), the log says so. */
  readonly onLimitsNotSaved?: DraftComposerDeps['onLimitsNotSaved'];
  /** Her alerts that are on (`alerts` module, P4-01); without it, only her persona's words are watched. */
  readonly alertsOf?: DraftComposerDeps['alertsOf'];
  /** Whether a chatter is on shift on her accounts (`scheduling`): a doubt on who she is goes to them (P4-01). */
  readonly chatterOnShift?: DraftComposerDeps['chatterOnShift'];
}

/**
 * Her fields for the composer, from her persona: her sheet as it is, her own sample replies in it (P5-01). The
 * playground's corrected answers never join it: they were written on its fictional persona, not hers (M13).
 */
function composerFields(persona: PersonaForModels): ComposerPersonaFields {
  return {
    persona: {
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      guardSettings: guardSettingsOf(persona),
      splitMessages: persona.splitMessages,
    },
    offerLimits: persona.offerLimits,
    sexualizationLimits: persona.sexualizationLimits,
    followUpSpirit: persona.followUps.spirit,
    alertKeywords: persona.alertKeywords,
    ...(persona.versionId !== undefined && { personaVersionId: persona.versionId }),
  };
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
      return persona === null ? null : composerFields(persona);
    },
    timeZoneOf: options.timeZoneOf,
    voicePrompt: loadPrompt('voice').header.version,
    ...(options.sight !== undefined && { sight: options.sight }),
    ...(options.fans !== undefined && { limits: createFanLimits(options.fans) }),
    ...(options.onDroppedNotes !== undefined && { onDroppedNotes: options.onDroppedNotes }),
    ...(options.onLimitsNotSaved !== undefined && { onLimitsNotSaved: options.onLimitsNotSaved }),
    ...(options.alertsOf !== undefined && { alertsOf: options.alertsOf }),
    ...(options.chatterOnShift !== undefined && { chatterOnShift: options.chatterOnShift }),
  });
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
