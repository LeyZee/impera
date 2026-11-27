import type { FanAvailabilityRecord, Language } from '@impera/contracts';

import type { ScriptStart } from './availability';
import { desireMapOf, rankByFantasy, withoutHerLimits, type DesireMap } from './fantasy-match';
import { withoutForbiddenThemes } from './forbidden-themes';
import { holdsBackNow } from './gauge';
import { touchesTerm, type GuardSettings } from './guards';
import type { LanguageDecision } from './language';
import { offerSignals, sameEvening, type OfferContext } from './policy';
import {
  mayOpenScript,
  permittedScripts,
  type PlatformScriptView,
  type ScriptHistoryView,
  type ScriptRun,
} from './script-run';
import { scriptTurn, type ScriptTurn } from './script-turn';
import { isNight, type Situation } from './situation';
import type { TurnReading } from './turn-briefs';
import type { WorkTeasePhase } from './work-tease';

/** The policy's facts on him for an offer; his heat comes from his desire score, the risks from the brain. */
export type OfferInput = Omit<OfferContext, 'desire' | 'fanAsksForPaid' | 'fanSexualizes' | 'risks'>;

/** What a script decision reads (`scriptTurn`), besides the brain's reading, his heat and the policy's facts. */
export interface ScriptsInput {
  /** The conversation on the platform: the idempotency key of a step names it. */
  readonly conversationRef: string;
  readonly catalogue: readonly PlatformScriptView[];
  /** `null` when it could not be read: nothing moves, nothing sells (ADR 0018 § 5). */
  readonly history: ScriptHistoryView | null;
  readonly latest: ScriptRun | null;
  /** False on a second pass over the same message: it was already counted against the step waiting. */
  readonly countsHisMessage: boolean;
  /** His runs before `latest` that went cold: a run he left there makes her vexed (Charles 20/11). Absent: none. */
  readonly earlier?: readonly ScriptRun[];
  /** How many times she already teased him about `latest`, a run he left. Absent: never. */
  readonly teased?: number;
}

/** A script the brain may pick, by the short id it answers with, and what of his desire map it meets. */
export interface ScriptChoice {
  readonly id: string;
  readonly script: PlatformScriptView;
  readonly matches: readonly string[];
}

/**
 * His desire map, from the notes kept (Charles 26/11): the scripts closest to his fantasy come first. Youth, no consent,
 * the family, an animal: never played, whatever her persona (Sécurité, #1043). Then what her persona refuses (disgusts,
 * never said, never done) wins over his fantasy: never played nor targeted.
 */
export function hisDesireMap(notesKept: string, settings: GuardSettings): DesireMap {
  const herRefusals = [...settings.forbiddenTerms, ...(settings.neverDo ?? [])];
  return withoutHerLimits(withoutForbiddenThemes(desireMapOf(notesKept)), (item) =>
    herRefusals.some((term) => touchesTerm(item, term)),
  );
}

/**
 * One script an evening (Charles 21/11 and 27/11 at 0:28): the same evening as her last one, none is listed to the
 * brain, whatever he asks; asking for more leads to the custom path (`asksMoreSameEvening`).
 */
export function sameEveningAsLastOffer(offer: OfferInput | undefined, situation: Situation): boolean {
  return (
    offer?.lastOfferAt !== undefined &&
    offer.lastOfferAt !== null &&
    sameEvening(
      situation.now,
      offer.lastOfferAt,
      offer.limits.cooldownHours,
      offer.timeZone ?? situation.timeZone,
    )
  );
}

/**
 * His language for her scripts (ADR 0168 § 8): the one this message keeps, else his kept one, else French. `null`
 * when code reads his language as one it does not know: no script opens, never one in a language he may not read.
 */
export function scriptLanguageOf(language: LanguageDecision, kept: Language | undefined): Language | null {
  if (language.fan === 'unknown') return null;
  return language.keep ?? kept ?? 'french';
}

/**
 * The scripts the brain may pick from, by the short ids it answers with (`s1`…, given by `brainIds`): the permitted
 * ones closest to his fantasy first, each with what of his desire map it meets, those that touch one of his limits left
 * out (Charles 26/11); none when no script may open at this message, whatever he says (recette REV-13). And his
 * fantasies none of her permitted scripts meets. Scripts not read: none, and nothing said of his fantasies.
 */
export function scriptChoices(
  scripts: ScriptsInput | undefined,
  situation: Situation,
  map: DesireMap,
  offer: OfferInput | undefined,
  careMode: boolean,
  language: Language | null,
  brainIds: { readonly max: number; readonly idOf: (index: number) => string },
): { readonly choices: readonly ScriptChoice[]; readonly uncovered: readonly string[] } {
  if (scripts?.history === undefined || scripts.history === null) return { choices: [], uncovered: [] };
  const permitted = permittedScripts(scripts.catalogue, {
    moment: isNight(situation) ? 'night' : 'day',
    history: scripts.history,
    language,
  });
  const { ranked, uncovered } = rankByFantasy(permitted, map);
  // No script may open at this message (recette REV-13): none to pick, his fantasies without a script still said.
  if (offer === undefined || !mayOpenScript({ offer, latest: scripts.latest, careMode }))
    return { choices: [], uncovered };
  // Even when none shares anything with his map, the brain gets them all: she does with what she has (Charles 21:22).
  return {
    choices: ranked
      .slice(0, brainIds.max)
      .map(({ script, matches }, index) => ({ id: brainIds.idOf(index), script, matches })),
    uncovered,
  };
}

/** The step decided sends a media of her vault: the bubbles that bring it may announce it. */
export function stepSendsMedia(turn: ScriptTurn | undefined): boolean {
  const { decision, script } = turn ?? {};
  if (script === undefined || script === null) return false;
  if (decision?.kind !== 'start' && decision?.kind !== 'send_step') return false;
  return (script.steps[decision.step.stepIndex]?.mediaRefs.length ?? 0) > 0;
}

/** The media intensities of the steps he has seen, from the catalogue's tags of his run's script. */
export function intensitiesSeen(
  run: (Pick<ScriptRun, 'steps'> & { readonly scriptRef?: string }) | null,
  catalogue: readonly PlatformScriptView[],
): readonly string[] {
  if (run?.scriptRef === undefined) return [];
  const script = catalogue.find((one) => one.scriptRef === run.scriptRef);
  return run.steps.flatMap((step) => script?.steps[step.stepIndex]?.carries?.intensities ?? []);
}

/** The media sheet of the last step he can see in his run: an offered one, or a paid one he bought or opened. */
export function visibleStepSheet(run: ScriptRun, script: PlatformScriptView | undefined): string | undefined {
  const visible = run.steps.findLast(
    (step) => step.kind !== 'paid' || step.outcome === 'bought' || step.outcome === 'opened',
  );
  return visible === undefined ? undefined : script?.steps[visible.stepIndex]?.mediaSheet;
}

/** A run as he has seen it: the steps sent before now. */
export function seenRun(
  run: ScriptRun | null,
  now: Date,
): Pick<ScriptRun, 'status' | 'steps' | 'scriptRef'> | null {
  return run === null
    ? null
    : { scriptRef: run.scriptRef, status: run.status, steps: run.steps.filter((step) => step.sentAt < now) };
}

/** The paid step waiting for him as the voice reads it: its exact price, in euros, and what it holds. */
export interface WaitingStep {
  readonly price: { readonly amountMinor: number; readonly currency: 'EUR' };
  readonly mediaSheet: string | null;
}

/**
 * The paid step waiting for him, as the voice reads it to help him open it (ADR 0156 § 4): its exact price and what
 * it holds. Never when its price changed on the catalogue (he would pay another one), nor once no sale is allowed.
 */
export function waitingStepOf(
  turn: ScriptTurn,
  catalogue: readonly PlatformScriptView[],
  scriptRef: string | null,
): WaitingStep | undefined {
  const { decision } = turn;
  if (decision.kind !== 'wait' || !('step' in decision) || turn.priceMismatch !== null) return undefined;
  const { priceMinor, stepIndex } = decision.step;
  if (priceMinor === null) return undefined;
  const step = catalogue.find((script) => script.scriptRef === scriptRef)?.steps[stepIndex];
  return {
    // Reveal sells in euros: the catalogue's minor units are cents.
    price: { amountMinor: priceMinor, currency: 'EUR' as const },
    mediaSheet: step?.mediaSheet ?? null,
  };
}

/** What may stop a step at this message, each read by code before her script may act (`scriptMayAct`). */
export interface ScriptStops {
  readonly care: boolean;
  readonly heCame: boolean;
  readonly warm: boolean;
  readonly teasing: boolean;
  readonly herDayEnds: boolean;
  readonly brief: TurnReading | undefined;
  readonly trapped: boolean;
  readonly customOrder: boolean;
  readonly objectionReply: boolean;
  readonly storedPeakSeen: boolean;
  readonly workPhase: WorkTeasePhase | undefined;
  readonly noSale: boolean;
  readonly steersBack: boolean;
}

/** Whether her script may send a step at this message: nothing else leads her answer, and nothing forbids a sale. */
export function scriptMayAct(stops: ScriptStops): boolean {
  return (
    !stops.care &&
    !stops.heCame &&
    !stops.warm &&
    !stops.teasing &&
    // Her hours close in a few minutes: a step now would be cut off (ADR 0158 § A 7).
    !stops.herDayEnds &&
    stops.brief !== undefined &&
    !stops.trapped &&
    !stops.customOrder &&
    !stops.objectionReply &&
    // About to come: she asks him to hold back, the next step waits until he held (Charles 26/11).
    !holdsBackNow(stops.brief.desireSignals, stops.storedPeakSeen) &&
    // At his work, she teases first and stops dead when he cannot; a session without a sale sells nothing.
    stops.workPhase !== 'tease' &&
    stops.workPhase !== 'stopped' &&
    !stops.noSale &&
    !stops.steersBack
  );
}

/** Her scripts at this message: the run follows his message and Reveal, and code decides the step and its price (ADR 0098). */
export function scriptsTurnOf(facts: {
  readonly situation: Situation;
  readonly scripts: ScriptsInput;
  readonly offer: OfferInput;
  readonly language: Language | null;
  readonly heat: number;
  readonly choices: readonly ScriptChoice[];
  readonly brief: TurnReading | undefined;
  readonly fanText: string;
  readonly care: boolean;
  readonly scriptStart: ScriptStart | undefined;
  readonly gateRecord: FanAvailabilityRecord | undefined;
  readonly heCame: boolean;
  readonly hisMessagesAt: readonly Date[];
  readonly mayAct: boolean;
}): ScriptTurn {
  const { situation, scripts, offer, brief, heat } = facts;
  return scriptTurn({
    now: situation.now,
    conversationRef: scripts.conversationRef,
    latest: scripts.latest,
    catalogue: scripts.catalogue,
    history: scripts.history,
    language: facts.language,
    moment: isNight(situation) ? 'night' : 'day',
    hotSession: heat >= offer.limits.minDesire,
    // Only an id it was given: anything else picks nothing.
    brainPick: facts.choices.find(({ id }) => id === brief?.scriptPick)?.script.scriptRef ?? null,
    offer: {
      ...offer,
      desire: heat,
      fanAsksForPaid: brief !== undefined && offerSignals(brief).fanAsksForPaid,
      fanSexualizes: brief !== undefined && offerSignals(brief, facts.fanText).fanSexualizes,
      risks: brief?.risks ?? [],
    },
    // In care, the run still follows his message and Reveal, and no step goes (ADR 0088 § 2).
    careMode: facts.care,
    ...(facts.scriptStart !== undefined && { startGate: facts.scriptStart }),
    ...(facts.gateRecord !== undefined && { availability: facts.gateRecord.state }),
    reply: brief?.scriptReply ?? null,
    countsHisMessage: scripts.countsHisMessage && brief !== undefined,
    heCame: facts.heCame,
    hisMessagesAt: facts.hisMessagesAt,
    mayAct: facts.mayAct,
  });
}

/**
 * He just bought the last step of a script: whether he says so or not, he came, and his score comes back to his rest
 * level (ADR 0156 § 6, Charles 20/11).
 */
export function boughtOutNow(scripts: ScriptTurn | undefined): boolean {
  return [scripts?.moved, scripts?.followed].some(
    (change) =>
      change?.run.status === 'bought_out' && change.events.some((event) => event.type === 'script_ended'),
  );
}
