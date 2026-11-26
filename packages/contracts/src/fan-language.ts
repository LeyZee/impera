import { z } from 'zod';

import { FanIdSchema, UserIdSchema } from './ids';
import { LANGUAGES } from './persona';

/**
 * The fan's language (ADR 0168): the values of `LANGUAGES` (`'french'`, `'english'`, `'italian'`…), never an ISO code,
 * as the persona's `spoken_languages` and a script's language say it.
 */
export const LanguageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

/**
 * The closed list of the languages the agent's safety nets read (ADR 0168 § 4, « couverture des langues par les
 * gardes »): his age, distress, traps and alerts in what he writes, the output guards in what she writes. A language
 * enters this list only with a case of each blocking net in it (`language-coverage.test.ts`); outside it, nothing
 * leaves without a human.
 */
export const GUARDED_LANGUAGES = [
  'french',
  'english',
  'italian',
  'spanish',
] as const satisfies readonly Language[];
export type GuardedLanguage = (typeof GUARDED_LANGUAGES)[number];

const guarded: ReadonlySet<string> = new Set(GUARDED_LANGUAGES);

/** Whether the safety nets read this language. */
export function isGuardedLanguage(language: string): language is GuardedLanguage {
  return guarded.has(language);
}

/** Where his kept language comes from: read by code on his messages, or set by a person (who wins until changed). */
export const FAN_LANGUAGE_SOURCES = ['detected', 'set'] as const;
export const FanLanguageSourceSchema = z.enum(FAN_LANGUAGE_SOURCES);
export type FanLanguageSource = z.infer<typeof FanLanguageSourceSchema>;

/**
 * His kept language on his card (ADR 0168 § 3), `null` until code read one or a person set it. `setBy` is the person
 * who set it, `null` when code read it.
 */
export const FanLanguageSchema = z
  .object({
    value: LanguageSchema,
    source: FanLanguageSourceSchema,
    setBy: UserIdSchema.nullable(),
    setAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type FanLanguage = z.infer<typeof FanLanguageSchema>;

/** `PUT /v1/fans/:id/language?creatorId=`: a person sets his language, as he corrects a field of his card. */
export const SetFanLanguageBodySchema = z.object({ language: LanguageSchema }).strict();
export type SetFanLanguageBody = z.infer<typeof SetFanLanguageBodySchema>;

/** The answer of `GET` and `PUT /v1/fans/:id/language`. */
export const FanLanguageViewSchema = z
  .object({ fanId: FanIdSchema, language: FanLanguageSchema.nullable() })
  .strict();
export type FanLanguageView = z.infer<typeof FanLanguageViewSchema>;
