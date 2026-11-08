import { z } from 'zod';

import type { FactCategory } from './enums';
import { FanIdSchema, MessageIdSchema, UserIdSchema } from './ids';

/**
 * The fan's card (ADR 0085): a closed list of fields the AI fills by reading the conversation and a chatter corrects.
 * A field is a line of `fan_facts` whose key is its code; the seven codes of the KYC canvas keep their names
 * (`KycSlotSchema`), so the facts already written fill the card as they are.
 */

/** Where a field sits on the card: about him, what he likes about her, and the intimate part (§ 3). */
export const FanCardGroupSchema = z.enum(['him', 'about_her', 'intimate']);
export type FanCardGroup = z.infer<typeof FanCardGroupSchema>;

/**
 * How a field is learnt (§ 2): asked in the KYC (`ask`), noted when he speaks of it (`note`), or only observed, never
 * asked, always a guess (`observe`).
 */
export const FanCardLearningSchema = z.enum(['ask', 'note', 'observe']);
export type FanCardLearning = z.infer<typeof FanCardLearningSchema>;

/** The intensity he looks for (§ 3), a closed value. */
export const FanCardIntensitySchema = z.enum(['soft', 'naughty', 'very_explicit']);
export type FanCardIntensity = z.infer<typeof FanCardIntensitySchema>;

/** Whether he likes her to lead, to be led, or both (§ 3), a closed value. */
export const FanCardLeadSchema = z.enum(['she_leads', 'she_follows', 'both']);
export type FanCardLead = z.infer<typeof FanCardLeadSchema>;

export const FAN_CARD_INTENSITY_LABELS: Readonly<Record<FanCardIntensity, string>> = {
  soft: 'Doux',
  naughty: 'Coquin',
  very_explicit: 'Très explicite',
};

export const FAN_CARD_LEAD_LABELS: Readonly<Record<FanCardLead, string>> = {
  she_leads: 'Qu’elle mène',
  she_follows: 'Qu’elle se laisse mener',
  both: 'Les deux',
};

export const FanCardFieldSchema = z.enum([
  'first_name',
  'pet_names',
  'location',
  'age',
  'situation',
  'job',
  'hobbies',
  'pets',
  'favourite_colour',
  'life_events',
  'moods',
  'payday',
  'attachment',
  'likes_about_her',
  'dislikes_about_her',
  'outfits',
  'desires',
  'limits',
  'intensity',
  'lead',
]);
export type FanCardField = z.infer<typeof FanCardFieldSchema>;

/** A field of the card: its label from his point of view, the category its fact is written in, its shape. */
export interface FanCardFieldSpec {
  readonly field: FanCardField;
  readonly group: FanCardGroup;
  readonly label: string;
  /** What the label means, shown under it (§ 3). */
  readonly hint?: string;
  readonly category: Exclude<FactCategory, 'operator_note'>;
  /** One value, or a list of short items. */
  readonly shape: 'one' | 'list';
  readonly learning: FanCardLearning;
}

/** The card in its order (§ 3), the labels word for word. */
export const FAN_CARD_FIELDS: readonly FanCardFieldSpec[] = [
  {
    field: 'first_name',
    group: 'him',
    label: 'Son prénom',
    category: 'identity',
    shape: 'one',
    learning: 'ask',
  },
  {
    field: 'pet_names',
    group: 'him',
    label: 'Les petits noms qu’il aime qu’on lui donne',
    category: 'preferences',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'location',
    group: 'him',
    label: 'Sa ville ou sa région',
    hint: 'jamais une adresse',
    category: 'identity',
    shape: 'one',
    learning: 'ask',
  },
  { field: 'age', group: 'him', label: 'Son âge', category: 'identity', shape: 'one', learning: 'ask' },
  {
    field: 'situation',
    group: 'him',
    label: 'Sa situation',
    hint: 'couple, enfants…',
    category: 'life',
    shape: 'one',
    learning: 'ask',
  },
  { field: 'job', group: 'him', label: 'Son métier', category: 'life', shape: 'one', learning: 'ask' },
  {
    field: 'hobbies',
    group: 'him',
    label: 'Ses passions',
    hint: 'sport, jeux, séries, musique…',
    category: 'interests',
    shape: 'list',
    learning: 'ask',
  },
  { field: 'pets', group: 'him', label: 'Ses animaux', category: 'life', shape: 'list', learning: 'note' },
  {
    field: 'favourite_colour',
    group: 'him',
    label: 'Sa couleur préférée',
    category: 'preferences',
    shape: 'one',
    learning: 'note',
  },
  {
    field: 'life_events',
    group: 'him',
    label: 'Ce qui se passe dans sa vie',
    hint: 'anniversaire, vacances, rupture, examen…, daté',
    category: 'events',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'moods',
    group: 'him',
    label: 'Ses humeurs fréquentes',
    hint: 'seul, stressé, excité…',
    category: 'life',
    shape: 'list',
    learning: 'observe',
  },
  {
    field: 'payday',
    group: 'him',
    label: 'Quand il a de l’argent',
    category: 'commercial',
    shape: 'one',
    learning: 'observe',
  },
  {
    field: 'attachment',
    group: 'him',
    label: 'Son attachement à elle',
    hint: 'jalousie, « tu me manques »…',
    category: 'commercial',
    shape: 'one',
    learning: 'observe',
  },
  {
    field: 'likes_about_her',
    group: 'about_her',
    label: 'Ce qu’il aime chez elle',
    hint: 'physique, caractère, attitude',
    category: 'preferences',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'dislikes_about_her',
    group: 'about_her',
    label: 'Ce qu’il ne veut pas voir d’elle',
    category: 'preferences',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'outfits',
    group: 'about_her',
    label: 'Les tenues qu’il aime la voir porter',
    hint: 'lingerie, cosplay, nue…',
    category: 'preferences',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'desires',
    group: 'intimate',
    label: 'Ses fantasmes',
    category: 'intimate',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'limits',
    group: 'intimate',
    label: 'Ce qu’il ne veut pas',
    hint: '« je n’aime pas… »',
    category: 'intimate',
    shape: 'list',
    learning: 'note',
  },
  {
    field: 'intensity',
    group: 'intimate',
    label: 'L’intensité qu’il cherche',
    hint: 'doux, coquin, très explicite',
    category: 'intimate',
    shape: 'one',
    learning: 'observe',
  },
  {
    field: 'lead',
    group: 'intimate',
    label: 'Il aime qu’elle mène, qu’elle se laisse mener, ou les deux',
    category: 'intimate',
    shape: 'one',
    learning: 'observe',
  },
];

/** The spec of a field: every code has one, `FAN_CARD_FIELDS` is checked against the enum by its test. */
export function fanCardFieldSpec(field: FanCardField): FanCardFieldSpec {
  const spec = FAN_CARD_FIELDS.find((one) => one.field === field);
  if (spec === undefined) throw new Error(`fan card field without spec: ${field}`);
  return spec;
}

/** A value is a line of his notes, not a message (`fan_facts`, 300 characters at most), a list included whole. */
export const FAN_CARD_VALUE_MAX = 300;

/** Items of a list field, at most. */
export const FAN_CARD_ITEMS_MAX = 12;

/**
 * Where a value comes from (§ 5): he said it, it was guessed from what he wrote, or a chatter noted it. The order of
 * strength is noted, then declared, then inferred (§ 6).
 */
export const FanCardSourceSchema = z.enum(['noted', 'declared', 'inferred']);
export type FanCardSource = z.infer<typeof FanCardSourceSchema>;

/** A value of a field as the card shows it: a one-value field has one item. */
export const FanCardValueSchema = z
  .object({
    items: z.array(z.string().min(1)).min(1),
    source: FanCardSourceSchema,
    observedAt: z.iso.datetime(),
    /** The chatter who noted it, for a `noted` value; null otherwise. */
    notedBy: UserIdSchema.nullable(),
    /** His message it was read in, for a value he said or one guessed; null for a chatter's note. */
    sourceMessageId: MessageIdSchema.nullable(),
  })
  .strict();
export type FanCardValue = z.infer<typeof FanCardValueSchema>;

/** A field of the card: its value now, and what the AI read since that contradicts a chatter's note (§ 6). */
export const FanCardEntrySchema = z
  .object({
    field: FanCardFieldSchema,
    /** Null: nothing known, or a chatter cleared it. */
    current: FanCardValueSchema.nullable(),
    /** « À vérifier », newest first: kept under the field until a chatter keeps one value or the other. */
    toCheck: z.array(FanCardValueSchema),
  })
  .strict();
export type FanCardEntry = z.infer<typeof FanCardEntrySchema>;

/** Something useful outside the fields (§ 1), or a chatter's note when he gave the conversation back: « Autres ». */
export const FanCardOtherSchema = z
  .object({
    key: z.string().min(1),
    value: z.string().min(1),
    /** `noted` for a chatter's note left at the hand-back. */
    source: FanCardSourceSchema,
    observedAt: z.iso.datetime(),
  })
  .strict();
export type FanCardOther = z.infer<typeof FanCardOtherSchema>;

/**
 * `GET /v1/fans/:id/card?creatorId=` (ADR 0085 § 10): every field in the card's order, then « Autres », newest first.
 * The owner, the active managers and the chatters who can open the fan; never the creator (ADR 0063).
 */
export const FanCardViewSchema = z
  .object({
    fanId: FanIdSchema,
    fields: z.array(FanCardEntrySchema),
    others: z.array(FanCardOtherSchema),
  })
  .strict();
export type FanCardView = z.infer<typeof FanCardViewSchema>;

const item = z.string().trim().min(1).max(FAN_CARD_VALUE_MAX);

/**
 * `PUT /v1/fans/:id/card/:field?creatorId=` (§ 6): a chatter writes a field in one gesture (one item for a one-value
 * field, the whole list for a list field), or clears it. The server checks the shape against the field, the closed
 * values of `intensity` and `lead`, and what the card never keeps (§ 8). Writing again the value he keeps settles
 * what was « à vérifier ».
 */
export const SetFanCardFieldBodySchema = z.union([
  z.object({ items: z.array(item).min(1).max(FAN_CARD_ITEMS_MAX) }).strict(),
  z.object({ clear: z.literal(true) }).strict(),
]);
export type SetFanCardFieldBody = z.infer<typeof SetFanCardFieldBodySchema>;

/** Refusals of the `PUT` (400): a list for a one-value field, a value outside a closed list, too long. */
export const FAN_CARD_VALUE_INVALID = 'fan_card_value_invalid';
/** What the card never keeps (§ 8), 422: an address, a number, an e-mail, an account elsewhere. Nothing is written. */
export const FAN_CARD_VALUE_UNPROCESSABLE = 'fan_card_value_unprocessable';
