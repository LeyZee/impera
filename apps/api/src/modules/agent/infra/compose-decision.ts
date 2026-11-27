import { desireNow } from '@impera/contracts';
import type { Brief, VoiceFantasy, VoiceScriptStep } from '@impera/llm';

import type { CustomOrderTurn } from '../../custom-orders';
import type { AbandonTease } from '../domain/abandon';
import type { CustomOrderDecision } from '../domain/custom-order';
import { desireRestOf, desireScore, NO_MEASURE, restedDesire, type DesireReading } from '../domain/desire';
import { hisDayAnswered } from '../domain/his-day';
import { meetingAnswer, relationshipTier, type MeetingAnswer } from '../domain/meeting';
import type { PickedObjectionReply } from '../domain/objections';
import { inPauseAfterPurchase, maySuggestCustom, offerSignals } from '../domain/policy';
import { withProofRead } from '../domain/proof-request';
import type { SaleTroubleOutcome } from '../domain/sale-trouble';
import type { ScriptTurn } from '../domain/script-turn';
import {
  declaredAdultAge,
  sexualizationDecision,
  type SexualizationDecision,
  type SexualizationLimits,
} from '../domain/sexualization';
import { fanStanding, proofAnswer } from '../domain/standing';
import { assessTrap, type TrapAssessment } from '../domain/traps';
import {
  answeredBrief,
  cameBackIfWaited,
  NEUTRAL_BRIEF,
  offeredBrief,
  trappedBrief,
  withHints,
  withinCursor,
  withoutEmojiIfDue,
} from '../domain/turn-briefs';
import {
  asksAvailabilityNow,
  farewellNow,
  occasionHintsOf,
  pacedHints,
  teaseSaid,
  toneHintsOfTurn,
} from '../domain/turn-hints';
import { askedHisAge, datedOf, earlierFanTexts, knownHoursOf, relationshipOf } from '../domain/turn-history';
import {
  availabilityTurnOf,
  scriptsBoughtOf,
  sexAllowedOf,
  standingFactsOf,
  type AvailabilityTurn,
} from '../domain/turn-moment';
import {
  asksMoreTonight,
  insistsMoreTonight,
  objectionReplyOf,
  offerRefusedOf,
  saleMovesOf,
  type OfferRefusal,
} from '../domain/turn-sale';
import { boughtOutNow, scriptMayAct, scriptsTurnOf, type WaitingStep } from '../domain/turn-scripts';
import { runFactsOf, sextingMomentOf, type SextingMoment } from '../domain/turn-sexting';
import { wornHint, type FarewellKind } from '../domain/turn-texts';
import { wornPhrases } from '../domain/worn';

import type { BrainTurn } from './compose-brain';
import { customOrderOf } from './compose-custom-order';
import type { ComposeTurnInput, ComposerPersona } from './compose-types';
import { voiceStepOf } from './compose-voice';

// Never closed hours: the cursor cannot let her go if her limits are unknown.
const NO_LIMITS: SexualizationLimits = {
  initiateAfterHours: Number.POSITIVE_INFINITY,
  minHoursBeforeFollowing: Number.POSITIVE_INFINITY,
  minDesireToOpen: Number.POSITIVE_INFINITY,
};

/** His score after this message, or undefined when it was already counted. */
function desireOf(brief: Brief, input: ComposeTurnInput): DesireReading | undefined {
  const desire = input.desire;
  if (desire?.counted === true) return undefined;
  return desireScore({
    previous: desire?.previous,
    signals: brief.desireSignals ?? [],
    intent: brief.intent,
    sentiment: brief.sentiment,
    measured: desire?.measured ?? NO_MEASURE,
    risks: brief.risks,
    ageDisputed: desire?.ageDisputed === true,
    now: input.situation.now,
    hasBought: input.situation.spentCents > 0,
  });
}

/** What code decided on his message, for the voice's input, its guards and what the turn returns. */
export interface DecidedTurn {
  readonly trap: TrapAssessment;
  /** An adult age he stated himself in this message; `null`, none. */
  readonly ageDeclared: number | null;
  readonly ageConfirmed: boolean;
  readonly noExplicit: boolean;
  readonly sexualization: SexualizationDecision | undefined;
  readonly care: boolean;
  readonly customOrder: Exclude<CustomOrderDecision, { kind: 'none' }> | undefined;
  readonly customOrderKept: Exclude<CustomOrderTurn, { kind: 'none' }> | undefined;
  readonly objectionReply: PickedObjectionReply | undefined;
  readonly moment: AvailabilityTurn;
  readonly scripts: ScriptTurn | undefined;
  readonly scriptStep: VoiceScriptStep | undefined;
  readonly desire: DesireReading | undefined;
  readonly offerRefused: OfferRefusal | undefined;
  readonly meeting: MeetingAnswer | undefined;
  /** She asks, in passing, whether he is free (ADR 0103 § 13). */
  readonly asking: boolean;
  readonly saleTrouble: SaleTroubleOutcome | undefined;
  readonly waitingStep: WaitingStep | undefined;
  readonly complaint: boolean;
  readonly farewell: FarewellKind | null;
  readonly teases: AbandonTease | null;
  readonly moreTonight: boolean;
  /** He insists for more after his script, or asks something made for him: she may steer him to it (Charles 27/11). */
  readonly moreTonightCustom: boolean;
  readonly sexting: SextingMoment;
  readonly fantasy: VoiceFantasy | undefined;
  /** Her words worn across her fans: named to the voice, read again on what it wrote. */
  readonly worn: readonly string[];
  readonly voiceBrief: Brief;
}

/**
 * Everything code decides on his message once the brain has read it, before the voice writes: the trap, his heat and
 * the cursor, a custom order, her scripts and the offer, the moves after a sale, and the brief the voice answers from.
 * No model is called here.
 */
export function decideTurn(
  persona: ComposerPersona,
  input: ComposeTurnInput,
  brainTurn: Pick<BrainTurn, 'brief' | 'desireMap' | 'scriptLanguage' | 'choices' | 'uncovered' | 'kept'>,
): DecidedTurn {
  const { desireMap, choices, uncovered } = brainTurn;
  // A proof he asks of her, read by code too: the brain may read it as a doubt only (passe 3 du 27/11, conversation 31).
  const brief = brainTurn.brief === undefined ? undefined : withProofRead(brainTurn.brief, input.fanText);
  const { situation } = input;
  const trap = assessTrap({
    fanText: input.fanText,
    earlierFanTexts: earlierFanTexts(input.history),
    media: input.media,
    ...(brief && { brain: brief }),
  });
  const trapped = trap.replyBrief !== undefined;
  const read: Brief = trappedBrief(brief ?? NEUTRAL_BRIEF, trap);
  // His age: one he states now confirms it at once (Charles, 16/11), no doubt by default and no question again. The
  // cursor decides from it, a trap's answer first.
  const ageDeclared = brief === undefined ? null : declaredAdultAge(brief.factsProposed, input.fanText);
  // His heat, counted by code from the brain's signals and what it measured (P3-12); read as stored once counted.
  const counted = brief === undefined ? undefined : desireOf(brief, input);
  const heat = counted?.score ?? desireNow(input.desire?.previous, situation.now);
  const ageConfirmed = input.sexualization?.ageConfirmed === true || ageDeclared !== null;
  const noExplicit = input.sexualization?.noExplicit === true;
  const sexualization =
    brief === undefined
      ? undefined
      : sexualizationDecision({
          relationshipHours: knownHoursOf(situation),
          ageConfirmed,
          noExplicit,
          fanSexualizes: offerSignals(brief, input.fanText).fanSexualizes,
          desire: heat,
          limits: input.sexualization?.limits ?? NO_LIMITS,
          afterPurchase: input.offer !== undefined && inPauseAfterPurchase(input.offer),
        });
  const within =
    sexualization === undefined || trapped
      ? read
      : withinCursor(read, sexualization, ageDeclared !== null || askedHisAge(input.history));
  const cursored = cameBackIfWaited(within, input.waited === true);
  const steersBack = sexualization?.kind === 'steer_back';
  const standingFacts = standingFactsOf(situation, input.scripts?.history);
  const standing = fanStanding(standingFacts, input.standingLimits);
  // A proof he asks of her (« un selfie avec deux doigts sur la joue »), relayed by where he stands: made for him, so a
  // custom order the team takes; she never promises it herself (passe 2 du 26/11, conversation 31).
  const proofRelayed = brief?.occasion === 'asks_proof' && proofAnswer(standing) === 'relay';
  // The care mode (ADR 0088) comes before any sale: no custom order, no objection reply, no script step.
  const care = typeof input.care === 'function' ? input.care(brief) : input.care === true;
  const { customOrder, customOrderKept } = customOrderOf({
    persona,
    input,
    brief,
    kept: brainTurn.kept,
    ageConfirmed,
    trapped,
    care,
    proofRelayed,
  });
  const objectionReply = objectionReplyOf(brief, care, trapped, input.objections);
  const sexAllowed = sexAllowedOf(brief, { ageConfirmed, noExplicit, care, trapped });
  const moment = availabilityTurnOf({
    brief,
    fanText: input.fanText,
    history: input.history,
    situation,
    previous: input.availability,
    threshold: input.offer?.limits.minDesire,
    heat,
    scriptsBought: scriptsBoughtOf(input.scripts?.history),
    sexAllowed,
    fanTier: input.fanTier,
    random: input.random ?? Math.random,
  });
  const { availability, work, free, gateRecord, scriptStart } = moment;
  const noSale = free?.noSale === true;
  const run = runFactsOf({
    brief,
    scripts: input.scripts,
    offer: input.offer,
    situation,
    heat,
    care,
    standingFacts,
    standingLimits: input.standingLimits,
    history: input.history,
  });
  const { heCame, tease, warm } = run;
  const scripts =
    input.scripts === undefined || input.offer === undefined
      ? undefined
      : scriptsTurnOf({
          situation,
          scripts: input.scripts,
          offer: input.offer,
          language: brainTurn.scriptLanguage,
          heat,
          choices,
          brief,
          fanText: input.fanText,
          care,
          scriptStart,
          gateRecord,
          heCame,
          hisMessagesAt: run.hisMessagesAt,
          mayAct: scriptMayAct({
            care,
            heCame,
            warm,
            teasing: tease !== null,
            herDayEnds: input.herDayEnds === true,
            brief,
            trapped,
            customOrder: customOrder !== undefined,
            objectionReply: objectionReply !== undefined,
            storedPeakSeen: run.storedPeakSeen,
            workPhase: work?.phase,
            noSale,
            steersBack,
          }),
        });
  const scriptStep = voiceStepOf(scripts);
  const hasScriptStep = scriptStep !== undefined;
  const boughtOut = boughtOutNow(scripts);
  const desire = counted !== undefined && boughtOut ? restedDesire(counted, desireRestOf(true)) : counted;
  const offerRefused = offerRefusedOf({
    cursored,
    hasScriptStep,
    heCame,
    teasing: tease !== null,
    scriptsDecide: input.scripts !== undefined && input.offer !== undefined,
    scriptStart,
    offer: input.offer,
    heat,
  });
  const offered = offeredBrief(cursored, scriptStep?.kind, offerRefused !== undefined);
  // He asks to see her, or about her next party: code picks the reason, from where they are (Charles 21/11).
  const meeting: MeetingAnswer | undefined =
    brief !== undefined && (brief.risks.includes('meet_request') || brief.asksHerNextParty === true)
      ? meetingAnswer({
          tier: relationshipTier(relationshipOf(situation), input.meetingTiers),
          given: input.meeting?.given ?? [],
          teased: input.meeting?.teased ?? false,
          herNextParty: brief.asksHerNextParty === true,
        })
      : undefined;
  const answered = answeredBrief(care, read, customOrder, offered);
  const leads = {
    care,
    hasScriptStep,
    customOrder: customOrder !== undefined,
    objectionReply: objectionReply !== undefined,
    trapped,
    steersBack,
  };
  const asking = asksAvailabilityNow(availability, scriptStart, leads);
  const paced = pacedHints(answered, asking, input.fanText, input.history, leads);
  const sale = saleMovesOf(
    {
      brief,
      situation,
      history: input.history,
      scriptsIn: input.scripts,
      offer: input.offer,
      scripts,
      heat,
      saleTrouble: input.saleTrouble,
    },
    { care, hasScriptStep, customOrder, objectionReply, trapped, steersBack },
  );
  const { waitingStep, complaint, saleTrouble } = sale;
  const farewell = farewellNow(brief, hasScriptStep, waitingStep !== undefined, input.herDayEnds === true);
  const teases = teaseSaid(tease, farewell, asking, waitingStep !== undefined, complaint);
  const insulted = brief?.risks.includes('insult') === true;
  const moreTonight = asksMoreTonight(brief, input.offer, hasScriptStep, input.scripts?.latest);
  // A cam or a video made for him is never volunteered: only when he insists or asks for it (passe 3 du 27/11, 18).
  const moreTonightCustom =
    moreTonight && insistsMoreTonight(input.fanText, input.history, input.scripts?.latest);
  const sexting = sextingMomentOf({
    brief,
    fanText: input.fanText,
    history: input.history,
    situation,
    scriptsIn: input.scripts,
    scripts,
    run,
    heat,
    care,
    trapped,
    ageConfirmed,
    noExplicit,
    sexualization,
    boughtOut,
    hasScriptStep,
    customOrder: customOrder !== undefined,
    customAllowed:
      brief !== undefined &&
      input.offer !== undefined &&
      maySuggestCustom({ risks: brief.risks, flags: input.offer.flags }),
    desireMap,
    uncovered,
    degradingWords: persona.guardSettings.degradingWords ?? [],
  });
  const fantasy: VoiceFantasy | undefined =
    sexting.playOn.length === 0 && sexting.noScript.length === 0
      ? undefined
      : { playOn: sexting.playOn, noScript: sexting.noScript };
  const voiceBriefRead = withHints(
    answered,
    toneHintsOfTurn({
      fanText: input.fanText,
      care,
      heCame,
      farewell,
      asking,
      paced,
      dayAnswered: hisDayAnswered(input.history.map((turn) => ({ ...datedOf(turn), text: turn.text }))),
      reminds: sale.reminds,
      meeting,
      insulted,
      afterInsult: !insulted && brief?.returnsAfterInsult === true,
      playsJealous: persona.playsJealous === true,
      workPhase: work?.phase,
      noSale,
      backToSale: free?.backToSale === true,
      warm,
      moreTonight,
      moreTonightCustom,
      occasionHints: occasionHintsOf(brief, {
        care,
        customOrder: customOrder !== undefined,
        standing,
        ageConfirmed,
        noExplicit,
      }),
      sexting,
      timeWaster: input.timeWaster,
      spenderRegister: input.spenderRegister,
      hasWaitingStep: waitingStep !== undefined,
      complaint,
      refusal: sale.refusal,
      teases,
    }),
  );
  // Her anecdotes and questions worn across her fans: named to the voice, and read again on what it wrote.
  const worn = wornPhrases(input.herRecent ?? [], persona.wornLimits);
  const wornBrief: Brief = worn.length === 0 ? voiceBriefRead : withHints(voiceBriefRead, [wornHint(worn)]);
  const voiceBrief = withoutEmojiIfDue(wornBrief, input.history, persona.guardSettings);
  return {
    trap,
    ageDeclared,
    ageConfirmed,
    noExplicit,
    sexualization,
    care,
    customOrder,
    customOrderKept,
    objectionReply,
    moment,
    scripts,
    scriptStep,
    desire,
    offerRefused,
    meeting,
    asking,
    saleTrouble,
    waitingStep,
    complaint,
    farewell,
    teases,
    moreTonight,
    moreTonightCustom,
    sexting,
    fantasy,
    worn,
    voiceBrief,
  };
}
