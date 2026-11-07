import {
  TYPICAL_RESPONSES_MAX_LINES,
  type PersonaSampleReplyFault,
  type StoredPersona,
} from '@impera/contracts';

import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, type GuardSettings } from '../domain/guards';

/** The hard guards that refuse a reply: soft ones (length, repetition) do not count. */
const blockingCodes = (reply: string, settings: GuardSettings): PersonaSampleReplyFault['code'][] => [
  ...new Set(
    checkVoiceOutput([reply], settings)
      .filter((violation) => violation.severity === 'blocking')
      .map((violation) => violation.code),
  ),
];

/**
 * The answer of one line of « Réponses typiques »: what follows « situation : » when the line has one, the whole line
 * otherwise. The situation is the fan's moment, not her words, and is never checked.
 */
const replyOfLine = (line: string): string => {
  const at = line.indexOf(' : ');
  return (at === -1 ? line : line.slice(at + 3)).trim();
};

/**
 * Her sample replies read by the hard guards of her own answers, with her forbidden words and emojis: an example the
 * voice imitates must not teach it what a guard would block (a stage direction, a meeting word, an illness to sell…).
 * Format 1: each of `sample_replies` (P5-01). Format 2: each line of « Réponses typiques » (ADR 0079 § 6). Nothing is
 * said of the text.
 */
export function sampleReplyFaults(persona: StoredPersona): PersonaSampleReplyFault[] {
  const rules = 'sheet' in persona ? persona.agent.rules : persona.limits;
  const settings: GuardSettings = {
    ...DEFAULT_GUARD_SETTINGS,
    forbiddenTerms: [...rules.disgusts, ...rules.never_say],
    forbiddenEmojis:
      'sheet' in persona
        ? persona.agent.rules.emojis_forbidden
        : (persona.writing_style?.emojis_forbidden ?? []),
  };
  const replies =
    'sheet' in persona
      ? (persona.sheet.conversation.typical_responses ?? '')
          .split('\n')
          .slice(0, TYPICAL_RESPONSES_MAX_LINES)
          .map(replyOfLine)
      : (persona.sample_replies ?? []).map(({ reply }) => reply);
  return replies.flatMap((reply, index) =>
    reply === '' ? [] : blockingCodes(reply, settings).map((code) => ({ index, code })),
  );
}
