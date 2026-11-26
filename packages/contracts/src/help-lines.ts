import { z } from 'zod';

/**
 * A national help line for a fan in distress (ADR 0168 § 8, ADR 0088 § 4), shown only when his country is a confirmed
 * fact of his card. Every row is checked by a person on the official page it names, the day it says: no number enters
 * this table on a model's word or from memory.
 */
export const HelpLineSchema = z
  .object({
    /** The country, ISO 3166-1 alpha-2 in capitals (`FR`, `IT`). */
    country: z.string().regex(/^[A-Z]{2}$/u),
    /** The number as he dials it, digits and spaces only. */
    number: z.string().regex(/^\d[\d ]{1,18}\d$/u),
    /** What the line is, in a few words, in the language of the bubble that names it. */
    label: z.string().trim().min(1).max(80),
    /** The official page the number was read on. */
    sourceUrl: z.url({ protocol: /^https$/u }),
    /** The day a person checked it there. */
    verifiedAt: z.iso.date(),
  })
  .strict();
export type HelpLine = z.infer<typeof HelpLineSchema>;

/** The table, one row per country at most. */
export const HelpLinesSchema = z
  .array(HelpLineSchema)
  .refine((lines) => new Set(lines.map((line) => line.country)).size === lines.length, 'country repeated');

/**
 * The verified lines, empty on purpose (Charles, 26/11: « numéro si pays connu »): a row is added in its own PR, once Charles
 * has checked the number himself on the official page, with its source and the date. Until then the help bubble gives no
 * national number outside the French one of ADR 0088 § 4.
 */
export const HELP_LINES: readonly HelpLine[] = HelpLinesSchema.parse([]);
