import type { Persona, PersonaSampleReplyFault } from '@nirvana/contracts';

import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS } from '../domain/guards';

/**
 * Her sample replies (`sample_replies`, P5-01) read by the hard guards of her own answers, with her forbidden words
 * and emojis: an example the voice imitates must not teach it what a guard would block (a stage direction, a
 * meeting word, an illness to sell…). Soft guards (length, repetition) do not count; nothing is said of the text.
 */
export function sampleReplyFaults(persona: Persona): PersonaSampleReplyFault[] {
  const settings = {
    ...DEFAULT_GUARD_SETTINGS,
    forbiddenTerms: [...persona.limits.disgusts, ...persona.limits.never_say],
    forbiddenEmojis: persona.writing_style?.emojis_forbidden ?? [],
  };
  return (persona.sample_replies ?? []).flatMap(({ reply }, index) => {
    const codes = new Set(
      checkVoiceOutput([reply], settings)
        .filter((violation) => violation.severity === 'blocking')
        .map((violation) => violation.code),
    );
    return [...codes].map((code) => ({ index, code }));
  });
}
