import type { FanAvailabilityRecord, FanTier } from '@impera/contracts';

import { readAvailability, scriptStartGate, sexualizes, type ScriptStart } from './availability';
import { freeSextingTurn, type FreeSextingOutcome } from './free-sexting';
import { NO_SALE_RISKS, offerSignals } from './policy';
import type { ScriptHistoryView } from './script-run';
import type { Situation } from './situation';
import type { StandingFacts } from './standing';
import type { TurnReading } from './turn-briefs';
import { datedOf, knownHoursOf, type HistoryTurn } from './turn-history';
import { heWroteFirst, workTeaseTurn, type WorkTeaseOutcome } from './work-tease';

/** Where he stands, by code (ADR 0135, guide 26/11): a known payer is one who paid recently enough. */
export function standingFactsOf(
  situation: Situation,
  scriptHistory: ScriptHistoryView | null | undefined,
): StandingFacts {
  return {
    now: situation.now,
    knownHours: knownHoursOf(situation),
    spentCents: situation.spentCents,
    ...(situation.lastSpentAt !== undefined && { lastSpentAt: situation.lastSpentAt }),
    unenteredScripts:
      scriptHistory?.scripts.filter(
        (sent) => sent.sentStepIndexes.length > 0 && sent.boughtStepIndexes.length === 0,
      ).length ?? 0,
  };
}

/** His scripts with a paid step bought: what makes him faithful for the exceptions below (Charles 26/11). */
export function scriptsBoughtOf(scriptHistory: ScriptHistoryView | null | undefined): number {
  return scriptHistory?.scripts.filter((sent) => sent.boughtStepIndexes.length > 0).length ?? 0;
}

/** Anything sexual may be offered him: his adult age confirmed, nothing explicit not asked, no care, no trap, no risk. */
export function sexAllowedOf(
  brief: TurnReading | undefined,
  facts: {
    readonly ageConfirmed: boolean;
    readonly noExplicit: boolean;
    readonly care: boolean;
    readonly trapped: boolean;
  },
): boolean {
  return (
    brief !== undefined &&
    facts.ageConfirmed &&
    !facts.noExplicit &&
    !facts.care &&
    !facts.trapped &&
    !brief.risks.some((risk) => NO_SALE_RISKS.includes(risk))
  );
}

/** His availability at this message, the exceptions it opens, and the gate before the first teaser (ADR 0103). */
export interface AvailabilityTurn {
  /** His availability read on this message; absent without the brain's reading or her script threshold. */
  readonly availability: FanAvailabilityRecord | undefined;
  readonly work: WorkTeaseOutcome | undefined;
  readonly free: FreeSextingOutcome | undefined;
  /** What the gate reads: once he bit at his work, his being busy no longer closes it. */
  readonly gateRecord: FanAvailabilityRecord | undefined;
  /** What the conversation keeps: his availability, the work tease and the draw of the session, each when known. */
  readonly availabilityKept: FanAvailabilityRecord | undefined;
  readonly scriptStart: ScriptStart | undefined;
}

/**
 * His availability and the gate before the first teaser (ADR 0103 § 9-13): code holds both, the brain only reports.
 * With it, the exception « au travail » and the sexting without a sale (Charles 26/11), each drawn from his record.
 */
export function availabilityTurnOf(facts: {
  readonly brief: TurnReading | undefined;
  readonly fanText: string;
  readonly history: readonly HistoryTurn[];
  readonly situation: Situation;
  readonly previous: FanAvailabilityRecord | null | undefined;
  readonly threshold: number | undefined;
  readonly heat: number;
  readonly scriptsBought: number;
  readonly sexAllowed: boolean;
  readonly fanTier: FanTier | null | undefined;
  readonly random: () => number;
}): AvailabilityTurn {
  const { brief, threshold, heat, situation } = facts;
  const availability =
    brief === undefined || threshold === undefined
      ? undefined
      : readAvailability({
          previous: facts.previous ?? null,
          signals: brief.desireSignals ?? [],
          sexualizes: sexualizes(brief, facts.fanText),
          desire: heat,
          threshold,
          now: situation.now,
        });
  // The exception « au travail » (Charles 26/11): a faithful fan who writes by himself from his work, once per span.
  const work =
    availability === undefined || brief === undefined
      ? undefined
      : workTeaseTurn({
          previous: facts.previous?.workTease ?? null,
          now: situation.now,
          signals: brief.desireSignals ?? [],
          scriptsBought: facts.scriptsBought,
          heWroteFirst: heWroteFirst(facts.history.map(datedOf), situation.now),
          bites: sexualizes(brief, facts.fanText),
          allowed: facts.sexAllowed,
        });
  // The sexting without a sale (Charles 26/11): drawn once per hot session, for a fan who pays well.
  const free =
    availability === undefined || brief === undefined
      ? undefined
      : freeSextingTurn({
          record: facts.previous?.freeSexting ?? null,
          sessionAt: availability.hotAt,
          scriptsBought: facts.scriptsBought,
          ...(facts.fanTier !== undefined && { fanTier: facts.fanTier }),
          lastSpentAt: situation.lastSpentAt,
          now: situation.now,
          asksForMedia: brief.intent === 'asks_for_media' || offerSignals(brief).fanAsksForPaid,
          allowed: facts.sexAllowed,
          random: facts.random,
        });
  // Once he bit at his work, his being busy no longer closes the gate: his heat and his sexualizing still do.
  const atWorkMayStart = work?.phase === 'may_start';
  const gateRecord: FanAvailabilityRecord | undefined =
    availability === undefined
      ? undefined
      : atWorkMayStart
        ? { ...availability, state: 'confirmed' }
        : availability;
  const workRecord = work?.record ?? facts.previous?.workTease ?? null;
  const freeRecord = free?.record ?? facts.previous?.freeSexting ?? null;
  const availabilityKept: FanAvailabilityRecord | undefined =
    availability === undefined
      ? undefined
      : {
          ...availability,
          ...(workRecord !== null && { workTease: workRecord }),
          ...(freeRecord !== null && { freeSexting: freeRecord }),
        };
  const scriptStart =
    gateRecord === undefined || threshold === undefined
      ? undefined
      : scriptStartGate(gateRecord, heat, threshold);
  return { availability, work, free, gateRecord, availabilityKept, scriptStart };
}
