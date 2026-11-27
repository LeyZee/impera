import type { FanAvailabilityRecord } from '@impera/contracts';
import type { LlmGateway, VoiceInput } from '@impera/llm';

import { availabilityChanged } from '../domain/availability';
import { bubbleBudget, type BubbleBudget } from '../domain/bubbles';
import { desireMoved } from '../domain/desire';
import { wantsHumiliation } from '../domain/fantasy-match';
import { salesHeld } from '../domain/frozen-sales';
import { isBlocked } from '../domain/guards';
import type { LanguageDecision } from '../domain/language';
import { screenMedia } from '../domain/traps';
import { quietBriefOf } from '../domain/turn-briefs';
import { guardContextOf } from '../domain/turn-history';
import { stepSendsMedia } from '../domain/turn-scripts';

import { askBrain, type BrainTurn } from './compose-brain';
import { decideTurn, type DecidedTurn } from './compose-decision';
import { guardLanguages, prepareTurn, type PreparedTurn } from './compose-inputs';
import type { ComposedTurn, ComposerPersona, ComposeTurnInput } from './compose-types';
import { asSent, translationOfVoice, voiceTraced, writeAnswer, writeFollowUp } from './compose-voice';

export { NO_EMOJI_HINT } from '../domain/turn-texts';
export { guardContextOf } from '../domain/turn-history';
export type { OfferInput, ScriptsInput } from '../domain/turn-scripts';
export { withExamples } from './compose-inputs';
export { FRENCH_ONLY, type ComposedTurn, type ComposerPersona, type ComposeTurnInput } from './compose-types';
export { asSent } from './compose-voice';

/** Brain, then voice, then guards. Writes nothing and sends nothing: the caller decides what the answer becomes. */
export async function composeTurn(
  gateway: LlmGateway,
  persona: ComposerPersona,
  given: ComposeTurnInput,
): Promise<ComposedTurn> {
  // The same evening never ends before her next day (`sameEvening`): every offer rule reads her time zone.
  const input: ComposeTurnInput =
    given.offer === undefined
      ? given
      : { ...given, offer: { ...given.offer, timeZone: given.offer.timeZone ?? given.situation.timeZone } };
  // Safety flags on his media: a human takes over, nothing is written.
  const screening = screenMedia(input.media);
  if (screening.mustHandoff) return mediaHandoff(screening.flags);
  const prepared = prepareTurn(persona, input);
  // A follow-up or her word after a sale: nothing of his to read, so no brain call.
  if (input.followUp !== undefined || input.aftercare !== undefined) {
    const written = await writeFollowUp(
      gateway,
      persona,
      { ...prepared.base, language: prepared.voiceLanguage },
      quietBriefOf(input.followUp, input.aftercare),
      prepared.notes.dropped,
      prepared.exampleIds,
      prepared.meetingTier,
      guardLanguages(persona),
      // Her aftercare follows a sexual exchange (Sécurité, #1043); a follow-up does not.
      input.followUp === undefined && input.aftercare !== undefined,
    );
    return { ...written, language: prepared.language };
  }
  const brainTurn = await askBrain(gateway, persona, input, prepared);
  const decided = decideTurn(persona, input, brainTurn);
  const { brief } = brainTurn;
  const { customOrder, saleTrouble, scriptStep, waitingStep, sexting, care } = decided;
  if (input.skipVoice?.(brief) === true || customOrder?.kind === 'handoff' || saleTrouble?.kind === 'handoff')
    return skippedTurn(input, brainTurn, decided, prepared.language);
  // He says he loves her or asks to see her: her rule's answer slows him down, and is no brake on a compliment.
  const slowsByRule = brief?.occasion === 'says_love' || decided.meeting !== undefined;
  // Never past her own maximum (her persona's `maxBubbles`).
  // A time-waster gets one bubble (ADR 0135 § 7), as a farewell does.
  const budget =
    decided.farewell === null && input.timeWaster === undefined
      ? bubbleBudget(input.history, persona.guardSettings.maxBubbles)
      : 1;
  const voiceInput: VoiceInput = voiceTraced(
    {
      ...prepared.base,
      language: prepared.voiceLanguage,
      brief: decided.voiceBrief,
      maxBubbles: budget,
      ...(decided.objectionReply !== undefined && { objectionReply: decided.objectionReply.text }),
      ...(scriptStep !== undefined && { scriptStep }),
      ...(waitingStep !== undefined && { waitingStep }),
      ...(decided.fantasy !== undefined && { fantasy: decided.fantasy }),
      ...(sexting.currentStepSheet !== undefined && { currentStepSheet: sexting.currentStepSheet }),
      ...(decided.complaint &&
        sexting.boughtMediaSheet !== undefined && { boughtMediaSheet: sexting.boughtMediaSheet }),
    },
    prepared.exampleIds,
  );
  // The one price she may write: the paid step she brings, or the one waiting he asks how to open (ADR 0156 § 4).
  const allowedPriceMinor = scriptStep?.price?.amountMinor ?? waitingStep?.price.amountMinor;
  const answer = await writeAnswer(gateway, persona, voiceInput, {
    budget,
    inAction: sexting.inAction,
    context: {
      ...guardContextOf(input.history, stepSendsMedia(decided.scripts), allowedPriceMinor, {
        // A heated reading of his message, outside care: the same test as her register's.
        flirting: sexting.register !== null,
        ...(prepared.meetingTier !== undefined && { meetingTier: prepared.meetingTier }),
        ...(wantsHumiliation(brainTurn.desireMap) && { humiliationWanted: true }),
      }),
      languages: guardLanguages(persona),
    },
    checksExplicit: !(decided.ageConfirmed && !decided.noExplicit && !care),
    sexualTurn: sexting.sexualTurn,
    veryExplicit: sexting.register === 'very_explicit',
    inPlay: sexting.inPlay,
    otherManWanted: sexting.otherManWanted,
    care,
    // His frozen sales hold nothing on a turn where the policy let an offer go (money trouble lifted by his own ask).
    salesHeld:
      salesHeld(input.offer?.flags) && scriptStep === undefined && decided.voiceBrief.action !== 'offer',
    checksCommitment: customOrder !== undefined || sexting.suggestsCustom || decided.moreTonight,
    // He did not go there and she does not open it: she welcomes him, never slows him down (Charles, 20/11). Once the
    // intimate is open, « pas si vite 😏 » is a tease of hers (relecture Bilan de #876).
    // Not on his « je t'aime » nor his asking to see her: « c'est tôt, on se connaît à peine » is then the rule's own
    // answer (passe 2 du 26/11, conversation 21).
    checksWelcome: decided.sexualization?.kind === 'no_opening' && !care && !slowsByRule,
    worn: decided.worn,
  });
  return answeredTurn(persona, input, brainTurn, decided, prepared, { voiceInput, budget, answer });
}

/** His media carry a safety flag: a human takes over, nothing was written and nothing was called. */
function mediaHandoff(flags: readonly string[]): ComposedTurn {
  return {
    handoff: flags,
    bubbles: [],
    violations: [],
    isBlocked: true,
    costUsd: 0,
    latencyMs: 0,
    isFallback: false,
  };
}

/** His availability as the turn returns it: the record, and whether it changed (only then is it journaled). */
function availabilityOut(
  input: ComposeTurnInput,
  decided: DecidedTurn,
  record: FanAvailabilityRecord | undefined,
) {
  const { scriptStart } = decided.moment;
  return record === undefined
    ? {}
    : {
        availability: { record, changed: availabilityChanged(input.availability ?? null, record) },
        ...(scriptStart !== undefined && { scriptStart }),
      };
}

/** What the brain read and code decided, as every answered or skipped turn returns it. */
function readingOut(brainTurn: BrainTurn, decided: DecidedTurn) {
  const { brain, brief, droppedNotes } = brainTurn;
  const { trap, sexualization, desire, ageDeclared } = decided;
  return {
    ...(trap.isTrap && { trap }),
    ...(droppedNotes.length > 0 && { droppedNotes }),
    ...(brief && { brief }),
    ...(!brain.ok && { briefFailure: brain.error }),
    ...(sexualization !== undefined && { sexualization }),
    ...(desire !== undefined && desireMoved(desire) && { desire }),
    ...(desire !== undefined && { desireRead: desire }),
    ...(ageDeclared !== null && { ageDeclared }),
  };
}

const brainCostOf = ({ brain }: BrainTurn) => ({
  costUsd: brain.ok ? (brain.value.meta.costUsd ?? 0) : 0,
  latencyMs: brain.ok ? brain.value.meta.latencyMs : 0,
});

/** The voice is not called: `skipVoice` stopped it, a chatter takes his order, or a human answers his trouble. */
function skippedTurn(
  input: ComposeTurnInput,
  brainTurn: BrainTurn,
  decided: DecidedTurn,
  language: LanguageDecision,
): ComposedTurn {
  const { customOrder, saleTrouble, customOrderKept, scripts, offerRefused } = decided;
  const brainCost = brainCostOf(brainTurn);
  return {
    ...(customOrder !== undefined && { customOrder }),
    ...(saleTrouble !== undefined && { saleTrouble }),
    ...(customOrderKept !== undefined && { customOrderTurn: customOrderKept }),
    ...(scripts !== undefined && { scripts }),
    ...availabilityOut(input, decided, decided.moment.availabilityKept),
    ...readingOut(brainTurn, decided),
    ...(offerRefused !== undefined && { offerRefused }),
    bubbles: [],
    violations: [],
    isBlocked: true,
    costUsd: brainCost.costUsd,
    latencyMs: brainCost.latencyMs,
    isFallback: false,
    isSkipped: true,
    language,
  };
}

/** The turn the voice answered, read by every guard, with what the caller records for it. */
function answeredTurn(
  persona: ComposerPersona,
  input: ComposeTurnInput,
  brainTurn: BrainTurn,
  decided: DecidedTurn,
  prepared: PreparedTurn,
  written: {
    readonly voiceInput: VoiceInput;
    readonly budget: BubbleBudget;
    readonly answer: Awaited<ReturnType<typeof writeAnswer>>;
  },
): ComposedTurn {
  const { customOrder, customOrderKept, objectionReply, scripts, care, teases, meeting, offerRefused } =
    decided;
  const { availabilityKept } = decided.moment;
  const { voice, written: kept, violations, retried, firstCostUsd } = written.answer;
  const brainCost = brainCostOf(brainTurn);
  return {
    ...(customOrder !== undefined && { customOrder }),
    ...(customOrderKept !== undefined && { customOrderTurn: customOrderKept }),
    ...(objectionReply !== undefined && { objectionReply }),
    ...(scripts !== undefined && { scripts }),
    // She asked only if the voice wrote: a question never written is asked again.
    ...availabilityOut(
      input,
      decided,
      availabilityKept !== undefined && decided.asking && voice.ok
        ? { ...availabilityKept, askedAt: input.situation.now }
        : availabilityKept,
    ),
    ...readingOut(brainTurn, decided),
    ...(offerRefused !== undefined && !care && { offerRefused }),
    ...(care && { care: true }),
    ...(decided.saleTrouble !== undefined && { saleTrouble: decided.saleTrouble }),
    // Teased only if the voice wrote it: a tease never written is still due.
    ...(teases !== null && voice.ok && { abandonTeased: teases }),
    ...(meeting !== undefined && voice.ok && { meetingAnswer: meeting }),
    voiceBrief: decided.voiceBrief,
    voiceInput: written.voiceInput,
    bubbles: asSent(kept, persona.splitMessages, persona.guardSettings.form),
    ...translationOfVoice(voice, prepared.voiceLanguage.reply, written.budget, persona.splitMessages),
    ...(!voice.ok && { voiceFailure: voice.error }),
    violations,
    sexualTurn: decided.sexting.sexualTurn,
    ...(retried !== undefined && { retried }),
    // Still nothing to send after the second try: a human answers.
    isBlocked: isBlocked(violations) || !voice.ok || kept.length === 0,
    costUsd: brainCost.costUsd + firstCostUsd + (voice.ok ? (voice.value.meta.costUsd ?? 0) : 0),
    latencyMs: brainCost.latencyMs + (voice.ok ? voice.value.meta.latencyMs : 0),
    ...(voice.ok && { model: voice.value.meta.model }),
    isFallback: voice.ok && voice.value.meta.isFallback,
    ...(retried !== undefined && { rewritten: true }),
    language: prepared.language,
  };
}
