import {
  ageOn,
  asPersonaV2,
  type ChatterPersonaSheet,
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

/**
 * What a chatter reads of her on shift (ADR 0153), from her version at either format: each field named, so a field
 * added to the persona stays hidden until an ADR adds it. Her age on `today` (her clock), never her birth date.
 */
export function chatterSheetOf(persona: StoredPersona, today: string): ChatterPersonaSheet {
  const { sheet, agent } = asPersonaV2(persona);
  const { identity, relationships, intimacy } = sheet;
  const { no_go_zones, ...intimate } = intimacy;
  return {
    her: {
      nickname: identity.nickname,
      age: ageOn(identity.birth_date, today),
      city: identity.city,
      country: identity.country,
      job: identity.job,
      spoken_languages: identity.spoken_languages,
      relationship_status: relationships.relationship_status,
      kids_status: relationships.kids_status,
    },
    physique: {
      physical_description: identity.physical_description,
      height_m: identity.height_m,
      weight_kg: identity.weight_kg,
      eye_color: identity.eye_color,
      hair_color: identity.hair_color,
      breast_size: identity.breast_size,
      shoe_size: identity.shoe_size,
    },
    lifestyle: sheet.lifestyle,
    preferences: sheet.preferences,
    writing: {
      ...sheet.conversation,
      pet_names: agent.behavior.pet_names,
      emojis_forbidden: agent.rules.emojis_forbidden,
    },
    limits: {
      never_do: agent.rules.never_do,
      never_show: agent.rules.never_show,
      never_say: agent.rules.never_say,
      disgusts: agent.rules.disgusts,
      off_limits: sheet.boundaries.off_limits,
      no_go_zones,
      turn_offs: relationships.turn_offs,
    },
    intimate: { ...intimate, turn_ons: relationships.turn_ons, body_count: relationships.body_count },
  };
}
