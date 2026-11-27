import { isGuardedLanguage, type Language } from '@impera/contracts';
import type { VoiceInput, VoiceLanguage } from '@impera/llm';

import { checkExplicit } from '../domain/guards';
import { screenNotes } from '../domain/injection';
import { decideLanguage, quietLanguage, type LanguageDecision } from '../domain/language';
import { relationshipTier } from '../domain/meeting';
import { maskOwnHandles } from '../domain/own-accounts';
import { describeMoment, earlierFanTexts, relationshipOf, withTimeNotes } from '../domain/turn-history';

import { VOICE_EXAMPLES_MAX, type VoiceExample } from './calibration-record';
import type { ComposeTurnInput, ComposerPersona } from './compose-types';

/**
 * The language of this turn, decided by code (ADR 0168 § 2): on his messages for an answer, on his kept language for a
 * follow-up or her word after a sale.
 */
function languageOfTurn(persona: ComposerPersona, input: ComposeTurnInput): LanguageDecision {
  const spoken = persona.spokenLanguages;
  const kept = input.keptLanguage ?? null;
  const herLastText = input.history.findLast((turn) => turn.from === 'creator')?.text;
  if (input.followUp !== undefined || input.aftercare !== undefined)
    return quietLanguage(kept?.value ?? null, spoken, herLastText);
  const earlier = earlierFanTexts(input.history);
  const earlierFanText = earlier.at(-1);
  return decideLanguage({
    fanTexts: [input.fanText],
    earlierFanTexts: earlier,
    kept,
    spoken,
    ...(earlierFanText !== undefined && { earlierFanText }),
    ...(herLastText !== undefined && { herLastText }),
  });
}

/** The language as the voice reads it: the decided one, his she does not speak, her examples in hers. */
function voiceLanguageOf(persona: ComposerPersona, decision: LanguageDecision): VoiceLanguage {
  const examples = persona.languageExamples[decision.reply] ?? [];
  return {
    reply: decision.reply,
    notSpoken: decision.notSpoken,
    ...(examples.length > 0 && { examples }),
  };
}

/**
 * The examples this fan's turn may carry (ADR 0102 § 2, § 4): an explicit one only once his adult age is confirmed and
 * he did not ask for nothing explicit, as for her own words (P3-09); then the twelve most recent.
 */
function examplesForTurn(examples: readonly VoiceExample[], explicitAllowed: boolean): VoiceExample[] {
  return examples
    .filter((e) => explicitAllowed || checkExplicit([e.text]).length === 0)
    .slice(0, VOICE_EXAMPLES_MAX);
}

/** The languages her output guard lets through (ADR 0168 § 4): hers that the guards cover. */
export function guardLanguages(persona: ComposerPersona): readonly Language[] {
  return persona.spokenLanguages.filter(isGuardedLanguage);
}

/** Answers the team corrected in the playground, given to the voice as her examples (they take precedence). */
export function withExamples(sheet: string, examples: readonly string[]): string {
  if (examples.length === 0) return sheet;
  return `${sheet}\n\nExemples de ses messages, corrigés par l'équipe :\n${examples.map((e) => `- ${e}`).join('\n')}`;
}

/** What both models read of this turn, before either is called, and what the guards read of where they are. */
export interface PreparedTurn {
  /** His notes screened: the lines kept reach the prompts, those shaped like an order are dropped. */
  readonly notes: { readonly kept: string; readonly dropped: readonly string[] };
  readonly exampleIds: readonly string[];
  readonly language: LanguageDecision;
  readonly voiceLanguage: VoiceLanguage;
  /** The prompt input the brain and the voice share, before the brief and what the turn adds. */
  readonly base: Pick<
    VoiceInput,
    | 'creatorName'
    | 'personaSheet'
    | 'profileBio'
    | 'agencyStyle'
    | 'fanNotes'
    | 'situation'
    | 'history'
    | 'trace'
  >;
  /** His meeting tier, only when her settings let code compute it (`relationshipTier`). */
  readonly meetingTier: number | undefined;
}

export function prepareTurn(persona: ComposerPersona, input: ComposeTurnInput): PreparedTurn {
  const notes = screenNotes(input.fanNotes);
  // Her bio is the platform's text: a line of it shaped like an order never reaches a prompt (ADR 0154 § 3).
  const bio = screenNotes(persona.profileBio ?? '');
  // Her examples for this fan, as his age allows (ADR 0102): a follow-up carries no age, so nothing explicit.
  const examples = examplesForTurn(
    persona.voiceExamples ?? [],
    input.sexualization?.ageConfirmed === true && !input.sexualization.noExplicit,
  );
  const exampleIds = examples.map((e) => e.id);
  const language = languageOfTurn(persona, input);
  const voiceLanguage = voiceLanguageOf(persona, language);
  // The voice's notes are the shared ones only: what is the brain's alone never reaches its prompt (ADR 0085 § 9).
  // Her handles never enter a prompt (Sécurité, 27/11): wherever one is written, its token stands instead.
  const masked = (text: string): string => maskOwnHandles(text, persona.guardSettings.ownAccounts);
  const base = {
    creatorName: persona.creatorName,
    personaSheet: masked(
      withExamples(
        persona.personaSheet,
        examples.map((e) => e.text),
      ),
    ),
    ...(bio.kept.trim() !== '' && { profileBio: masked(bio.kept) }),
    ...(persona.agencyStyle !== undefined && { agencyStyle: persona.agencyStyle }),
    fanNotes: masked(notes.kept),
    situation: describeMoment(input.situation, input.history),
    history: withTimeNotes(input.history, input.situation.timeZone).map((turn) => ({
      ...turn,
      text: masked(turn.text),
    })),
    ...(input.trace !== undefined && { trace: input.trace }),
  };
  // His meeting tier, only when her settings let code compute it: otherwise none, and her close-only words stay closed.
  const meetingTier =
    input.meetingTiers === undefined
      ? undefined
      : relationshipTier(relationshipOf(input.situation), input.meetingTiers);
  return { notes, exampleIds, language, voiceLanguage, base, meetingTier };
}
