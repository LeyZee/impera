import type {
  AnswerVersion,
  Destination,
  MediaDescription,
  PlaygroundAnswer,
  PlaygroundState,
  Verdict,
} from '@nirvana/contracts';
import type { LlmGateway } from '@nirvana/llm';

import {
  guardSettingsOf,
  isNight,
  isTimeZone,
  nextLocalTime,
  rateReport,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  suggestDestination,
  RATE_TARGET,
  voiceExamples,
  type CalibrationRecord,
  type CalibrationStore,
  type PersonaForModels,
} from '../../agent/index';
import {
  AnswerInProgress,
  BlockedAnswer,
  FanMessageNotFound,
  LlmUnavailable,
  NothingToCompare,
  NothingToRate,
  PresetNotFound,
  TimeZoneInvalid,
  VoiceModelInvalid,
  type PlaygroundEngine,
} from '../application/engine';
import { FAN_PRESETS, findPreset } from '../domain/fan-presets';
import { guardLabel, trapLabel } from '../domain/labels';
import { completeMedia } from '../domain/media';

import { createPlaygroundSession, type PlaygroundTurn } from './session';

const HOUR_MS = 3_600_000;

export interface EngineDeps {
  readonly gateway: LlmGateway;
  /** The same gateway with another voice model, for a comparison; undefined for an unknown model. */
  readonly gatewayForVoice: (voiceModel: string) => LlmGateway | undefined;
  readonly persona: PersonaForModels;
  readonly store: CalibrationStore;
  /** Every rating so far, shared by all the trainers: the rate measures the bot, not the person. */
  readonly records: CalibrationRecord[];
  /** The configured voice prompt and model: the rate shown is theirs. */
  readonly version: AnswerVersion;
  readonly sessionId: string;
  /** Dollars per euro, the daily budget's rate: costs are journaled in USD and shown in euros (ADR 0011). */
  readonly usdPerEur: number;
  /** The creator the ratings belong to: the only one there is, until the screen lets the trainer choose. */
  readonly creatorId?: () => Promise<string | null>;
  readonly timeZone?: string;
  readonly now?: () => Date;
}

/** One rating, in the shape the training store keeps (shared with the terminal playground). */
export function ratingRecord(input: {
  readonly id: string;
  readonly creatorId?: string | undefined;
  readonly sessionId: string;
  readonly at: Date;
  readonly version: AnswerVersion;
  readonly verdict: Verdict;
  readonly destination: Destination | undefined;
  readonly exchange: { readonly fanMessage: string; readonly bubbles: readonly string[] };
  readonly moment: CalibrationRecord['moment'];
}): CalibrationRecord {
  return {
    id: input.id,
    ...(input.creatorId !== undefined && { creatorId: input.creatorId }),
    sessionId: input.sessionId,
    at: input.at.toISOString(),
    version: input.version,
    verdict: input.verdict,
    ...(input.destination !== undefined && { destination: input.destination }),
    fanMessage: input.exchange.fanMessage,
    bubbles: input.exchange.bubbles,
    moment: input.moment,
  };
}

function toAnswer(turn: PlaygroundTurn, usdPerEur: number): PlaygroundAnswer {
  return {
    bubbles: [...turn.bubbles],
    isBlocked: turn.isBlocked,
    violations: turn.violations.map((v) => ({
      code: v.code,
      label: guardLabel(v.code),
      severity: v.severity,
      ...(v.match !== undefined && { match: v.match }),
    })),
    ...(turn.handoff !== undefined && { handoff: [...turn.handoff] }),
    ...(turn.trap !== undefined && {
      trap: {
        signals: turn.trap.signals.map((s) => ({
          kind: s.kind,
          source: s.source,
          label: trapLabel(s.kind, s.source),
        })),
      },
    }),
    ...(turn.brief !== undefined && {
      brief: {
        intent: turn.brief.intent,
        sentiment: turn.brief.sentiment,
        risks: [...turn.brief.risks],
        action: turn.brief.action,
        replyBrief: turn.brief.replyBrief,
        kycMissing: [...turn.brief.kycMissing],
      },
    }),
    ...(turn.model !== undefined && { model: turn.model }),
    latencyMs: turn.latencyMs,
    costEur: turn.costUsd / usdPerEur,
    isFallback: turn.isFallback,
    ...((turn.voiceFailure ?? turn.briefFailure) !== undefined && {
      failure: turn.voiceFailure ?? turn.briefFailure ?? '',
    }),
  };
}

/** The P3-05 session behind the API: same brain, voice and guards as production, and nothing is ever sent. */
export function createPlaygroundEngine(deps: EngineDeps): PlaygroundEngine {
  const session = createPlaygroundSession({
    gateway: deps.gateway,
    creatorName: deps.persona.creatorName,
    personaSheet: deps.persona.personaSheet,
    guardSettings: guardSettingsOf(deps.persona),
    splitMessages: deps.persona.splitMessages,
    voiceExamples: voiceExamples(deps.records),
    offerLimits: deps.persona.offerLimits,
    sexualizationLimits: deps.persona.sexualizationLimits,
    followUps: deps.persona.followUps,
    ...(deps.timeZone !== undefined && { timeZone: deps.timeZone }),
    ...(deps.now !== undefined && { now: deps.now }),
  });
  let presetId: string | null = null;
  let isRated = true;
  let sessionCostUsd = 0;
  let ratings = 0;
  let isBusy = false;

  /** Nothing changes the conversation while an answer or a rating is under way. */
  const idle = (): void => {
    if (isBusy) throw new AnswerInProgress();
  };
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    idle();
    isBusy = true;
    try {
      return await work();
    } finally {
      isBusy = false;
    }
  };

  const rate = () => {
    const report = rateReport(deps.records, deps.version);
    return {
      rate: report.current.rate ?? null,
      rated: report.current.rated,
      validated: report.current.validated,
      target: RATE_TARGET,
      trendPoints: report.trendPoints ?? null,
      previousVersion: report.previousVersion ?? null,
    };
  };

  const isVoiceReachable = (): boolean => {
    const voice = deps.gateway.health().roles.find((r) => r.role === 'voice');
    return voice !== undefined && (voice.hasKey || voice.fallback?.hasKey === true);
  };

  const state = (): PlaygroundState => {
    const { situation, lastExchange } = session;
    return {
      persona: { name: deps.persona.creatorName },
      presets: FAN_PRESETS.map((p) => ({ id: p.id, label: p.label, tests: p.tests, opening: p.opening })),
      presetId,
      situation: {
        now: situation.now.toISOString(),
        timeZone: situation.timeZone,
        relationshipStartedAt: situation.relationshipStartedAt.toISOString(),
        spentCents: situation.spentCents,
        isNight: isNight(situation),
      },
      fanNotes: [...session.fanNotes],
      history: session.history.map((turn, index) => ({
        index,
        from: turn.from,
        text: turn.text,
        ...(turn.media !== undefined && {
          media: turn.media.map((m) => ({ description: m.description, isLocked: m.isLocked ?? false })),
        }),
      })),
      rate: rate(),
      version: deps.version,
      rejectReasons: REJECT_REASONS.map((id) => ({ id, label: REJECT_REASON_LABELS[id] })),
      sessionCostEur: sessionCostUsd / deps.usdPerEur,
      voice: { reachable: isVoiceReachable() },
      pending: lastExchange !== undefined && !isRated ? toAnswer(lastExchange.turn, deps.usdPerEur) : null,
    };
  };

  /** A voice model must be reachable, main or fallback; the key itself is never read here. */
  const assertAvailable = (): void => {
    if (!isVoiceReachable()) throw new LlmUnavailable();
  };

  const sendDescribed = async (
    text: string,
    media: readonly MediaDescription[],
  ): Promise<PlaygroundAnswer> => {
    assertAvailable();
    const turn = await session.handleFanMessage(text, media);
    isRated = false;
    sessionCostUsd += turn.costUsd;
    return toAnswer(turn, deps.usdPerEur);
  };

  const restart = (): void => {
    session.reset();
    presetId = null;
    isRated = true;
  };

  return {
    state,

    applyPreset(id) {
      idle();
      const preset = findPreset(id);
      if (preset === undefined) throw new PresetNotFound();
      restart();
      presetId = preset.id;
      session.setFanNotes(preset.fanNotes);
      session.setSituation({
        relationshipStartedAt: new Date(
          session.situation.now.getTime() - preset.relationshipAgeHours * HOUR_MS,
        ),
        spentCents: preset.spentCents,
      });
      return state();
    },

    reset() {
      idle();
      restart();
      return state();
    },

    send: (text, media) => exclusive(() => sendDescribed(text, media.map(completeMedia))),

    rate: (verdict, override) =>
      exclusive(async () => {
        const exchange = session.lastExchange;
        if (exchange === undefined || isRated) throw new NothingToRate();
        // Nothing was written, or the guards stopped it: there is nothing to validate as it stands.
        if (verdict.kind === 'validated' && exchange.turn.isBlocked) throw new BlockedAnswer();
        const destination =
          verdict.kind === 'validated' ? undefined : (override ?? suggestDestination(verdict));
        ratings += 1;
        const record = ratingRecord({
          id: `${deps.sessionId}-${String(ratings)}`,
          creatorId: (await deps.creatorId?.()) ?? undefined,
          sessionId: deps.sessionId,
          at: (deps.now ?? (() => new Date()))(),
          // The model that wrote it: an answer of the fallback counts for the fallback, not for Grok.
          version: {
            voicePrompt: deps.version.voicePrompt,
            voiceModel: exchange.turn.model ?? deps.version.voiceModel,
          },
          verdict,
          destination,
          exchange: { fanMessage: exchange.fanMessage, bubbles: exchange.turn.bubbles },
          moment: exchange.moment,
        });
        await deps.store.append(record);
        deps.records.push(record);
        isRated = true;
        if (verdict.kind === 'corrected') session.replaceLastAnswer(verdict.text);
        return { rate: rate(), destination: destination ?? null };
      }),

    branch: (fanMessageNumber) =>
      exclusive(async () => {
        // Checked before the history is cut: without a voice model the conversation stays as it was.
        assertAvailable();
        const replay = session.branchAt(fanMessageNumber);
        if (replay === undefined) throw new FanMessageNotFound();
        await sendDescribed(replay.text, replay.media);
        return state();
      }),

    compare: (voiceModel) =>
      exclusive(async () => {
        const other = deps.gatewayForVoice(voiceModel);
        if (other === undefined) throw new VoiceModelInvalid();
        const comparison = await session.compareVoice(other);
        if (comparison === undefined) throw new NothingToCompare();
        sessionCostUsd += comparison.costUsd;
        return {
          bubbles: [...comparison.bubbles],
          violations: comparison.violations.map((v) => ({
            code: v.code,
            label: guardLabel(v.code),
            severity: v.severity,
            ...(v.match !== undefined && { match: v.match }),
          })),
          isBlocked: comparison.isBlocked,
          ...(comparison.model !== undefined && { model: comparison.model }),
          costEur: comparison.costUsd / deps.usdPerEur,
          ...(comparison.failure !== undefined && { failure: comparison.failure }),
        };
      }),

    patchSituation(patch) {
      idle();
      if (patch.timeZone !== undefined) {
        if (!isTimeZone(patch.timeZone)) throw new TimeZoneInvalid();
        session.setSituation({ timeZone: patch.timeZone });
      }
      if (patch.spentCents !== undefined) session.setSituation({ spentCents: patch.spentCents });
      if (patch.relationshipAgeHours !== undefined) {
        session.setSituation({
          relationshipStartedAt: new Date(
            session.situation.now.getTime() - patch.relationshipAgeHours * HOUR_MS,
          ),
        });
      }
      if (patch.localTime !== undefined) {
        const [hour = 0, minute = 0] = patch.localTime.split(':').map(Number);
        const { now, timeZone } = session.situation;
        session.advance(nextLocalTime(now, timeZone, hour, minute).getTime() - now.getTime());
      }
      return state();
    },

    advance(hours) {
      idle();
      session.advance(hours * HOUR_MS);
      return state();
    },

    setNotes(notes) {
      idle();
      session.setFanNotes(notes);
      return state();
    },

    sendCreatorMedia(media, isLocked) {
      idle();
      session.sendCreatorMedia(completeMedia(media), isLocked);
      return state();
    },
  };
}
