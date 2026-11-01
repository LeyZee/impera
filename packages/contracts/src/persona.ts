import { z } from 'zod';

import { KYC_SLOT_LABELS, KycSlotSchema, type KycSlot } from './fans';
import { normaliseWords } from './normalise';

/**
 * Creator persona (ADR 0010), mirrored on the OnlyChat creator settings: details, additional info, behaviour,
 * strategies, follow-ups, notifications. `limits` is the one section OnlyChat lacks: guards load it (CLAUDE.md rule 3).
 * Shared by the dashboard form and the agent. Field reference: docs/reference/persona-schema.md.
 */

/** A choice list with its French label, used by the dashboard form and by the import from OnlyChat. */
type Options<T extends string | number> = readonly { readonly value: T; readonly label: string }[];

const labelled = <V extends string>(values: readonly V[], labels: Record<V, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

export const GENDERS = ['female', 'male', 'other'] as const;
export const ETHNICITIES = ['caucasian', 'latina', 'asian', 'black', 'mixed', 'arab', 'other'] as const;
export const LANGUAGES = [
  'french',
  'english',
  'italian',
  'spanish',
  'german',
  'portuguese',
  'dutch',
  'arabic',
] as const;
export const HAIR_COLORS = ['brown', 'black', 'blond', 'red', 'auburn', 'grey', 'colored'] as const;
export const EYE_COLORS = ['brown', 'green', 'blue', 'hazel', 'grey', 'black'] as const;
export const CUP_SIZES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const BAND_SIZES = range(65, 105, 5);
export const LANGUAGE_STYLES = ['formal', 'casual'] as const;
export const STRATEGY_STYLES = ['default', 'custom'] as const;
export const SCRIPT_LAUNCH_STYLES = ['normal', 'custom'] as const;
export const FOLLOW_UP_TYPES = ['soft', 'custom'] as const;
/** How long her messages run (`writing_style`, P5-01). */
export const MESSAGE_LENGTHS = ['short', 'medium', 'long'] as const;
/** How she uses capitals: as anyone, never, or to shout a word. */
export const CAPITALS_STYLES = ['normal', 'lowercase', 'expressive'] as const;

/** Bounds of every number field: OnlyChat's where its form shows them, ours otherwise (follow-ups within a week). Units are in the names. */
export const PERSONA_BOUNDS = {
  heightCm: [140, 200],
  weightKg: [40, 130],
  shoeSizeEu: [34, 46],
  responseDelayMinutes: [0, 60],
  kycMaxMessages: [1, 500],
  kycMaxDurationMinutes: [10, 1440],
  kycMinHoursBeforeFollowing: [0, 24],
  sexualizationInitiateAfterHours: [0, 168],
  sexualizationMinDesireToOpen: [20, 70],
  scriptMinDesire: [50, 90],
  scriptCooldownHours: [0, 24],
  postOfferDelayDays: [1, 60],
  followUpDelayHours: [1, 168],
  nudgeDelayMinutes: [1, 120],
  nudgesPerDay: [0, 10],
  nudgeMinHoursAfterConversation: [0, 48],
} as const satisfies Record<string, readonly [number, number]>;

export const ADDITIONAL_INFO_MAX = 6000;
export const MIN_CREATOR_AGE = 18;

/** French labels of every choice list: the dashboard renders these, never its own copy. */
export const PERSONA_OPTIONS = {
  gender: labelled(GENDERS, { female: 'Femme', male: 'Homme', other: 'Autre' }),
  ethnicity: labelled(ETHNICITIES, {
    caucasian: 'Caucasienne',
    latina: 'Latine',
    asian: 'Asiatique',
    black: 'Noire',
    mixed: 'Métisse',
    arab: 'Moyen-orientale',
    other: 'Autre',
  }),
  languages: labelled(LANGUAGES, {
    french: 'Français',
    english: 'Anglais',
    italian: 'Italien',
    spanish: 'Espagnol',
    german: 'Allemand',
    portuguese: 'Portugais',
    dutch: 'Néerlandais',
    arabic: 'Arabe',
  }),
  hair: labelled(HAIR_COLORS, {
    brown: 'Bruns',
    black: 'Noirs',
    blond: 'Blonds',
    red: 'Roux',
    auburn: 'Châtains',
    grey: 'Gris',
    colored: 'Colorés',
  }),
  eyes: labelled(EYE_COLORS, {
    brown: 'Marron',
    green: 'Verts',
    blue: 'Bleus',
    hazel: 'Noisette',
    grey: 'Gris',
    black: 'Noirs',
  }),
  cup: CUP_SIZES.map((value) => ({ value, label: value })),
  band: BAND_SIZES.map((value) => ({ value, label: String(value) })),
  languageStyle: labelled(LANGUAGE_STYLES, { formal: 'Soigné', casual: 'Familier' }),
  strategyStyle: labelled(STRATEGY_STYLES, { default: 'Par défaut', custom: 'Personnalisé' }),
  scriptLaunchStyle: labelled(SCRIPT_LAUNCH_STYLES, { normal: 'Normal', custom: 'Personnalisé' }),
  followUpType: labelled(FOLLOW_UP_TYPES, { soft: 'Douce', custom: 'Personnalisée' }),
  messageLength: labelled(MESSAGE_LENGTHS, { short: 'Courts', medium: 'Moyens', long: 'Longs' }),
  capitals: labelled(CAPITALS_STYLES, {
    normal: 'Comme tout le monde',
    lowercase: 'Jamais de majuscules',
    expressive: 'En majuscules pour appuyer un mot',
  }),
  kycSlots: labelled(KycSlotSchema.options, KYC_SLOT_LABELS),
} as const satisfies Record<string, Options<string | number>>;

const intIn = ([min, max]: readonly [number, number]) => z.int().min(min).max(max);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable();

/** A list of short entries, each unique regardless of case (hobbies, traits, keywords). */
const entries = (maxEach: number, maxCount: number, item: z.ZodType<string> = text(maxEach)) =>
  z
    .array(item)
    .max(maxCount)
    .refine((list) => new Set(list.map((v) => v.toLocaleLowerCase('fr'))).size === list.length, {
      message: 'Entrée en double',
    });

const uniqueList = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).refine((list) => new Set(list).size === list.length, { message: 'Valeur en double' });

/** IANA zone, checked against the runtime's own list. */
export const TimezoneSchema = z.string().refine(
  (zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return zone.includes('/');
    } catch {
      return false;
    }
  },
  { message: 'Fuseau horaire IANA inconnu' },
);

/**
 * A zone as the runtime spells it (`europe/paris` → `Europe/Paris`): the runtime accepts any case, a stored zone and
 * what the screens print of it read the canonical one. A zone it does not know is returned as it is.
 */
export function canonicalTimezone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
}

/** The two fields every strategy shares: a style, and the creator's instructions when the style is custom. */
const strategyShape = <S extends readonly [string, ...string[]]>(styles: S) => ({
  style: z.enum(styles),
  instructions: optionalText(2000),
});

/** Refinement: instructions are present exactly when the style is the custom one. */
const instructionsWhenCustom = (
  custom: string,
): [(s: { style: string; instructions: string | null }) => boolean, { message: string; path: string[] }] => [
  (s) => (s.style === custom) === (s.instructions !== null),
  { message: `Attendu si et seulement si le style est « ${custom} »`, path: ['instructions'] },
];

export const PersonaDetailsSchema = z.strictObject({
  first_name: text(40),
  date_of_birth: z.iso.date(),
  /** Deprecated (Charles, 17/10): Nirvana is built for women creators. Still read in older files, never used. */
  gender: z.enum(GENDERS).optional(),
  ethnicity: z.enum(ETHNICITIES),
  timezone: TimezoneSchema,
  languages: uniqueList(z.enum(LANGUAGES)).min(1),
  height_cm: intIn(PERSONA_BOUNDS.heightCm).nullable(),
  weight_kg: intIn(PERSONA_BOUNDS.weightKg).nullable(),
  shoe_size_eu: intIn(PERSONA_BOUNDS.shoeSizeEu).nullable(),
  hair: z.enum(HAIR_COLORS).nullable(),
  eyes: z.enum(EYE_COLORS).nullable(),
  bra: z
    .strictObject({
      band: z.int().refine((b) => BAND_SIZES.includes(b), { message: 'Tour de poitrine hors liste' }),
      cup: z.enum(CUP_SIZES),
    })
    .nullable(),
  hobbies: entries(80, 40),
  personality: entries(80, 40),
});

export const PersonaBehaviorSchema = z.strictObject({
  language_style: z.enum(LANGUAGE_STYLES),
  language_instructions: optionalText(2000),
  split_messages: z.boolean(),
  /** The only pet names she gives fans: guards refuse any other. */
  pet_names: entries(30, 20),
  /** Enforced by code when sending, never by the prompt (CLAUDE.md rule 3). */
  response_delay_minutes: intIn(PERSONA_BOUNDS.responseDelayMinutes),
});

export const PersonaStrategiesSchema = z.strictObject({
  /** Delays and cooldowns below are enforced by the policy, never by the prompt (CLAUDE.md rule 3). */
  kyc: z
    .strictObject({
      ...strategyShape(STRATEGY_STYLES),
      targets: optionalText(500),
      /**
       * The canvas lines she tries to learn from each fan, in her order (P5-01); absent, all of them. The brain is
       * given the ones still empty as its KYC aim.
       */
      collect: uniqueList(KycSlotSchema).min(1).optional(),
      max_messages: intIn(PERSONA_BOUNDS.kycMaxMessages),
      max_duration_minutes: intIn(PERSONA_BOUNDS.kycMaxDurationMinutes),
      /** Conversation time before the agent follows a fan who sexualizes; below it, she steers back. */
      min_hours_before_following: intIn(PERSONA_BOUNDS.kycMinHoursBeforeFollowing),
    })
    .refine(...instructionsWhenCustom('custom')),
  sexualization: z
    .strictObject({
      ...strategyShape(STRATEGY_STYLES),
      /** Relationship time before the agent opens sexualization itself. */
      initiate_after_hours: intIn(PERSONA_BOUNDS.sexualizationInitiateAfterHours),
      /** His desire score (P3-12) before she opens it herself; absent, 40 (`DEFAULT_MIN_DESIRE_TO_OPEN`). */
      min_desire_to_open: intIn(PERSONA_BOUNDS.sexualizationMinDesireToOpen).optional(),
    })
    .refine(...instructionsWhenCustom('custom')),
  script_launch: z
    .strictObject({
      ...strategyShape(SCRIPT_LAUNCH_STYLES),
      cooldown_hours: intIn(PERSONA_BOUNDS.scriptCooldownHours),
      /** His desire score (P3-12) before a script may go out; absent, 70 (`DEFAULT_SCRIPT_MIN_DESIRE`). */
      min_desire: intIn(PERSONA_BOUNDS.scriptMinDesire).optional(),
    })
    .refine(...instructionsWhenCustom('custom')),
  post_offer: z
    .strictObject({ ...strategyShape(STRATEGY_STYLES), delay_days: intIn(PERSONA_BOUNDS.postOfferDelayDays) })
    .refine(...instructionsWhenCustom('custom')),
});

export const PersonaFollowUpsSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Hours after the fan's last message, strictly increasing. */
    delays_hours: z
      .array(intIn(PERSONA_BOUNDS.followUpDelayHours))
      .max(5)
      .refine((d) => d.every((h, i) => i === 0 || h > (d[i - 1] ?? 0)), {
        message: 'Délais strictement croissants',
      }),
    type: z.enum(FOLLOW_UP_TYPES),
    text: optionalText(500),
    nudges: z.strictObject({
      enabled: z.boolean(),
      delay_minutes: intIn(PERSONA_BOUNDS.nudgeDelayMinutes),
      max_per_day: intIn(PERSONA_BOUNDS.nudgesPerDay),
      min_hours_after_conversation: intIn(PERSONA_BOUNDS.nudgeMinHoursAfterConversation),
      delete_previous: z.boolean(),
    }),
  })
  .refine((f) => (f.type === 'custom') === (f.text !== null), {
    message: 'Attendu si et seulement si le type est « custom »',
    path: ['text'],
  });

export const PersonaNotificationsSchema = z.strictObject({
  sales: z.boolean(),
  agent_disabled: z.boolean(),
  no_script_left: z.boolean(),
  rate_limited: z.boolean(),
  /** Always on: a fan who writes one of these pauses the agent for that fan and alerts a human. */
  alert_keywords: entries(40, 100),
});

/**
 * An entry the guards look for in her answers as words (`never_say`, `disgusts`): one made only of punctuation (« ? »)
 * would match almost every message, so it holds a letter or a digit.
 */
const guardWord = text(120).refine(
  (entry) => normaliseWords(entry) !== '',
  'Une entrée contient une lettre ou un chiffre',
);

/** What she never does, shows or says. Safety data: guards.ts loads it, the prompt only mirrors it. */
export const PersonaLimitsSchema = z.strictObject({
  never_do: entries(120, 100),
  never_show: entries(120, 100),
  never_say: entries(120, 200, guardWord),
  disgusts: entries(120, 200, guardWord),
});

export const PERSONA_EMOJIS_MAX = 20;
export const SAMPLE_REPLIES_MAX = 10;

/**
 * One emoji per entry, as she would type it: a skin tone, a joined sequence (👩‍💻), a flag (🇫🇷, or a region's) or a keycap (1️⃣)
 * counts as one.
 */
const EMOJI =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|[\u{E0020}-\u{E007E}]+\u{E007F}|\u200D\p{Extended_Pictographic})*)$/u;
const emoji = z.string().trim().regex(EMOJI, { message: 'Un seul emoji par entrée' });
/** An emoji compares as typed, without the variation selector some keyboards add: « ❤ » and « ❤️ » are one. */
const emojiKey = (entry: string): string => entry.replace(/\uFE0F/gu, '');
const emojiList = z
  .array(emoji)
  .max(PERSONA_EMOJIS_MAX)
  .refine((list) => new Set(list.map(emojiKey)).size === list.length, { message: 'Emoji en double' });

/** Her life away from the fans (P5-01). */
export const PersonaLifestyleSchema = z.strictObject({
  occupation: optionalText(120),
  /** A region or a city's surroundings (« région lyonnaise »), never an address or a place that finds her. */
  area: optionalText(60),
  /** Her days as she tells them: classes, work, evenings, weekends. */
  routine: optionalText(1000),
  goals: optionalText(500),
});

/** What she likes and dislikes, outside the intimate. */
export const PersonaTastesSchema = z.strictObject({
  likes: entries(80, 40),
  dislikes: entries(80, 40),
});

/** What turns her on, and how she sexts; what she refuses stays in `limits`, which the guards apply. */
export const PersonaIntimateSchema = z.strictObject({
  turn_ons: entries(80, 40),
  fantasies: entries(120, 40),
  sexting_style: optionalText(1000),
});

/** How she writes. `emojis_forbidden` is applied by a guard, never by the prompt alone (CLAUDE.md rule 3). */
export const PersonaWritingStyleSchema = z.strictObject({
  message_length: z.enum(MESSAGE_LENGTHS),
  emojis_preferred: emojiList,
  emojis_forbidden: emojiList,
  punctuation: optionalText(300),
  capitals: z.enum(CAPITALS_STYLES),
});

/** An answer she would write, with the moment it answers: invented, the voice reads it as an example. */
export const SampleReplySchema = z.strictObject({
  situation: optionalText(200),
  reply: text(500),
});

/** The blocks of P5-01, in the order the screen and the completion show them. */
export const PERSONA_BLOCKS = [
  'details',
  'lifestyle',
  'tastes',
  'intimate',
  'writing_style',
  'sample_replies',
  'limits',
] as const;
export type PersonaBlock = (typeof PERSONA_BLOCKS)[number];

export const PERSONA_BLOCK_LABELS: Readonly<Record<PersonaBlock, string>> = {
  details: 'Détails',
  lifestyle: 'Mode de vie',
  tastes: 'Goûts',
  intimate: 'Intime',
  writing_style: 'Style d’écriture',
  sample_replies: 'Réponses types',
  limits: 'Limites',
};

/** The weight of each block in her persona's completion: they add up to 100. */
export const PERSONA_BLOCK_WEIGHTS = {
  details: 20,
  lifestyle: 15,
  tastes: 10,
  intimate: 15,
  writing_style: 15,
  sample_replies: 15,
  limits: 10,
} as const satisfies Record<PersonaBlock, number>;

export const PersonaMetaSchema = z.strictObject({
  schema: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, { message: 'Version semver attendue (ex. 1.2.0)' }),
  creator: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, { message: 'Identifiant en minuscules' }),
  language: z.literal('fr'),
  created_at: z.iso.date(),
  notes: optionalText(1000),
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Age in whole years on a given day, both ISO dates (YYYY-MM-DD). Calendar arithmetic, no time zone involved. */
export function ageOn(dateOfBirth: string, day: string): number {
  const birth = ISO_DATE.exec(dateOfBirth);
  const today = ISO_DATE.exec(day);
  if (!birth || !today) throw new RangeError('Date ISO attendue (AAAA-MM-JJ)');
  const [, by, bm, bd] = birth.map(Number);
  const [, y, m, d] = today.map(Number);
  if (
    by === undefined ||
    bm === undefined ||
    bd === undefined ||
    y === undefined ||
    m === undefined ||
    d === undefined
  )
    throw new RangeError('Date ISO attendue (AAAA-MM-JJ)');
  const birthdayPassed = m > bm || (m === bm && d >= bd);
  return y - by - (birthdayPassed ? 0 : 1);
}

/** An entry as two lists compare it: case, accents and look-alike letters aside, words split on the rest. */
const entryKey = normaliseWords;

/** The entries of `list` that `other` holds too, read through `key`. */
const shared = (
  list: readonly string[],
  other: readonly string[],
  key: (entry: string) => string,
): string[] => {
  const keys = new Set(other.map(key).filter((k) => k !== ''));
  return list.filter((entry) => keys.has(key(entry)));
};

/**
 * A persona that says one thing and its contrary is refused: an emoji both preferred and forbidden, a taste both
 * liked and disliked, a turn-on or fantasy that her limits refuse (`never_do`, `disgusts`).
 */
function noContradiction(
  p: {
    readonly limits: PersonaLimits;
    readonly tastes?: PersonaTastes | undefined;
    readonly intimate?: PersonaIntimate | undefined;
    readonly writing_style?: PersonaWritingStyle | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const refused = [...p.limits.never_do, ...p.limits.disgusts];
  type Check = readonly [readonly string[], readonly string[], (entry: string) => string, string, string];
  const checks: readonly Check[] = [
    [
      p.writing_style?.emojis_forbidden ?? [],
      p.writing_style?.emojis_preferred ?? [],
      emojiKey,
      'writing_style.emojis_forbidden',
      'Emoji à la fois préféré et interdit',
    ],
    [
      p.tastes?.dislikes ?? [],
      p.tastes?.likes ?? [],
      entryKey,
      'tastes.dislikes',
      'Goût à la fois aimé et détesté',
    ],
    [p.intimate?.turn_ons ?? [], refused, entryKey, 'intimate.turn_ons', 'Refusé dans ses limites'],
    [p.intimate?.fantasies ?? [], refused, entryKey, 'intimate.fantasies', 'Refusé dans ses limites'],
  ];
  for (const [list, other, key, path, message] of checks) {
    for (const entry of shared(list, other, key)) {
      ctx.addIssue({ code: 'custom', message: `${message} : ${entry}`, path: path.split('.') });
    }
  }
}

export const PersonaSchema = z
  .strictObject({
    meta: PersonaMetaSchema,
    details: PersonaDetailsSchema,
    additional_info: z.string().trim().max(ADDITIONAL_INFO_MAX),
    behavior: PersonaBehaviorSchema,
    strategies: PersonaStrategiesSchema,
    follow_ups: PersonaFollowUpsSchema,
    notifications: PersonaNotificationsSchema,
    limits: PersonaLimitsSchema,
    lifestyle: PersonaLifestyleSchema.optional(),
    tastes: PersonaTastesSchema.optional(),
    intimate: PersonaIntimateSchema.optional(),
    writing_style: PersonaWritingStyleSchema.optional(),
    sample_replies: z.array(SampleReplySchema).max(SAMPLE_REPLIES_MAX).optional(),
  })
  .superRefine(noContradiction)
  // Runs even when a date failed its own check (an emptied field): that field already says so, `ageOn` would throw.
  .refine(
    (p) =>
      !ISO_DATE.test(p.details.date_of_birth) ||
      !ISO_DATE.test(p.meta.created_at) ||
      ageOn(p.details.date_of_birth, p.meta.created_at) >= MIN_CREATOR_AGE,
    {
      message: `La créatrice doit avoir au moins ${String(MIN_CREATOR_AGE)} ans à la date de la version`,
      path: ['details', 'date_of_birth'],
    },
  );

export type Persona = z.infer<typeof PersonaSchema>;
export type PersonaDetails = z.infer<typeof PersonaDetailsSchema>;
export type PersonaBehavior = z.infer<typeof PersonaBehaviorSchema>;
export type PersonaStrategies = z.infer<typeof PersonaStrategiesSchema>;
export type PersonaFollowUps = z.infer<typeof PersonaFollowUpsSchema>;
export type PersonaNotifications = z.infer<typeof PersonaNotificationsSchema>;
export type PersonaLimits = z.infer<typeof PersonaLimitsSchema>;
export type PersonaLifestyle = z.infer<typeof PersonaLifestyleSchema>;
export type PersonaTastes = z.infer<typeof PersonaTastesSchema>;
export type PersonaIntimate = z.infer<typeof PersonaIntimateSchema>;
export type PersonaWritingStyle = z.infer<typeof PersonaWritingStyleSchema>;
export type SampleReply = z.infer<typeof SampleReplySchema>;

/** How much of each block she filled, from 0 to 1: a block counts by the share of its fields that hold something. */
function filled(persona: Persona, block: PersonaBlock): number {
  const share = (values: readonly boolean[]): number =>
    values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
  const some = (value: string | null | readonly unknown[] | undefined): boolean =>
    value !== null && value !== undefined && value.length > 0;
  switch (block) {
    case 'details': {
      const d = persona.details;
      return share([
        d.height_cm !== null,
        d.hair !== null,
        d.eyes !== null,
        some(d.hobbies),
        some(d.personality),
      ]);
    }
    case 'lifestyle': {
      const l = persona.lifestyle;
      return l === undefined ? 0 : share([some(l.occupation), some(l.area), some(l.routine), some(l.goals)]);
    }
    case 'tastes':
      return persona.tastes === undefined
        ? 0
        : share([some(persona.tastes.likes), some(persona.tastes.dislikes)]);
    case 'intimate': {
      const i = persona.intimate;
      return i === undefined ? 0 : share([some(i.turn_ons), some(i.fantasies), some(i.sexting_style)]);
    }
    case 'writing_style': {
      const w = persona.writing_style;
      // Length and capitals are always chosen once the block exists: its free parts make the rest.
      return w === undefined ? 0 : share([true, some(w.emojis_preferred), some(w.punctuation)]);
    }
    case 'sample_replies':
      return Math.min(persona.sample_replies?.length ?? 0, 3) / 3;
    case 'limits': {
      const l = persona.limits;
      return share([some(l.never_do), some(l.never_show), some(l.never_say), some(l.disgusts)]);
    }
  }
}

export interface PersonaCompletion {
  /** 0 to 100, whole. Never a condition to activate a version, so it takes no colour. */
  readonly percent: number;
  /** The blocks not full yet, in `PERSONA_BLOCKS` order, each with its French label. */
  readonly missing: readonly { readonly block: PersonaBlock; readonly label: string }[];
}

/**
 * How complete her persona is (P5-01): each block weighs `PERSONA_BLOCK_WEIGHTS`, three answers fill
 * `sample_replies`. Read by the screen and the API alike; no block is required.
 */
export function personaCompletion(persona: Persona): PersonaCompletion {
  let total = 0;
  const missing: { block: PersonaBlock; label: string }[] = [];
  for (const block of PERSONA_BLOCKS) {
    const part = filled(persona, block);
    total += part * PERSONA_BLOCK_WEIGHTS[block];
    if (part < 1) missing.push({ block, label: PERSONA_BLOCK_LABELS[block] });
  }
  return { percent: Math.round(total), missing };
}

/** The canvas lines she tries to learn from each fan, in her order: all of them unless she chose (P5-01). */
export const kycSlotsToCollect = (persona: Persona): readonly KycSlot[] =>
  persona.strategies.kyc.collect ?? KycSlotSchema.options;
