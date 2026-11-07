import {
  asPersonaV2,
  type CreatorPersonaSheet,
  type PersonaSheet,
  type StoredPersona,
} from '@impera/contracts';

/**
 * What the creator reads of her persona (recette CREA-01) at format 1, while her screen still shows it: what she is,
 * never how the agency sells. Strategies, follow-ups, notifications, behaviour, extra notes and the file's meta stay
 * out. Null for a version written at format 2, which only `answersOf` reads.
 */
export function sheetOf(persona: StoredPersona): CreatorPersonaSheet | null {
  if ('sheet' in persona) return null;
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

/**
 * Her sheet at format 2, Desirali's seven panels (ADR 0079 § 6), whichever format the version was written in; never
 * « Réglages de l'agent », which stay with the agency.
 */
export function answersOf(persona: StoredPersona): PersonaSheet {
  return asPersonaV2(persona).sheet;
}
