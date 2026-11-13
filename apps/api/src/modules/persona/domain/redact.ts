import type { PersonaOverview, PersonaV2, StoredPersona } from '@impera/contracts';

/**
 * Her objection replies are part of the agency's method (ADR 0090 § B): only the owner, who alone writes her
 * persona, reads them. Anyone else reads her versions with an empty bank; the agent reads hers in the worker.
 */
export function withoutObjectionReplies(overview: PersonaOverview): PersonaOverview {
  const { latest } = overview;
  if (latest === null) return overview;
  return {
    ...overview,
    latest: { ...latest, persona: storedWithout(latest.persona), draft: draftWithout(latest.draft) },
  };
}

const draftWithout = (draft: PersonaV2): PersonaV2 => ({
  ...draft,
  agent: { ...draft.agent, objection_replies: {} },
});

/** A version stored at format 1 has no bank: it stays as it is. */
const storedWithout = (persona: StoredPersona): StoredPersona =>
  'sheet' in persona ? draftWithout(persona) : persona;
