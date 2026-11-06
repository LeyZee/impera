import { z } from 'zod';

import {
  ageOn,
  LANGUAGES,
  MAX_CREATOR_AGE,
  MIN_CREATOR_AGE,
  PERSONA_BOUNDS,
  PERSONA_OPTIONS,
  PersonaAgentRulesSchema,
  PersonaFollowUpsSchema,
  PersonaNotificationsSchema,
  PersonaSchema,
  PersonaStrategiesSchema,
  type Persona,
} from './persona';

/**
 * The persona sheet at format 2 (ADR 0079): Desirali's sheet, section by section and question by question, with its
 * keys, its French labels word for word, its order and its layout; then « Réglages de l'agent », what the code applies.
 * Every answer of the sheet is free text the model reads, never a rule. Format 1 (`PersonaSchema`) is still read, and
 * converted by `personaSheetFromV1`. Field reference: docs/reference/persona-schema.md.
 */

/** How a question is answered: one line, several lines, or one of the six answers that are not free text. */
export type SheetQuestionKind = 'short' | 'long' | 'date' | 'decimal' | 'integer' | 'timezone' | 'languages';
/** Its width on the screen, as Desirali lays it out: the whole row, half of it or a third. */
export type SheetQuestionWidth = 'full' | 'half' | 'third';

export interface SheetQuestion {
  /** Desirali's key; `timezone` alone is not in the file: the sheet shows `creators.timezone` (ADR 0079 § 3). */
  readonly key: string;
  readonly label: string;
  readonly kind: SheetQuestionKind;
  readonly width: SheetQuestionWidth;
  /** The help line Desirali shows under the field, word for word. */
  readonly help?: string;
  readonly required?: true;
}

export interface SheetSection {
  readonly key: PersonaSheetSectionKey;
  /** Null for the last panel, which Desirali shows without a title. */
  readonly title: string | null;
  /** The icon left of the title on Desirali's panel, named, for the screen to draw its own. */
  readonly icon: 'pin' | 'house' | 'palette' | 'bubble' | 'heart' | 'flame' | 'shield';
  readonly questions: readonly SheetQuestion[];
}

export const PERSONA_SHEET_SECTION_KEYS = [
  'identity',
  'lifestyle',
  'preferences',
  'conversation',
  'relationships',
  'intimacy',
  'boundaries',
] as const;
export type PersonaSheetSectionKey = (typeof PERSONA_SHEET_SECTION_KEYS)[number];

const q = (
  key: string,
  label: string,
  kind: SheetQuestionKind,
  width: SheetQuestionWidth,
  extra: { help?: string; required?: true } = {},
): SheetQuestion => ({ key, label, kind, width, ...extra });

/** Desirali's sheet as its screen shows it (06/11/2026): 7 panels, 59 questions, in this order. */
export const PERSONA_SHEET: readonly SheetSection[] = [
  {
    key: 'identity',
    title: 'Identité et informations de base',
    icon: 'pin',
    questions: [
      q('physical_description', 'Description physique', 'long', 'full'),
      q('shoe_size', 'Pointure', 'short', 'third'),
      q('birth_date', 'Date de naissance', 'date', 'third', { required: true }),
      q('height_m', 'Taille (m)', 'decimal', 'third'),
      q('weight_kg', 'Poids (kg)', 'decimal', 'third'),
      q('country', 'Pays', 'short', 'third'),
      q('city', 'Ville', 'short', 'third'),
      q('nickname', 'Surnom', 'short', 'half', { required: true }),
      q('job', 'Profession', 'short', 'half'),
      q('eye_color', 'Couleur des yeux', 'short', 'half'),
      q('hair_color', 'Couleur des cheveux', 'short', 'half'),
      q('breast_size', 'Taille de poitrine', 'short', 'half'),
      q('place_of_life', 'Lieu de vie', 'short', 'half'),
      q('timezone', 'Fuseau horaire', 'timezone', 'half'),
      q('spoken_languages', 'Langues parlées', 'languages', 'half', {
        help: 'Sélectionnez les langues que le modèle parle couramment',
        required: true,
      }),
    ],
  },
  {
    key: 'lifestyle',
    title: 'Mode de vie',
    icon: 'house',
    questions: [
      q('smoking_habit', 'Habitude de fumer', 'short', 'half'),
      q('drinking_habit', "Consommation d'alcool", 'short', 'half'),
      q('traveling', 'Voyages', 'long', 'full'),
      q('routines', 'Routines et habitudes quotidiennes', 'long', 'full'),
      q('pets', 'Animaux de compagnie', 'short', 'half'),
      q('dream_car', 'Voiture préférée', 'short', 'half'),
    ],
  },
  {
    key: 'preferences',
    title: 'Préférences',
    icon: 'palette',
    questions: [
      q('favorite_color', 'Couleur préférée', 'short', 'half'),
      q('least_favorite_color', 'Couleur la moins aimée', 'short', 'half'),
      q('passions', 'Passions', 'long', 'full'),
      q('favorite_dishes', 'Plats préférés', 'long', 'full'),
      q('least_liked_dishes', 'Plats les moins aimés', 'long', 'full'),
      q('religion', 'Religion', 'long', 'full'),
      q('music_genres', 'Genres musicaux préférés', 'long', 'full'),
      q('favorite_movies', 'Films préférés', 'long', 'full'),
      q('favorite_celebrities', 'Célébrités préférées', 'long', 'full'),
      q('favorite_characters', 'Personnages préférés', 'long', 'full'),
      q('favorite_books', 'Livres préférés', 'long', 'full'),
    ],
  },
  {
    key: 'conversation',
    title: 'Style de conversation',
    icon: 'bubble',
    questions: [
      q('roleplaying_description', 'Description du jeu de rôle', 'long', 'full'),
      q('favourite_emojis', 'Émojis favoris', 'short', 'full'),
      q('conversation_description', 'Description de la conversation', 'long', 'full', {
        help: 'Décrivez le ton, le style ou les sujets de conversation typiques.',
      }),
      q('spelling_description', "Style d'orthographe", 'long', 'full'),
      q('compliment_description', 'Style de compliments', 'long', 'full'),
      q('flirt_description', 'Style de flirt', 'long', 'full'),
      q('common_expressions', 'Expressions courantes', 'long', 'full'),
      q('typical_responses', 'Réponses typiques', 'long', 'full'),
    ],
  },
  {
    key: 'relationships',
    title: 'Relations',
    icon: 'heart',
    questions: [
      q('relationship_status', 'Statut relationnel', 'short', 'full'),
      q('kids_status', 'Situation familiale / enfants', 'short', 'full'),
      q('body_count', 'Nombre de partenaires sexuels', 'integer', 'half'),
      q('turn_ons', 'Ce qui vous attire', 'long', 'full'),
      q('turn_offs', 'Ce qui vous repousse chez un homme', 'long', 'full'),
      q('ideal_man', 'Partenaire idéal', 'long', 'full'),
      q('ideal_date', 'Rendez-vous idéal', 'long', 'full'),
    ],
  },
  {
    key: 'intimacy',
    title: 'Intimité',
    icon: 'flame',
    questions: [
      q('libido_level', "Niveau d'envie/besoin de sexe dans la vie", 'short', 'full'),
      q('domination_preference', 'Préférence de domination', 'short', 'half'),
      q('style_in_private', 'Style en privé', 'short', 'full'),
      q('sex_toys', 'Jouets sexuels', 'short', 'full'),
      q('squirting', 'Femme fontaine', 'short', 'full'),
      q('cum', "Rapport à l'éjaculation", 'short', 'full'),
      q('kinks', 'Pratiques / Kinks', 'long', 'full'),
      q('fetichism', 'Fétichisme', 'long', 'full'),
      q('favorite_positions', 'Positions préférées', 'long', 'full'),
      q('fantasies', 'Fantasmes', 'long', 'full'),
      q('no_go_zones', 'Zones interdites / limites strictes', 'long', 'full'),
    ],
  },
  {
    key: 'boundaries',
    title: null,
    icon: 'shield',
    questions: [q('off_limits', 'Zones interdites', 'long', 'full')],
  },
];

/** The number of questions of the sheet, the completion's denominator (ADR 0079 § 6). */
export const PERSONA_SHEET_QUESTION_COUNT = PERSONA_SHEET.reduce((n, s) => n + s.questions.length, 0);

/** Lengths of the free answers: Desirali's one-line fields often hold paragraphs, so both are generous. */
export const SHEET_SHORT_MAX = 1000;
export const SHEET_LONG_MAX = 4000;
/** Lines of « Réponses typiques » at most: each one is checked by the hard guards. */
export const TYPICAL_RESPONSES_MAX_LINES = 200;

/** Bounds of the four numbers of the sheet. */
export const PERSONA_SHEET_BOUNDS = {
  heightM: [1.3, 2.1],
  weightKg: PERSONA_BOUNDS.weightKg,
  bodyCount: [0, 10000],
} as const satisfies Record<string, readonly [number, number]>;

/** A free answer: trimmed, null when she left it empty (the screen sends null, never an empty string). */
const answer = (max: number) => z.string().trim().min(1).max(max).nullable();
const short = answer(SHEET_SHORT_MAX);
const long = answer(SHEET_LONG_MAX);
const between = ([min, max]: readonly [number, number]) => z.number().min(min).max(max);

export const PersonaIdentitySchema = z.strictObject({
  physical_description: long,
  shoe_size: short,
  birth_date: z.iso.date(),
  height_m: between(PERSONA_SHEET_BOUNDS.heightM).nullable(),
  weight_kg: between(PERSONA_SHEET_BOUNDS.weightKg).nullable(),
  country: short,
  city: short,
  /** The name the agent writes as, the one she wants fans to use. */
  nickname: z.string().trim().min(1).max(40),
  job: short,
  eye_color: short,
  hair_color: short,
  breast_size: short,
  place_of_life: short,
  /** At least one: the first is the language of her answers. */
  spoken_languages: z
    .array(z.enum(LANGUAGES))
    .min(1)
    .refine((list) => new Set(list).size === list.length, { message: 'Valeur en double' }),
});

export const PersonaLifestyleSheetSchema = z.strictObject({
  smoking_habit: short,
  drinking_habit: short,
  traveling: long,
  routines: long,
  pets: short,
  dream_car: short,
});

export const PersonaPreferencesSchema = z.strictObject({
  favorite_color: short,
  least_favorite_color: short,
  passions: long,
  favorite_dishes: long,
  least_liked_dishes: long,
  religion: long,
  music_genres: long,
  favorite_movies: long,
  favorite_celebrities: long,
  favorite_characters: long,
  favorite_books: long,
});

export const PersonaConversationSchema = z.strictObject({
  roleplaying_description: long,
  favourite_emojis: short,
  conversation_description: long,
  spelling_description: long,
  compliment_description: long,
  flirt_description: long,
  common_expressions: long,
  /**
   * One answer per line, each checked against the hard guards when a version is stored, like the sample replies of
   * format 1: past `TYPICAL_RESPONSES_MAX_LINES` lines, a line would reach the model unchecked, so it is refused.
   */
  typical_responses: long.refine(
    (text) => text === null || text.split('\n').length <= TYPICAL_RESPONSES_MAX_LINES,
    { message: `${String(TYPICAL_RESPONSES_MAX_LINES)} lignes au plus` },
  ),
});

export const PersonaRelationshipsSchema = z.strictObject({
  relationship_status: short,
  kids_status: short,
  /** Passed to the model only when filled (ADR 0079 § 3). */
  body_count: z
    .int()
    .min(PERSONA_SHEET_BOUNDS.bodyCount[0])
    .max(PERSONA_SHEET_BOUNDS.bodyCount[1])
    .nullable(),
  turn_ons: long,
  turn_offs: long,
  ideal_man: long,
  ideal_date: long,
});

export const PersonaIntimacySchema = z.strictObject({
  libido_level: short,
  domination_preference: short,
  style_in_private: short,
  sex_toys: short,
  squirting: short,
  cum: short,
  kinks: long,
  fetichism: long,
  favorite_positions: long,
  fantasies: long,
  no_go_zones: long,
});

export const PersonaBoundariesSchema = z.strictObject({
  off_limits: long,
});

/** The seven panels of the sheet, under their keys. */
export const PersonaSheetSchema = z.strictObject({
  identity: PersonaIdentitySchema,
  lifestyle: PersonaLifestyleSheetSchema,
  preferences: PersonaPreferencesSchema,
  conversation: PersonaConversationSchema,
  relationships: PersonaRelationshipsSchema,
  intimacy: PersonaIntimacySchema,
  boundaries: PersonaBoundariesSchema,
});
export type PersonaSheet = z.infer<typeof PersonaSheetSchema>;

/** How she writes, as the code applies it when sending (CLAUDE.md rule 3). */
export const PersonaAgentBehaviorSchema = z.strictObject({
  split_messages: z.boolean(),
  /** The only pet names she gives fans: guards refuse any other. */
  pet_names: PersonaSchema.shape.behavior.shape.pet_names,
  response_delay_minutes: PersonaSchema.shape.behavior.shape.response_delay_minutes,
});

/** « Réglages de l'agent » (ADR 0079 § 4): versioned with the sheet, applied by the code, never a question of hers. */
export const PersonaAgentSettingsSchema = z.strictObject({
  strategies: PersonaStrategiesSchema,
  follow_ups: PersonaFollowUpsSchema,
  notifications: PersonaNotificationsSchema,
  behavior: PersonaAgentBehaviorSchema,
  rules: PersonaAgentRulesSchema,
});
export type PersonaAgentSettings = z.infer<typeof PersonaAgentSettingsSchema>;

export const PersonaV2MetaSchema = PersonaSchema.shape.meta.extend({ schema: z.literal(2) });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ageAtVersion = (p: { meta: { created_at: string }; sheet: { identity: { birth_date: string } } }) =>
  ISO_DATE.test(p.sheet.identity.birth_date) && ISO_DATE.test(p.meta.created_at)
    ? ageOn(p.sheet.identity.birth_date, p.meta.created_at)
    : null;

export const PersonaV2Schema = z
  .strictObject({
    meta: PersonaV2MetaSchema,
    sheet: PersonaSheetSchema,
    agent: PersonaAgentSettingsSchema,
  })
  // Runs even when a date failed its own check (an emptied field): that field already says so, `ageOn` would throw.
  .refine((p) => (ageAtVersion(p) ?? MIN_CREATOR_AGE) >= MIN_CREATOR_AGE, {
    message: `La créatrice doit avoir au moins ${String(MIN_CREATOR_AGE)} ans à la date de la version`,
    path: ['sheet', 'identity', 'birth_date'],
  })
  .refine((p) => (ageAtVersion(p) ?? 0) < MAX_CREATOR_AGE, {
    message: `Plus de ${String(MAX_CREATOR_AGE)} ans : vérifie l’année de naissance`,
    path: ['sheet', 'identity', 'birth_date'],
  });
export type PersonaV2 = z.infer<typeof PersonaV2Schema>;

/** A stored version, whichever format it was written in: both are read, a version is never rewritten (ADR 0079 § 5). */
export const StoredPersonaSchema = z.union([PersonaSchema, PersonaV2Schema]);
export type StoredPersona = z.infer<typeof StoredPersonaSchema>;

/** A sheet answer, as `PersonaSheet` holds it, read by key. */
type Answer = string | number | readonly string[] | null;

/** The answers of one section, by key: what the screen, the completion and the model iterate on. */
export function sectionAnswers(
  sheet: PersonaSheet,
  section: PersonaSheetSectionKey,
): Readonly<Record<string, Answer>> {
  return sheet[section];
}

/** Whether a question holds an answer; the time zone always does, it is the creator's own (ADR 0079 § 3). */
function answered(sheet: PersonaSheet, section: PersonaSheetSectionKey, key: string): boolean {
  if (key === 'timezone') return true;
  const value = sectionAnswers(sheet, section)[key];
  if (value === null || value === undefined) return false;
  return typeof value === 'number' || value.length > 0;
}

export interface PersonaSheetCompletion {
  /** Questions answered, out of `PERSONA_SHEET_QUESTION_COUNT`. */
  readonly answered: number;
  readonly total: number;
  /** 0 to 100, whole. Never a condition to activate a version. */
  readonly percent: number;
  /** The sections with a question left, in the sheet's order, with what is left in each. */
  readonly missing: readonly { readonly section: PersonaSheetSectionKey; readonly left: number }[];
}

/** How complete her sheet is: the questions she answered, out of 59 (ADR 0079 § 6). */
export function personaSheetCompletion(sheet: PersonaSheet): PersonaSheetCompletion {
  let count = 0;
  const missing: { section: PersonaSheetSectionKey; left: number }[] = [];
  for (const section of PERSONA_SHEET) {
    const done = section.questions.filter((question) => answered(sheet, section.key, question.key)).length;
    count += done;
    if (done < section.questions.length)
      missing.push({ section: section.key, left: section.questions.length - done });
  }
  return {
    answered: count,
    total: PERSONA_SHEET_QUESTION_COUNT,
    percent: Math.round((count / PERSONA_SHEET_QUESTION_COUNT) * 100),
    missing,
  };
}

/** Something of a format-1 version that found no question of its own, and the question it was put in. */
export interface PersonaMove {
  /** What it was called on the format-1 sheet, in French. */
  readonly from: string;
  readonly to: { readonly section: PersonaSheetSectionKey; readonly key: string };
}

export interface ConvertedPersona {
  readonly persona: PersonaV2;
  /** Nothing is lost in silence (ADR 0079 § 5): the screen says each of these. */
  readonly moved: readonly PersonaMove[];
}

const labelOf = <V extends string | number>(
  options: readonly { readonly value: V; readonly label: string }[],
  value: V,
): string => options.find((o) => o.value === value)?.label ?? String(value);

const joined = (list: readonly string[] | undefined, separator = ', '): string | null =>
  list === undefined || list.length === 0 ? null : list.join(separator);

/** The non-empty lines of `parts`, one per line, or null when none is. */
const lines = (...parts: readonly (string | null | undefined)[]): string | null => {
  const kept = parts.filter(
    (part): part is string => part !== null && part !== undefined && part.trim() !== '',
  );
  return kept.length === 0 ? null : kept.join('\n');
};

/**
 * A format-1 version as a format-2 draft (ADR 0079 § 5), never stored by itself: the screen opens it, the owner saves
 * it as a new version. Every value lands in a question; those with no question of their own go to the nearest one and
 * are listed in `moved`.
 */
export function personaSheetFromV1(v1: Persona): ConvertedPersona {
  const moved: PersonaMove[] = [];
  const move = <T>(from: string, section: PersonaSheetSectionKey, key: string, value: T): T => {
    if (value !== null && value !== undefined && value !== '') moved.push({ from, to: { section, key } });
    return value;
  };
  /**
   * Cuts an answer to its question's length, so that the draft parses (« Infos en plus » took 6 000 characters), and
   * says so in `moved`: nothing is lost in silence.
   */
  const fit = (
    section: PersonaSheetSectionKey,
    key: string,
    value: string | null,
    max: number,
  ): string | null => {
    if (value === null || value.length <= max) return value;
    moved.push({ from: `Texte coupé à ${String(max)} caractères`, to: { section, key } });
    return value.slice(0, max).trimEnd();
  };
  const d = v1.details;
  const w = v1.writing_style;
  const label = (prefix: string, value: string | null): string | null =>
    value === null ? null : `${prefix} : ${value}`;

  const origin = move(
    'Origine',
    'identity',
    'physical_description',
    labelOf(PERSONA_OPTIONS.ethnicity, d.ethnicity),
  );
  const personality = move('Caractère', 'conversation', 'conversation_description', joined(d.personality));
  const languageStyle = move(
    'Langage',
    'conversation',
    'spelling_description',
    lines(
      `Langage : ${labelOf(PERSONA_OPTIONS.languageStyle, v1.behavior.language_style)}`,
      v1.behavior.language_instructions,
    ),
  );
  const writing =
    w === undefined
      ? null
      : move(
          'Style d’écriture',
          'conversation',
          'spelling_description',
          lines(
            `Longueur des messages : ${labelOf(PERSONA_OPTIONS.messageLength, w.message_length)}`,
            `Majuscules : ${labelOf(PERSONA_OPTIONS.capitals, w.capitals)}`,
            label('Ponctuation', w.punctuation),
          ),
        );
  const leftovers = lines(
    move(
      'Informations additionnelles',
      'conversation',
      'roleplaying_description',
      v1.additional_info || null,
    ),
    move(
      'Objectifs',
      'conversation',
      'roleplaying_description',
      label('Objectifs', v1.lifestyle?.goals ?? null),
    ),
    move(
      'N’aime pas',
      'conversation',
      'roleplaying_description',
      label("N'aime pas", joined(v1.tastes?.dislikes)),
    ),
  );
  const likes = move('Aime', 'preferences', 'passions', label('Aime', joined(v1.tastes?.likes)));
  const replies = (v1.sample_replies ?? []).map((r) =>
    r.situation === null ? r.reply : `${r.situation} : ${r.reply}`,
  );
  const limitsText = move(
    'Limites (ne fait jamais, ne montre jamais)',
    'intimacy',
    'no_go_zones',
    lines(
      label('Ne fait jamais', joined(v1.limits.never_do)),
      label('Ne montre jamais', joined(v1.limits.never_show)),
    ),
  );

  const persona: PersonaV2 = {
    meta: { ...v1.meta, schema: 2 },
    sheet: {
      identity: {
        physical_description: fit('identity', 'physical_description', origin, SHEET_LONG_MAX),
        shoe_size: d.shoe_size_eu === null ? null : String(d.shoe_size_eu),
        birth_date: d.date_of_birth,
        height_m: d.height_cm === null ? null : d.height_cm / 100,
        weight_kg: d.weight_kg,
        country: null,
        city: null,
        nickname: d.first_name,
        job: fit('identity', 'job', v1.lifestyle?.occupation ?? null, SHEET_SHORT_MAX),
        eye_color: d.eyes === null ? null : labelOf(PERSONA_OPTIONS.eyes, d.eyes),
        hair_color: d.hair === null ? null : labelOf(PERSONA_OPTIONS.hair, d.hair),
        breast_size: d.bra === null ? null : `${String(d.bra.band)}${d.bra.cup}`,
        place_of_life: fit('identity', 'place_of_life', v1.lifestyle?.area ?? null, SHEET_SHORT_MAX),
        spoken_languages: [...d.languages],
      },
      lifestyle: {
        smoking_habit: null,
        drinking_habit: null,
        traveling: null,
        routines: fit('lifestyle', 'routines', v1.lifestyle?.routine ?? null, SHEET_LONG_MAX),
        pets: null,
        dream_car: null,
      },
      preferences: {
        favorite_color: null,
        least_favorite_color: null,
        passions: fit('preferences', 'passions', lines(joined(d.hobbies), likes), SHEET_LONG_MAX),
        favorite_dishes: null,
        least_liked_dishes: null,
        religion: null,
        music_genres: null,
        favorite_movies: null,
        favorite_celebrities: null,
        favorite_characters: null,
        favorite_books: null,
      },
      conversation: {
        roleplaying_description: fit('conversation', 'roleplaying_description', leftovers, SHEET_LONG_MAX),
        favourite_emojis: fit(
          'conversation',
          'favourite_emojis',
          joined(w?.emojis_preferred, ' '),
          SHEET_SHORT_MAX,
        ),
        conversation_description: fit(
          'conversation',
          'conversation_description',
          personality,
          SHEET_LONG_MAX,
        ),
        spelling_description: fit(
          'conversation',
          'spelling_description',
          lines(languageStyle, writing),
          SHEET_LONG_MAX,
        ),
        compliment_description: null,
        flirt_description: null,
        common_expressions: null,
        typical_responses: fit('conversation', 'typical_responses', lines(...replies), SHEET_LONG_MAX),
      },
      relationships: {
        relationship_status: null,
        kids_status: null,
        body_count: null,
        turn_ons: fit('relationships', 'turn_ons', joined(v1.intimate?.turn_ons), SHEET_LONG_MAX),
        turn_offs: null,
        ideal_man: null,
        ideal_date: null,
      },
      intimacy: {
        libido_level: null,
        domination_preference: null,
        style_in_private: fit(
          'intimacy',
          'style_in_private',
          v1.intimate?.sexting_style ?? null,
          SHEET_SHORT_MAX,
        ),
        sex_toys: null,
        squirting: null,
        cum: null,
        kinks: null,
        fetichism: null,
        favorite_positions: null,
        fantasies: fit('intimacy', 'fantasies', joined(v1.intimate?.fantasies, '\n'), SHEET_LONG_MAX),
        no_go_zones: fit('intimacy', 'no_go_zones', limitsText, SHEET_LONG_MAX),
      },
      boundaries: { off_limits: null },
    },
    agent: {
      strategies: v1.strategies,
      follow_ups: v1.follow_ups,
      notifications: v1.notifications,
      behavior: {
        split_messages: v1.behavior.split_messages,
        pet_names: v1.behavior.pet_names,
        response_delay_minutes: v1.behavior.response_delay_minutes,
      },
      rules: { ...v1.limits, emojis_forbidden: w?.emojis_forbidden ?? [] },
    },
  };
  return { persona, moved };
}

/** Any stored version as format 2: as it is, or converted (the moves are then dropped: the agent has no screen). */
export const asPersonaV2 = (stored: StoredPersona): PersonaV2 =>
  'sheet' in stored ? stored : personaSheetFromV1(stored).persona;
