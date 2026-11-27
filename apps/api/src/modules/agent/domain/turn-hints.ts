import type { FanAvailabilityRecord } from '@impera/contracts';

import type { AbandonTease } from './abandon';
import type { TimeWasterLevel } from './attention';
import { asksAvailability, type ScriptStart } from './availability';
import type { MeetingAnswer } from './meeting';
import { paceHints } from './pace';
import { asksForRefund } from './refund';
import type { RefusalMove } from './refusal';
import { asksSchoolRole } from './safety-net';
import { insistsForMore, mentionsOtherWoman } from './sexting-moves';
import type { SpenderRegister } from './spender-register';
import { explicitPhotoAnswer, proofAnswer, type FanStanding } from './standing';
import type { ShapedBrief, TurnReading } from './turn-briefs';
import { paceTurnsOf, type HistoryTurn } from './turn-history';
import type { SextingMoment } from './turn-sexting';
import {
  ABANDON_HINTS,
  AFTER_INSULT_HINT,
  AFTER_PURCHASE_HINT,
  ASK_AVAILABILITY_HINT,
  ASKS_IF_BOT_HINT,
  CLOSE_TO_COMING_HINT,
  COMPLIMENT_HINT,
  CUSTOM_INSTEAD_HINT,
  CUSTOM_MID_SCRIPT_HINT,
  DEGRADING_FROM_HIM_HINT,
  DISAPPOINTED_MEDIA_HINT,
  EXPLICIT_PHOTO_HINTS,
  FAREWELL_HINTS,
  farewellOf,
  type FarewellKind,
  FREE_SEXTING_HINT,
  GAUGE_HINT,
  HAGGLE_HINT,
  HE_CAME_EARLY_HINT,
  HE_CAME_HINT,
  HE_CAME_UNPAID_HINT,
  IN_TENSION_HINT,
  INSISTS_FOR_MORE_HINT,
  INSULT_HINT,
  JEALOUS_ALLOWED_HINT,
  KEEP_WARM_HINT,
  MEDIA_IS_HER_TRADE_HINT,
  meetingHint,
  MOOD_KILLER_HINT,
  MOOD_KILLER_OTHER_MAN_HINT,
  MORE_TONIGHT_HINT,
  MURMUR_HINT,
  NO_MOANS_HINT,
  NOT_JEALOUS_HINT,
  NOT_SHOWN_YET_HINT,
  ONE_NOTCH_HINT,
  PARTNER_RETURNS_HINT,
  PAYMENT_HELP_HINT,
  PROJECTION_HINT,
  PROOF_HINTS,
  PURCHASE_COMPLAINT_HINT,
  REFUND_ASKED_HINT,
  REFUSAL_HINTS,
  REGISTER_HINTS,
  SAYS_LOVE_HINT,
  SCHOOL_ROLE_HINT,
  SPENDER_REGISTER_HINTS,
  TIME_WASTER_HINTS,
  UNOPENED_STEP_HINT,
  WORK_TEASE_HINTS,
} from './turn-texts';
import type { WorkTeasePhase } from './work-tease';

/** What else leads her answer at this message: each one keeps the pace's and the availability's questions out. */
export interface AnswerLeads {
  readonly care: boolean;
  readonly hasScriptStep: boolean;
  readonly customOrder: boolean;
  readonly objectionReply: boolean;
  readonly trapped: boolean;
  readonly steersBack: boolean;
}

const nothingLeads = (leads: AnswerLeads): boolean =>
  !leads.hasScriptStep && !leads.customOrder && !leads.objectionReply && !leads.trapped && !leads.steersBack;

/** He is hot and sexualizes, only his availability is unknown: she makes sure in passing, once (ADR 0103 § 13). */
export function asksAvailabilityNow(
  availability: FanAvailabilityRecord | undefined,
  scriptStart: ScriptStart | undefined,
  leads: AnswerLeads,
): boolean {
  return (
    !leads.care &&
    availability !== undefined &&
    scriptStart !== undefined &&
    asksAvailability(availability, scriptStart) &&
    nothingLeads(leads)
  );
}

/** Getting to know him at his pace, never a questionnaire (Playground, Charles 16/11): on an ordinary answer only. */
export function pacedHints(
  answered: Pick<ShapedBrief, 'action'>,
  asking: boolean,
  fanText: string,
  history: readonly HistoryTurn[],
  leads: AnswerLeads,
): string[] {
  return !leads.care && !asking && answered.action === 'reply' && nothingLeads(leads)
    ? paceHints(fanText, paceTurnsOf(history))
    : [];
}

/** He leaves: a goodbye, unless she brings or helps him open a step (his own words then lead). */
export function farewellNow(
  brief: Pick<TurnReading, 'desireSignals'> | undefined,
  hasScriptStep: boolean,
  hasWaitingStep: boolean,
  herDayEnds: boolean,
): FarewellKind | null {
  return !hasScriptStep && !hasWaitingStep
    ? (farewellOf(brief?.desireSignals) ?? (herDayEnds ? 'her_day_ends' : null))
    : null;
}

/** Her tease is said only where nothing else leads her answer (a goodbye, her question, his trouble with a sale). */
export function teaseSaid(
  tease: AbandonTease | null,
  farewell: FarewellKind | null,
  asking: boolean,
  hasWaitingStep: boolean,
  complaint: boolean,
): AbandonTease | null {
  return tease !== null && farewell === null && !asking && !hasWaitingStep && !complaint ? tease : null;
}

/** The moments code answers by rule, by where he stands (Charles 21/11). */
export function occasionHintsOf(
  brief: TurnReading | undefined,
  facts: {
    readonly care: boolean;
    readonly customOrder: boolean;
    readonly standing: FanStanding;
    readonly ageConfirmed: boolean;
    readonly noExplicit: boolean;
  },
): string[] {
  return brief === undefined || facts.care
    ? []
    : [
        ...(brief.intent === 'asks_if_bot' ? [ASKS_IF_BOT_HINT] : []),
        ...(brief.occasion === 'says_love' ? [SAYS_LOVE_HINT] : []),
        ...(brief.occasion === 'partner_returns' ? [PARTNER_RETURNS_HINT] : []),
        // Relayed, her answer is the custom order's: no hint of her own beside it.
        ...(brief.occasion === 'asks_proof' && !facts.customOrder
          ? [PROOF_HINTS[proofAnswer(facts.standing)]]
          : []),
        ...(brief.occasion === 'unsolicited_explicit'
          ? [
              EXPLICIT_PHOTO_HINTS[
                explicitPhotoAnswer(facts.standing, facts.ageConfirmed && !facts.noExplicit)
              ],
            ]
          : []),
      ];
}

/** Everything code says of this turn to the voice, besides the brief it answers from (`toneHintsOfTurn`). */
export interface TurnHintFacts {
  readonly fanText: string;
  readonly care: boolean;
  readonly heCame: boolean;
  readonly farewell: FarewellKind | null;
  readonly asking: boolean;
  readonly paced: readonly string[];
  readonly reminds: boolean;
  readonly meeting: MeetingAnswer | undefined;
  /** He insults or belittles her, or comes back after: her stance, whatever else she answers (Charles 21/11). */
  readonly insulted: boolean;
  readonly afterInsult: boolean;
  readonly playsJealous: boolean;
  readonly workPhase: WorkTeasePhase | undefined;
  readonly noSale: boolean;
  readonly backToSale: boolean;
  readonly warm: boolean;
  readonly moreTonight: boolean;
  readonly occasionHints: readonly string[];
  readonly sexting: SextingMoment;
  readonly timeWaster: TimeWasterLevel | undefined;
  readonly spenderRegister: SpenderRegister | undefined;
  readonly hasWaitingStep: boolean;
  readonly complaint: boolean;
  readonly refusal: RefusalMove | null;
  readonly teases: AbandonTease | null;
}

/**
 * The hints added after the brief's own, in their order: he came, a goodbye, or her question on his availability lead
 * alone; otherwise every move of the turn that applies.
 */
export function toneHintsOfTurn(facts: TurnHintFacts): string[] {
  const { care, farewell, sexting } = facts;
  const { register, running } = sexting;
  if (facts.heCame && !care)
    return [
      HE_CAME_HINT,
      ...(sexting.cameEarly ? [HE_CAME_EARLY_HINT] : sexting.heCameUnpaid ? [HE_CAME_UNPAID_HINT] : []),
      ...(farewell === null ? [] : [FAREWELL_HINTS[farewell]]),
    ];
  if (farewell !== null) return [FAREWELL_HINTS[farewell]];
  if (facts.asking) return [ASK_AVAILABILITY_HINT];
  const workHint =
    facts.workPhase === undefined || facts.workPhase === 'none' || care
      ? null
      : WORK_TEASE_HINTS[facts.workPhase];
  return [
    ...facts.paced,
    ...(facts.reminds ? [UNOPENED_STEP_HINT] : []),
    ...(facts.meeting === undefined ? [] : [meetingHint(facts.meeting)]),
    ...(facts.insulted ? [INSULT_HINT] : facts.afterInsult ? [AFTER_INSULT_HINT] : []),
    ...(sexting.degradedByHim ? [DEGRADING_FROM_HIM_HINT] : []),
    ...(asksSchoolRole(facts.fanText) ? [SCHOOL_ROLE_HINT] : []),
    ...(mentionsOtherWoman(facts.fanText)
      ? [facts.playsJealous ? JEALOUS_ALLOWED_HINT : NOT_JEALOUS_HINT]
      : []),
    ...(workHint === null ? [] : [workHint]),
    ...(facts.noSale ? [FREE_SEXTING_HINT] : []),
    ...(facts.backToSale ? [MEDIA_IS_HER_TRADE_HINT] : []),
    ...(sexting.haggling ? [HAGGLE_HINT] : []),
    ...(sexting.murmur ? [MURMUR_HINT] : []),
    ...(sexting.inPlay && register !== null
      ? [sexting.otherManWanted ? MOOD_KILLER_HINT : `${MOOD_KILLER_HINT}, ${MOOD_KILLER_OTHER_MAN_HINT}`]
      : []),
    ...(sexting.sexualTurn && register !== 'very_explicit' ? [NO_MOANS_HINT] : []),
    ...(facts.warm ? [KEEP_WARM_HINT] : []),
    ...(facts.moreTonight ? [MORE_TONIGHT_HINT] : []),
    ...facts.occasionHints,
    ...(sexting.inTension ? [IN_TENSION_HINT] : []),
    ...(sexting.justBought ? [AFTER_PURCHASE_HINT] : []),
    ...(sexting.compliment ? [COMPLIMENT_HINT] : []),
    ...(sexting.holdsBack ? [CLOSE_TO_COMING_HINT] : []),
    ...(sexting.gauge ? [GAUGE_HINT] : []),
    ...(sexting.projection ? [PROJECTION_HINT] : []),
    ...(sexting.customMidScript && !facts.moreTonight
      ? [CUSTOM_MID_SCRIPT_HINT]
      : sexting.suggestsCustom
        ? [CUSTOM_INSTEAD_HINT]
        : []),
    ...(sexting.opensItHerself ? [ONE_NOTCH_HINT] : []),
    ...(register === null ? [] : [REGISTER_HINTS[register]]),
    ...(register !== null && running !== null ? [NOT_SHOWN_YET_HINT] : []),
    ...(care || facts.timeWaster === undefined ? [] : [TIME_WASTER_HINTS[facts.timeWaster]]),
    ...(care || facts.spenderRegister === undefined || facts.spenderRegister === 'warm'
      ? []
      : [SPENDER_REGISTER_HINTS[facts.spenderRegister]]),
    ...(facts.hasWaitingStep ? [PAYMENT_HELP_HINT] : []),
    ...(facts.complaint ? [PURCHASE_COMPLAINT_HINT, DISAPPOINTED_MEDIA_HINT] : []),
    // Only when he asks, never on her own (ADR 0158 § 48, avenant du 27/11).
    ...(!care && asksForRefund(facts.fanText) ? [REFUND_ASKED_HINT] : []),
    ...(facts.complaint && insistsForMore(facts.fanText) ? [INSISTS_FOR_MORE_HINT] : []),
    ...(facts.refusal === null ? [] : [REFUSAL_HINTS[facts.refusal]]),
    ...(facts.teases === null ? [] : [ABANDON_HINTS[facts.teases]]),
  ];
}
