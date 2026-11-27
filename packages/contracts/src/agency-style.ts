import { z } from 'zod';

import { AgencyStyleIdSchema } from './ids';
import { VoiceFormSettingsSchema } from './voice-form';

/**
 * The agency's base style (ADR 0173, Charles 26/11): how every creator of the agency writes unless her persona says
 * otherwise, kept in the base and never in the repo. Two texts, free and in French: her private messages, and her
 * public replies (comments under her posts). Beside them, the default form of her bubbles; her persona wins on each
 * rule. Written by the owner alone: a version saved, then activated, one active at a time.
 */
export const AGENCY_PRIVATE_STYLE_MAX = 8_000;
export const AGENCY_PUBLIC_STYLE_MAX = 4_000;

const styleText = (max: number) => z.string().trim().max(max);

const AgencyStyleContentSchema = z.strictObject({
  /** How she writes her private messages. Empty: none. */
  privateStyle: styleText(AGENCY_PRIVATE_STYLE_MAX),
  /** How she writes in public (her replies to comments). Empty: none. */
  publicStyle: styleText(AGENCY_PUBLIC_STYLE_MAX),
  /** The default form of her bubbles and her emoji streak; each rule absent, the code's. */
  form: VoiceFormSettingsSchema,
});
export type AgencyStyleContent = z.infer<typeof AgencyStyleContentSchema>;

/** `PUT /v1/agency/style`: a new version, never active, numbered after the last. */
export const SaveAgencyStyleBodySchema = AgencyStyleContentSchema;

export const AgencyStyleVersionSchema = AgencyStyleContentSchema.extend({
  id: AgencyStyleIdSchema,
  version: z.int().positive(),
  /** The one the agent writes with; at most one, set by the activation only. */
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export type AgencyStyleVersion = z.infer<typeof AgencyStyleVersionSchema>;

/** `GET /v1/agency/style`: the active version, and the latest versions, newest first. */
export const AgencyStyleOverviewSchema = z.strictObject({
  active: AgencyStyleVersionSchema.nullable(),
  versions: z.array(AgencyStyleVersionSchema),
});
export type AgencyStyleOverview = z.infer<typeof AgencyStyleOverviewSchema>;

export const ActivateAgencyStyleParamsSchema = z.strictObject({ versionId: AgencyStyleIdSchema });

/** The active version the screen read: an activation made since is never undone by a screen left open. */
export const ActivateAgencyStyleBodySchema = z.strictObject({
  expectedActive: AgencyStyleIdSchema.nullable(),
});

/**
 * The error codes of the base style (the suffix gives the status, api.md): `agency_style_conflict` 409, another
 * version was saved or activated since the screen read it; `agency_style_not_found` 404, no version has this id.
 */
export const AGENCY_STYLE_ERROR_CODES = ['agency_style_conflict', 'agency_style_not_found'] as const;
export type AgencyStyleErrorCode = (typeof AGENCY_STYLE_ERROR_CODES)[number];
