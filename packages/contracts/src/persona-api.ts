import { z } from 'zod';

import { GuardCodeSchema } from './guards';
import { CreatorIdSchema, PersonaCorrectionIdSchema, PersonaVersionIdSchema } from './ids';
import {
  PersonaDetailsSchema,
  PersonaIntimateSchema,
  PersonaLifestyleSchema,
  PersonaLimitsSchema,
  PersonaSchema,
  PersonaTastesSchema,
  PersonaWritingStyleSchema,
  SAMPLE_REPLIES_MAX,
  SampleReplySchema,
} from './persona';

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
 * Her sheet as she reads it (recette CREA-01, Charles 05/11 « go recos »): who she is, her life, her tastes, the
 * intimate, her way of writing, her sample replies and her limits, from the version in force. Never the agency's
 * settings (strategies, follow-ups, notifications, behaviour) nor its history (ADR 0063: the methods stay with the
 * agency); she reads it, the agency changes it.
 */
export const CreatorPersonaSheetSchema = z.strictObject({
  details: PersonaDetailsSchema,
  lifestyle: PersonaLifestyleSchema.nullable(),
  tastes: PersonaTastesSchema.nullable(),
  intimate: PersonaIntimateSchema.nullable(),
  writing_style: PersonaWritingStyleSchema.nullable(),
  sample_replies: z.array(SampleReplySchema).max(SAMPLE_REPLIES_MAX),
  limits: PersonaLimitsSchema,
});
export type CreatorPersonaSheet = z.infer<typeof CreatorPersonaSheetSchema>;

/** `GET /v1/creators/:creatorId/persona/mine`, the creator only: her sheet in force, null while she has none. */
export const MyPersonaSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  sheet: CreatorPersonaSheetSchema.nullable(),
});
export type MyPersona = z.infer<typeof MyPersonaSchema>;

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

/**
 * The sections of her sheet a correction names (recette CREA-01 b): the blocks she reads, in the order she reads them.
 * Her sample replies are read under her way of writing, and corrected there.
 */
export const PERSONA_CORRECTION_SECTIONS = [
  'details',
  'limits',
  'lifestyle',
  'tastes',
  'intimate',
  'writing_style',
] as const;
export const PersonaCorrectionSectionSchema = z.enum(PERSONA_CORRECTION_SECTIONS);
export type PersonaCorrectionSection = z.infer<typeof PersonaCorrectionSectionSchema>;

/** `open` until the agency marks it handled (`done`): it then changed her sheet, or talked it over with her. */
export const PERSONA_CORRECTION_STATES = ['open', 'done'] as const;
export const PersonaCorrectionStateSchema = z.enum(PERSONA_CORRECTION_STATES);
export type PersonaCorrectionState = z.infer<typeof PersonaCorrectionStateSchema>;

/** What she writes in one correction: a few sentences, never a new sheet. */
export const PERSONA_CORRECTION_TEXT_MAX = 600;

/** Her open corrections at once: past this, the agency has not read the ones before (429 `persona_corrections_limited`). */
export const PERSONA_CORRECTIONS_OPEN_MAX = 20;

/**
 * A correction she proposed from Moi › Persona (recette CREA-01 b, Charles 05/11 « go recos »): she reads her sheet, the
 * agency changes it. Never deleted; the agency marks it handled.
 */
export const PersonaCorrectionSchema = z.strictObject({
  id: PersonaCorrectionIdSchema,
  section: PersonaCorrectionSectionSchema,
  text: z.string().min(1).max(PERSONA_CORRECTION_TEXT_MAX),
  state: PersonaCorrectionStateSchema,
  createdAt: z.iso.datetime(),
  doneAt: z.iso.datetime().nullable(),
});
export type PersonaCorrection = z.infer<typeof PersonaCorrectionSchema>;

/** `GET /v1/creators/:creatorId/persona/corrections`: hers (to her, or to the owner and a manager), newest first. */
export const PersonaCorrectionListSchema = z.strictObject({
  corrections: z.array(PersonaCorrectionSchema),
});
export type PersonaCorrectionList = z.infer<typeof PersonaCorrectionListSchema>;

/**
 * `POST /v1/creators/:creatorId/persona/corrections`, the creator only → 201 `PersonaCorrection`. `id` is chosen once
 * per form: sent twice (double tap, retry), the server answers the correction it already stored.
 */
export const ProposePersonaCorrectionBodySchema = z.strictObject({
  id: PersonaCorrectionIdSchema,
  section: PersonaCorrectionSectionSchema,
  text: z.string().trim().min(1).max(PERSONA_CORRECTION_TEXT_MAX),
});
export type ProposePersonaCorrectionBody = z.infer<typeof ProposePersonaCorrectionBodySchema>;

/** `POST /v1/creators/:creatorId/persona/corrections/:correctionId/done`, the owner only → 200 `PersonaCorrection`. */
export const PersonaCorrectionParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  correctionId: PersonaCorrectionIdSchema,
});
export type PersonaCorrectionParams = z.infer<typeof PersonaCorrectionParamsSchema>;

/**
 * The error codes of her corrections: `persona_corrections_limited` 429, she has `PERSONA_CORRECTIONS_OPEN_MAX` open
 * already ; `persona_correction_conflict` 409, this id already holds another correction ; `persona_correction_not_found`
 * 404, no correction of hers has this id. Nothing is stored on any of them.
 */
export const PERSONA_CORRECTION_ERROR_CODES = [
  'persona_corrections_limited',
  'persona_correction_conflict',
  'persona_correction_not_found',
] as const;
export type PersonaCorrectionErrorCode = (typeof PERSONA_CORRECTION_ERROR_CODES)[number];
