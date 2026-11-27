import type { GuardCode, Language } from '@impera/contracts';
import type { Brief, BuyerType, CallTrace, LlmGateway, VoiceInput, VoiceScriptStep } from '@impera/llm';

import { fitBubbles, type BubbleBudget } from '../domain/bubbles';
import { checkCare, checkHelpNumber } from '../domain/care';
import { checkNoCommitment } from '../domain/custom-order';
import { DEFAULT_FORM_SETTINGS, formBubbles, type FormSettings } from '../domain/form';
import { checkDeferredSale } from '../domain/frozen-sales';
import {
  checkExplicit,
  checkMoans,
  checkMoodKillers,
  checkVoiceOutput,
  checkYouthWords,
  isBlocked,
  wantsRewrite,
  type GuardContext,
  type GuardViolation,
} from '../domain/guards';
import { translationOf } from '../domain/language';
import type { ScriptTurn } from '../domain/script-turn';
import { checkWelcome } from '../domain/sexualization';
import { withoutEmojiIfDue } from '../domain/turn-briefs';
import { guardContextOf } from '../domain/turn-history';
import { blockingCodes, rewriteHint } from '../domain/turn-texts';
import { checkWorn } from '../domain/worn';

import type { ComposedTurn, ComposerPersona } from './compose-types';

type VoiceResult = Awaited<ReturnType<LlmGateway['voice']>>;

/**
 * What the fan receives: her bubbles in her form (`formBubbles`, once the guards have read them), or one message when
 * she does not split hers. Only the voice's bubbles come here: a bubble the code writes (care's help) is added after.
 */
export function asSent(
  bubbles: readonly string[],
  splitMessages = true,
  form: FormSettings = DEFAULT_FORM_SETTINGS,
): readonly string[] {
  const formed = formBubbles(bubbles, form);
  return splitMessages || formed.length <= 1 ? formed : [formed.join('\n')];
}

/** A voice call names the examples of hers it received (ADR 0102 § 6); the brain's call, which writes nothing, does not. */
export function voiceTraced<T extends { readonly trace?: CallTrace }>(input: T, ids: readonly string[]): T {
  return ids.length === 0 ? input : { ...input, trace: { ...input.trace, voiceExampleIds: ids } };
}

/**
 * Her answer in French as the bubbles that leave are cut (ADR 0168 § 9): the voice's French, kept only one per bubble
 * it wrote, then fitted and joined like them. Absent when she writes in French or it does not fit.
 */
export function translationOfVoice(
  voice: VoiceResult,
  reply: Language,
  budget: BubbleBudget,
  splitMessages: boolean | undefined,
): { readonly translation?: readonly string[] } {
  if (!voice.ok) return {};
  const french = translationOf(reply, voice.value.output.bubbles, voice.value.output.translation);
  return french === null ? {} : { translation: asSent(fitBubbles(french, budget), splitMessages) };
}

/**
 * How he buys (Charles 26/11): nothing the code holds tells it reliably yet (his spend says how much, not how), so it
 * is `unknown` and the voice is told nothing. The price never moves with it.
 */
const buyerTypeOf = (): BuyerType => 'unknown';

/** The step decided, as the voice's typed block says it: kind, catalogue price, instruction, media (ADR 0098 § 5). */
export function voiceStepOf(turn: ScriptTurn | undefined): VoiceScriptStep | undefined {
  const { decision, script } = turn ?? {};
  if (script === undefined || script === null) return undefined;
  if (decision?.kind !== 'start' && decision?.kind !== 'send_step') return undefined;
  const step = script.steps[decision.step.stepIndex];
  if (step === undefined) return undefined;
  const buyerType = buyerTypeOf();
  return {
    kind: decision.step.kind,
    // Reveal sells in euros: the catalogue's minor units are cents.
    price:
      decision.step.priceMinor === null ? null : { amountMinor: decision.step.priceMinor, currency: 'EUR' },
    instruction: step.instruction ?? null,
    mediaSheet: step.mediaSheet ?? null,
    ...(buyerType !== 'unknown' && { buyerType }),
  };
}

/**
 * A follow-up: the voice from the code's brief, then every guard, the explicit one whatever his age. No trap, cursor
 * or offer to decide: there is no new message of his.
 */
export async function writeFollowUp(
  gateway: LlmGateway,
  persona: ComposerPersona,
  base: Omit<VoiceInput, 'brief'>,
  brief: Brief,
  droppedNotes: readonly string[],
  exampleIds: readonly string[],
  meetingTier: number | undefined,
  languages: readonly Language[],
  sexual = false,
): Promise<ComposedTurn> {
  // A follow-up: nothing of his awaits, one bubble.
  const voiceInput: VoiceInput = voiceTraced(
    { ...base, brief: withoutEmojiIfDue(brief, base.history, persona.guardSettings), maxBubbles: 1 },
    exampleIds,
  );
  const voice = await gateway.voice(voiceInput);
  const written = voice.ok ? fitBubbles(voice.value.output.bubbles, 1) : [];
  const violations = [
    ...checkVoiceOutput(written, persona.guardSettings, {
      ...guardContextOf(base.history, false, undefined, meetingTier === undefined ? {} : { meetingTier }),
      languages,
    }),
    ...checkExplicit(written),
    // Model text only: the help number is the code's (ADR 0088 § 4).
    ...checkHelpNumber(written),
    // As the main answer (Sécurité, #1043): her aftercare follows a sexual exchange.
    ...checkYouthWords(written, sexual),
  ];
  return {
    ...(droppedNotes.length > 0 && { droppedNotes }),
    brief,
    voiceBrief: brief,
    voiceInput,
    bubbles: asSent(written, persona.splitMessages, persona.guardSettings.form),
    ...translationOfVoice(voice, base.language?.reply ?? 'french', 1, persona.splitMessages),
    ...(!voice.ok && { voiceFailure: voice.error }),
    violations,
    isBlocked: isBlocked(violations) || !voice.ok || written.length === 0,
    costUsd: voice.ok ? (voice.value.meta.costUsd ?? 0) : 0,
    latencyMs: voice.ok ? voice.value.meta.latencyMs : 0,
    ...(voice.ok && { model: voice.value.meta.model }),
    isFallback: voice.ok && voice.value.meta.isFallback,
  };
}

/** In the middle of the action she may write longer bubbles to tell what she feels (Charles 26/11 at 23:09). */
const ACTION_BUBBLE_FACTOR = 2;

/** What the guards of an answer read besides her bubbles: the turn as code decided it. */
export interface AnswerGuards {
  readonly budget: BubbleBudget;
  readonly inAction: boolean;
  readonly context: GuardContext;
  /** The explicit guard reads her answer: his adult age not confirmed, nothing explicit asked, or care. */
  readonly checksExplicit: boolean;
  readonly sexualTurn: boolean;
  readonly veryExplicit: boolean;
  readonly inPlay: boolean;
  readonly otherManWanted: boolean;
  readonly care: boolean;
  /** His sales frozen (`salesHeld`): nothing promised for later either (eval pass of 27/11). */
  readonly salesHeld: boolean;
  readonly checksCommitment: boolean;
  readonly checksWelcome: boolean;
  readonly worn: readonly string[];
}

/** The written answer, as the guards read it once she wrote again if she had to. */
export interface WrittenAnswer {
  readonly voice: VoiceResult;
  readonly written: readonly string[];
  readonly violations: readonly GuardViolation[];
  /** The blocking codes of a first answer written again (IA-08); absent when it went through. */
  readonly retried?: readonly GuardCode[];
  /** What the first answer cost when it was written again: counted with the second. */
  readonly firstCostUsd: number;
}

/**
 * Her answer from the voice, read by every guard. Past the budget, left out, never glued nor sent at once (Charles
 * 16/11 : « trois rarement »). Checked as kept: the guards read the bubbles that leave.
 */
export async function writeAnswer(
  gateway: LlmGateway,
  persona: ComposerPersona,
  voiceInput: VoiceInput,
  guards: AnswerGuards,
): Promise<WrittenAnswer> {
  const attempt = async (asked: VoiceInput) => {
    const voice = await gateway.voice(asked);
    const written = voice.ok ? fitBubbles(voice.value.output.bubbles, guards.budget) : [];
    const violations = [
      ...checkVoiceOutput(
        written,
        guards.inAction
          ? {
              ...persona.guardSettings,
              maxBubbleChars: persona.guardSettings.maxBubbleChars * ACTION_BUBBLE_FACTOR,
            }
          : persona.guardSettings,
        guards.context,
      ),
      ...(guards.checksExplicit ? checkExplicit(written) : []),
      // No word of youth in a sexual message (Charles 26/11): heated, or her script running.
      ...checkYouthWords(written, guards.sexualTurn),
      // Written sounds of pleasure only at the frankest rung; what kills the sexting while her script runs (Charles 26/11).
      ...(guards.sexualTurn ? checkMoans(written, guards.veryExplicit) : []),
      ...(guards.inPlay ? checkMoodKillers(written, guards.otherManWanted) : []),
      ...(guards.care ? checkCare(written) : []),
      // Model text only, care or not: the help number is the code's, added after these guards (ADR 0088 § 4). In care,
      // a crisis number alone is enough (eval pass of 27/11).
      ...checkHelpNumber(written, guards.care),
      ...(guards.salesHeld ? checkDeferredSale(written, guards.context.fanLastMessage) : []),
      ...(guards.checksCommitment ? checkNoCommitment(written) : []),
      ...(guards.checksWelcome ? checkWelcome(written) : []),
      ...checkWorn(written, guards.worn),
    ];
    return { voice, written, violations };
  };
  const first = await attempt(voiceInput);
  // A guard blocked her answer: the voice writes it once more, told what was wrong, before a human is called (audit
  // du 16/11, M1). The second answer is read by the same guards; still blocked, a human answers. A formula she already
  // used with him is rewritten once the same way, and the second answer goes even if it still has one (passe 1).
  // Nothing left once her hollow bubbles dropped (« . »): written again the same way (passe 2, conversation 37).
  const retried =
    first.voice.ok && (wantsRewrite(first.violations) || first.written.length === 0)
      ? await attempt({
          ...voiceInput,
          brief: {
            ...voiceInput.brief,
            toneHints: [...voiceInput.brief.toneHints, rewriteHint(first.violations)],
          },
        })
      : undefined;
  const { voice, written, violations } = retried ?? first;
  return {
    voice,
    written,
    violations,
    ...(retried !== undefined && { retried: blockingCodes(first.violations) }),
    firstCostUsd: retried !== undefined && first.voice.ok ? (first.voice.value.meta.costUsd ?? 0) : 0,
  };
}
