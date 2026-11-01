import { z } from 'zod';

import { CreatorIdSchema } from './ids';
import { TimezoneSchema } from './persona';

/** One creator as the dashboard lists her (`GET /v1/creators`). One creator, one persona. */
export const CreatorSummarySchema = z.object({
  id: CreatorIdSchema,
  displayName: z.string().min(1),
  timezone: z.string().min(1),
});
export type CreatorSummary = z.infer<typeof CreatorSummarySchema>;

/** `GET /v1/creators`: an owner gets every creator, anyone else the creators of their account. */
export const CreatorListSchema = z.object({ creators: z.array(CreatorSummarySchema) });
export type CreatorList = z.infer<typeof CreatorListSchema>;

/**
 * Her name as compared with the others' (`creators.name_key`, unique): two creators never share a name (Charles,
 * 28/10/2026). Case, accents, invisible characters, the spaces around and the runs of spaces inside do not count:
 * « Zoé », « ZOE » and « zoe » are one name.
 */
export function creatorNameKey(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Her name as fans see it: one letter at least, never an invisible character or punctuation alone. */
export const CreatorDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/\p{L}/u, { message: 'Le nom doit contenir au moins une lettre' });

/** `pnpm creator:create`: the creator's name as fans see it, and the zone her day and night follow. */
export const NewCreatorSchema = z.object({
  /** Chosen by the page once per form: a second click, or a replay, finds the creator the first one made. */
  id: CreatorIdSchema.optional(),
  displayName: CreatorDisplayNameSchema,
  timezone: TimezoneSchema.default('Europe/Paris'),
});
export type NewCreator = z.input<typeof NewCreatorSchema>;

/**
 * `PATCH /v1/creators/:creatorId` (owner only, a recent sign-in): her zone, and nothing else. A wrong zone at her
 * creation is no longer final; her name stays as it was made.
 */
export const UpdateCreatorBodySchema = z.strictObject({ timezone: TimezoneSchema });
export type UpdateCreatorBody = z.infer<typeof UpdateCreatorBodySchema>;

/**
 * The error codes of `/v1/creators` (the suffix gives the status, api.md): `creator_conflict` 409, this form's id
 * already made a creator under another name or zone ; `creator_name_conflict` 409, another creator has this name
 * (`creatorNameKey`) ; `creator_not_found` 404. Nothing is written on any of them.
 */
export const CREATOR_ERROR_CODES = [
  'creator_conflict',
  'creator_name_conflict',
  'creator_not_found',
] as const;
export type CreatorErrorCode = (typeof CREATOR_ERROR_CODES)[number];
