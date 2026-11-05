import type { CreatorPersonaSheet, Persona } from '@impera/contracts';

/**
 * What the creator reads of her persona (recette CREA-01): what she is, never how the agency sells. Strategies,
 * follow-ups, notifications, behaviour, extra notes and the file's meta stay out, whatever the version holds.
 */
export function sheetOf(persona: Persona): CreatorPersonaSheet {
  return {
    details: persona.details,
    lifestyle: persona.lifestyle ?? null,
    tastes: persona.tastes ?? null,
    intimate: persona.intimate ?? null,
    writing_style: persona.writing_style ?? null,
    sample_replies: persona.sample_replies ?? [],
    limits: persona.limits,
  };
}
