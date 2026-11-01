import { z } from 'zod';

import { GuardCodeSchema } from './guards';
import { CreatorIdSchema, PersonaVersionIdSchema } from './ids';
import { PersonaSchema, SAMPLE_REPLIES_MAX } from './persona';

/** Hex SHA-256 of a persona's canonical JSON (keys sorted): two equal personas have the same hash. */
export const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** One stored version of a creator's persona (ADR 0010), without its content. */
export const PersonaVersionSummarySchema = z.strictObject({
  id: PersonaVersionIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentHash: ContentHashSchema,
  /** The one the agent writes with; at most one per creator, set by the activation, never by the dashboard. */
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PersonaVersionSummary = z.infer<typeof PersonaVersionSummarySchema>;

/**
 * `GET /v1/creators/:creatorId/persona`: her versions, newest first, and the content of the newest one, the one the
 * dashboard edits. `latest` is null while no version was ever stored.
 */
export const PersonaOverviewSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  latest: z.strictObject({ summary: PersonaVersionSummarySchema, persona: PersonaSchema }).nullable(),
  versions: z.array(PersonaVersionSummarySchema),
});
export type PersonaOverview = z.infer<typeof PersonaOverviewSchema>;

/**
 * `POST /v1/creators/:creatorId/persona/versions` → 201 `PersonaVersionSummary`, never active. `basedOn` is the
 * hash of the version the edit started from (null for a first version): if another version was stored since, or
 * `persona.meta.version` is taken, the answer is 409 `persona_version_conflict` and nothing is stored.
 */
export const CreatePersonaVersionBodySchema = z.strictObject({
  persona: PersonaSchema,
  basedOn: ContentHashSchema.nullable(),
});
export type CreatePersonaVersionBody = z.infer<typeof CreatePersonaVersionBodySchema>;

/**
 * `POST /v1/creators/:creatorId/persona/versions/:versionId/activate` → 200 `PersonaVersionSummary`: makes that
 * version her only active one (an audited event, ADR 0010). Activating the active version changes nothing; a version
 * that is not hers is 404 `persona_version_not_found`.
 */
export const ActivatePersonaVersionParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  versionId: PersonaVersionIdSchema,
});
export type ActivatePersonaVersionParams = z.infer<typeof ActivatePersonaVersionParamsSchema>;

/**
 * Body of the activation: `expectedActive` is the id of her active version as the screen last read it (null: none).
 * If another one became active since (a tab left open), the answer is 409 `persona_version_conflict` and nothing
 * changes, so that a stale screen never undoes an activation made elsewhere.
 */
export const ActivatePersonaVersionBodySchema = z.strictObject({
  expectedActive: PersonaVersionIdSchema.nullable(),
});
export type ActivatePersonaVersionBody = z.infer<typeof ActivatePersonaVersionBodySchema>;

/**
 * The error codes of the persona's versions, for the screen to say them in French (the suffix gives the status,
 * api.md): `persona_version_conflict` 409, another version was stored since the edit started, or its number is taken, or
 * another version became active since the screen read it ;
 * `persona_version_not_found` 404, no version of hers has this id ; `persona_sample_reply_unprocessable` 422, a sample
 * reply holds what a hard guard of her answers blocks (P5-01), its `details` read by
 * `PersonaSampleReplyUnprocessableDetailsSchema`. Nothing is stored on any of them.
 */
export const PERSONA_ERROR_CODES = [
  'persona_version_conflict',
  'persona_version_not_found',
  'persona_sample_reply_unprocessable',
] as const;
export type PersonaErrorCode = (typeof PERSONA_ERROR_CODES)[number];

/** A refused sample reply: its place in `sample_replies` and the guard's code, never its text. */
export const PersonaSampleReplyFaultSchema = z.strictObject({
  index: z
    .int()
    .min(0)
    .max(SAMPLE_REPLIES_MAX - 1),
  code: GuardCodeSchema,
});
export type PersonaSampleReplyFault = z.infer<typeof PersonaSampleReplyFaultSchema>;

/** `details` of 422 `persona_sample_reply_unprocessable`: one line per reply and guard, in the list's order. */
export const PersonaSampleReplyUnprocessableDetailsSchema = z.strictObject({
  faults: z.array(PersonaSampleReplyFaultSchema).min(1),
});
export type PersonaSampleReplyUnprocessableDetails = z.infer<
  typeof PersonaSampleReplyUnprocessableDetailsSchema
>;
