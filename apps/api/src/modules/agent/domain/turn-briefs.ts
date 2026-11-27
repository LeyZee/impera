import type { AfterSaleType, BriefIntent, CustomOrderReading, ObjectionKind } from '@impera/contracts';

import { CARE_BRIEF, CARE_TONE_HINTS } from './care';
import type { CustomOrderDecision } from './custom-order';
import { DEFAULT_EMOJI_STREAK_MAX, emojiStreakReached } from './emojis';
import { previousTurnsOf, type GuardSettings } from './guards';
import { discountAsked } from './objections';
import type { SexualizationDecision } from './sexualization';
import type { TrapAssessment } from './traps';
import type { HistoryTurn } from './turn-history';
import {
  AFTERCARE_WHAT,
  CAME_BACK_BRIEF,
  COMPLIMENT_BRIEF,
  COMPLIMENT_TONE_HINTS,
  FLIRT_HINT,
  NO_EMOJI_HINT,
  NO_OPENING_HINT,
  refusedOfferBrief,
  STEER_BACK_BRIEF,
  SUGGESTIVE_HINT,
} from './turn-texts';

/**
 * What code reads and rewrites of the brain's brief (`Brief` of the models' gateway, structurally): every other field
 * goes through untouched, so each function returns the same kind of brief it was given.
 */
export interface ShapedBrief {
  readonly intent: BriefIntent;
  readonly risks: readonly string[];
  readonly action: 'reply' | 'offer' | 'wait' | 'follow_up' | 'handoff';
  readonly replyBrief: string;
  readonly toneHints: readonly string[];
}

/**
 * What the turn's decisions read of the brain's brief, besides what they rewrite (the models' `Brief`, structurally:
 * the domain does not import the gateway).
 */
export interface TurnReading extends ShapedBrief {
  readonly sentiment: string;
  readonly factsProposed: readonly {
    readonly key: string;
    readonly value: string;
    readonly kind: string;
    readonly confidence: number;
  }[];
  readonly desireSignals?: readonly string[] | undefined;
  readonly occasion?: 'says_love' | 'asks_proof' | 'partner_returns' | 'unsolicited_explicit' | undefined;
  readonly scriptPick?: string | undefined;
  readonly scriptReply?: 'refused' | 'answers_step' | 'claims_bought' | undefined;
  readonly asksHerNextParty?: boolean | undefined;
  readonly returnsAfterInsult?: boolean | undefined;
  readonly objection?: ObjectionKind | undefined;
  readonly customOrder?: CustomOrderReading | undefined;
}

/** A brief code writes whole, never the brain's: nothing read, nothing to buy. */
export interface CodeBrief {
  readonly intent: 'other';
  readonly sentiment: 'neutral' | 'positive' | 'aroused';
  readonly factsProposed: never[];
  readonly kycMissing: never[];
  readonly risks: never[];
  readonly action: 'reply';
  readonly replyBrief: string;
  readonly toneHints: string[];
}

/** A follow-up as the voice writes it: how long he has been silent, and her own way of following up if she wrote one. */
export interface FollowUpTurn {
  readonly silentHours: number;
  /** `follow_ups.text` when her type is « custom »: the spirit of her follow-ups, written by the team. */
  readonly spirit: string | null;
}

export interface AftercareTurn {
  /** What he paid for: a step of her script, or a tip. */
  readonly saleType: AfterSaleType;
  /** His run is still open: he bought a step in the middle of the script, the moment goes on. */
  readonly scriptGoesOn: boolean;
}

export const NEUTRAL_BRIEF: CodeBrief = {
  intent: 'other',
  sentiment: 'neutral',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui répondre dans la continuité de la conversation.',
  toneHints: [],
};

/** The brief with these hints added after its own. */
export function withHints<B extends ShapedBrief>(brief: B, hints: readonly string[]): B {
  return { ...brief, toneHints: [...brief.toneHints, ...hints] };
}

/** The brief with `NO_EMOJI_HINT` when her emoji streak is reached, so the guard never asks a paid rewrite for it. */
export function withoutEmojiIfDue<B extends ShapedBrief>(
  brief: B,
  history: readonly HistoryTurn[],
  settings: GuardSettings,
): B {
  const turns = previousTurnsOf(history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })));
  return emojiStreakReached(turns, settings.emojiStreakMax ?? DEFAULT_EMOJI_STREAK_MAX)
    ? { ...brief, toneHints: [...brief.toneHints, NO_EMOJI_HINT] }
    : brief;
}

/** What the voice writes for a follow-up: decided by code, never by the brain (CLAUDE.md rule 3). */
export function followUpBrief(followUp: FollowUpTurn): CodeBrief {
  const hours = Math.max(1, Math.round(followUp.silentHours));
  const spirit = followUp.spirit === null ? '' : ` Dans l’esprit de ses relances : ${followUp.spirit}`;
  return {
    intent: 'other',
    sentiment: 'neutral',
    factsProposed: [],
    kycMissing: [],
    risks: [],
    action: 'reply',
    replyBrief: `Il ne lui a rien répondu depuis ${String(hours)} h. Elle lui écrit un petit message léger qui rebondit sur ce dont ils parlaient ou prend de ses nouvelles, sans reproche, sans rien proposer de payant, sans parler de prix.${spirit}`,
    toneHints: [NO_OPENING_HINT, 'court, une seule bulle'],
  };
}

/**
 * Her word after a sale of his (ADR 0156 § 2), decided by code, never by the brain (CLAUDE.md rule 3): thanks and
 * tenderness, without overdoing it, nothing to buy, no sulking.
 */
export function aftercareBrief(aftercare: AftercareTurn): CodeBrief {
  // In the middle of a script she stays in the moment and checks he is still with her: the tender aftercare is for its
  // end (Charles, 20/11).
  if (aftercare.scriptGoesOn) {
    return {
      intent: 'other',
      sentiment: 'aroused',
      factsProposed: [],
      kycMissing: [],
      risks: [],
      action: 'reply',
      replyBrief: `${AFTERCARE_WHAT.ppv} Elle lui demande, complice et chaude, si ça lui a plu et comment il se sent, en restant dans la tension du moment, sans rien proposer de payant, sans parler de prix ni d’argent.`,
      toneHints: ['court, une seule bulle', 'dans la séduction, jamais commerciale'],
    };
  }
  return {
    intent: 'other',
    sentiment: 'positive',
    factsProposed: [],
    kycMissing: [],
    risks: [],
    action: 'reply',
    replyBrief: `${AFTERCARE_WHAT[aftercare.saleType]} Elle lui écrit un petit mot tendre, sincère et complice, qui le remercie sans en faire trop, sans rien proposer de payant, sans parler de prix ni d’argent, sans reproche.`,
    toneHints: [NO_OPENING_HINT, 'court, une seule bulle', 'chaleureuse, jamais commerciale'],
  };
}

/** The brief of a turn with nothing of his to read: a follow-up, or her word after a sale. */
export function quietBriefOf(
  followUp: FollowUpTurn | undefined,
  aftercare: AftercareTurn | undefined,
): CodeBrief {
  return followUp !== undefined
    ? followUpBrief(followUp)
    : aftercare !== undefined
      ? aftercareBrief(aftercare)
      : NEUTRAL_BRIEF;
}

/** « Fais-moi un prix »: a price objection, whatever else the brain read (passe 2 du 26/11, conversation 23). */
export function withDiscountAsked<B extends ShapedBrief>(asked: B, fanText: string): B {
  return discountAsked(asked.intent, fanText)
    ? { ...asked, intent: 'price_objection', objection: 'asks_discount' }
    : asked;
}

/** A trap overrides whatever the brain suggested: she does not play along (agent/domain/traps.ts). */
export function trappedBrief<B extends ShapedBrief>(read: B, trap: TrapAssessment): B {
  return trap.replyBrief === undefined
    ? read
    : {
        ...read,
        action: 'reply',
        replyBrief: trap.replyBrief,
        toneHints: [...(trap.toneHints ?? [])],
      };
}

/**
 * The brief as the cursor lets the voice write it. His age is asked at most once, and never right after he gave it
 * (`ageAsked`): she slows down without asking it again. A flirt she may not take further is still welcomed, in code's
 * words (`COMPLIMENT_BRIEF`).
 */
export function withinCursor<B extends ShapedBrief>(
  brief: B,
  decision: SexualizationDecision,
  ageAsked: boolean,
): B {
  if (decision.kind === 'steer_back') {
    const reason = decision.reason === 'age_unconfirmed' && ageAsked ? 'too_early' : decision.reason;
    return { ...brief, action: 'reply', replyBrief: STEER_BACK_BRIEF[reason] };
  }
  if (decision.kind === 'no_opening')
    return brief.intent === 'flirt' && brief.action === 'reply'
      ? {
          ...brief,
          replyBrief: COMPLIMENT_BRIEF,
          toneHints: [...COMPLIMENT_TONE_HINTS, FLIRT_HINT, NO_OPENING_HINT],
        }
      : {
          ...brief,
          toneHints: [...brief.toneHints, ...(brief.intent === 'flirt' ? [FLIRT_HINT] : []), NO_OPENING_HINT],
        };
  if (decision.kind === 'suggestive_only')
    return { ...brief, toneHints: [...brief.toneHints, SUGGESTIVE_HINT] };
  return brief;
}

/** She waited once already: no second wait, a light « tu es revenu ? » (P3-11). */
export function cameBackIfWaited<B extends ShapedBrief>(within: B, waited: boolean): B {
  return waited && within.action === 'wait'
    ? {
        ...within,
        action: 'reply',
        replyBrief: CAME_BACK_BRIEF,
        toneHints: [...within.toneHints, NO_OPENING_HINT],
      }
    : within;
}

/**
 * The brief once the offer is decided: the step code decided sets the action (a paid one offers, any other answers);
 * an offer refused is written as an answer, nothing to buy.
 */
export function offeredBrief<B extends ShapedBrief>(
  cursored: B,
  scriptStepKind: 'free' | 'paid' | 'bridge' | undefined,
  refused: boolean,
  salesHeld = false,
): B {
  const decidedBrief: B =
    scriptStepKind === undefined
      ? cursored
      : { ...cursored, action: scriptStepKind === 'paid' ? 'offer' : 'reply' };
  return !refused
    ? decidedBrief
    : { ...cursored, action: 'reply', replyBrief: refusedOfferBrief(cursored, salesHeld) };
}

/** What the voice writes in the care mode: the code's brief, whatever the brain or a trap suggested (ADR 0088 § 3). */
export function careBrief<B extends ShapedBrief>(read: B): B {
  return { ...read, action: 'reply', replyBrief: CARE_BRIEF, toneHints: [...CARE_TONE_HINTS] };
}

/** The brief she answers from: the care brief, the custom order's answer, or the brief once the offer is decided. */
export function answeredBrief<B extends ShapedBrief>(
  care: boolean,
  read: B,
  customOrder: CustomOrderDecision | undefined,
  offered: B,
): B {
  return care
    ? careBrief(read)
    : customOrder?.kind === 'reply'
      ? {
          ...offered,
          action: 'reply',
          replyBrief: customOrder.brief,
          toneHints: [...offered.toneHints, NO_OPENING_HINT],
        }
      : offered;
}
