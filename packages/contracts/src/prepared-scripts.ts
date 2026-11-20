import { z } from 'zod';

import { PlatformScriptMomentSchema } from './connector';
import { CreatorIdSchema, PlatformAccountIdSchema } from './ids';
import { CurrencySchema } from './money';
import {
  BranchConditionSchema,
  PLATFORM_SCRIPT_NAME_MAX,
  PLATFORM_SCRIPT_REF_MAX,
  PLATFORM_SCRIPT_STEP_MEDIA_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  PLATFORM_SCRIPT_STEPS_MAX,
  PLATFORM_SCRIPT_WARNING_CODES,
  PlatformScriptIdSchema,
} from './scripts';

/**
 * « Script en préparation » (ADR 0112 §§ 20-23): a script written in Impera's editor that does not exist at Reveal yet.
 * Never offered, never sent, without a `scriptRef`. Someone of the agency copies it into Reveal by hand once it is
 * « prêt à copier »; the next import recognises it when everything matches.
 */
export const PreparedScriptIdSchema = z.uuid().brand<'PreparedScriptId'>();
export type PreparedScriptId = z.infer<typeof PreparedScriptIdSchema>;

/** The key of a step or a branch inside one script: a client-made UUID, stable across saves. */
export const PreparedKeySchema = z.uuid();

/** The description of a script, as the agency writes it (ADR 0112 § 13). */
export const PREPARED_SCRIPT_DESCRIPTION_MAX = 2_000;
/** Branches in one step: the editor shows them side by side. */
export const PREPARED_STEP_BRANCHES_MAX = 4;
/** Fan messages asked before a step (ADR 0112 § C, the rhythm): a bound, not a rule of the method. */
export const PREPARED_STEP_RHYTHM_MAX = 20;
/** One message after the media (ADR 0112 § C): short, as a chat message. */
export const PREPARED_AFTER_MEDIA_MAX = 1_000;

const text = (max: number) => z.string().max(max);

/** A vault media, by the platform's id (`media_platform_refs.platform_media_id`): what Reveal's step names too. */
const PreparedMediaSchema = z.strictObject({
  ref: z.string().min(1).max(PLATFORM_SCRIPT_REF_MAX),
});

/** The messages sent after the media (ADR 0112 § C), each optional: just after, not read, read and not bought. */
const AfterMediaSchema = z.strictObject({
  justAfter: text(PREPARED_AFTER_MEDIA_MAX),
  unread: text(PREPARED_AFTER_MEDIA_MAX),
  readNotBought: text(PREPARED_AFTER_MEDIA_MAX),
});

export const PreparedBranchSchema = z.strictObject({
  key: PreparedKeySchema,
  /**
   * `null` while unset; ignored for the only branch of a step. A `previous_branch` rule names the `key` of a branch of
   * an earlier step, turned into its `stepRef` when the import recognises the script.
   */
  condition: BranchConditionSchema.nullable(),
  teaser: text(PLATFORM_SCRIPT_STEP_TEXT_MAX),
  offerText: text(PLATFORM_SCRIPT_STEP_TEXT_MAX),
  media: z.array(PreparedMediaSchema).max(PLATFORM_SCRIPT_STEP_MEDIA_MAX),
  afterMedia: AfterMediaSchema,
  /** Minor units, VAT included, as Reveal will show it; 0 for an offered step. */
  priceMinor: z.number().int().min(0).max(1_000_000),
  currency: CurrencySchema,
});
export type PreparedBranch = z.infer<typeof PreparedBranchSchema>;

export const PreparedStepSchema = z.strictObject({
  key: PreparedKeySchema,
  /** Fan messages before this step is sent (ADR 0112 § C). */
  rhythm: z.number().int().min(0).max(PREPARED_STEP_RHYTHM_MAX),
  branches: z.array(PreparedBranchSchema).min(1).max(PREPARED_STEP_BRANCHES_MAX),
});
export type PreparedStep = z.infer<typeof PreparedStepSchema>;

/** What the agency writes: everything a save sends, read back the same. */
export const PreparedScriptContentSchema = z.strictObject({
  name: text(PLATFORM_SCRIPT_NAME_MAX),
  description: text(PREPARED_SCRIPT_DESCRIPTION_MAX),
  /** « Se joue le jour / la nuit »: the script's moment, against which a mix is refused (ADR 0112 § 14). */
  moment: PlatformScriptMomentSchema,
  steps: z.array(PreparedStepSchema).min(1).max(PLATFORM_SCRIPT_STEPS_MAX),
});
export type PreparedScriptContent = z.infer<typeof PreparedScriptContentSchema>;

/** `editing` → `ready_to_copy` (« Prêt à copier ») → `matched` (recognised by an import, closed). */
export const PREPARED_SCRIPT_STATES = ['editing', 'ready_to_copy', 'matched'] as const;
export const PreparedScriptStateSchema = z.enum(PREPARED_SCRIPT_STATES);
export type PreparedScriptState = z.infer<typeof PreparedScriptStateSchema>;

/**
 * What keeps a script in preparation from « prêt à copier » (ADR 0112 §§ 13-14), each where it is. The refusals of § 14
 * are gaps too: nothing is copied that Reveal would then refuse at activation.
 */
export const PREPARED_SCRIPT_GAP_CODES = [
  'name_missing',
  'description_missing',
  'offer_text_missing',
  'media_missing',
  /** A media her vault no longer lists (removed at the platform, or never synced). */
  'media_absent',
  /** A photo or video without a description a human validated. */
  'media_not_described',
  'branch_unsettled',
  'branch_two_defaults',
  'branch_cheaper_on_spend',
  'branch_previous_unknown',
  'media_twice',
  /** A text touches what she never says, never does, or what disgusts her (her active persona). */
  'disgust',
  /** A condition in text that is empty. */
  'condition_text_missing',
] as const;
export const PreparedScriptGapCodeSchema = z.enum(PREPARED_SCRIPT_GAP_CODES);
export type PreparedScriptGapCode = z.infer<typeof PreparedScriptGapCodeSchema>;

export const PreparedScriptGapSchema = z.object({
  code: PreparedScriptGapCodeSchema,
  /** The step, from 0; `null` for the script itself. */
  step: z.number().int().min(0).nullable(),
  /** The branch's key; `null` for a step or the script. */
  branch: PreparedKeySchema.nullable(),
  /** For `disgust`: the entry of her persona touched, said as she wrote it. */
  term: z.string().nullable(),
});
export type PreparedScriptGap = z.infer<typeof PreparedScriptGapSchema>;

export const PreparedScriptWarningSchema = z.object({
  code: z.enum(PLATFORM_SCRIPT_WARNING_CODES),
  step: z.number().int().min(0),
  branch: PreparedKeySchema.nullable(),
});
export type PreparedScriptWarning = z.infer<typeof PreparedScriptWarningSchema>;

/**
 * What differs between a script « prêt à copier » and the native script of the same name that differs least (ADR 0112
 * § 23): what the screen says while the next import cannot recognise it.
 */
export const CopyDifferenceSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('name_not_found') }),
  z.object({ code: z.literal('steps_count'), expected: z.number().int(), found: z.number().int() }),
  z.object({
    code: z.literal('branches_count'),
    step: z.number().int().min(0),
    expected: z.number().int(),
    found: z.number().int(),
  }),
  /** No branch of that rank sells these media at this price. */
  z.object({ code: z.literal('branch_not_found'), step: z.number().int().min(0), branch: PreparedKeySchema }),
]);
export type CopyDifference = z.infer<typeof CopyDifferenceSchema>;

/** `GET /v1/creators/:creatorId/prepared-scripts[/:scriptId]`: owner and active managers of her list. */
export const PreparedScriptViewSchema = z.object({
  id: PreparedScriptIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  state: PreparedScriptStateSchema,
  /** Raised by each save: a save names the revision it was made on. */
  revision: z.number().int().min(1),
  content: PreparedScriptContentSchema,
  gaps: z.array(PreparedScriptGapSchema),
  warnings: z.array(PreparedScriptWarningSchema),
  /** The native script it became; `null` until an import recognises it. */
  matchedPlatformScriptId: PlatformScriptIdSchema.nullable(),
  /** « Prêt à copier » only: what differs from Reveal for now (`name_not_found` until it is copied); `null` otherwise. */
  copyDifferences: z.array(CopyDifferenceSchema).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PreparedScriptView = z.infer<typeof PreparedScriptViewSchema>;
export const PreparedScriptListSchema = z.array(PreparedScriptViewSchema);

/** `POST …/prepared-scripts`: under the client's id, so that the same send replays. */
export const CreatePreparedScriptBodySchema = z.strictObject({
  id: PreparedScriptIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  content: PreparedScriptContentSchema,
});
export type CreatePreparedScriptBody = z.infer<typeof CreatePreparedScriptBodySchema>;

/** `PUT …/prepared-scripts/:scriptId`: saved on `basedOnRevision`; a script « prêt à copier » goes back to editing. */
export const SavePreparedScriptBodySchema = z.strictObject({
  basedOnRevision: z.number().int().min(1),
  content: PreparedScriptContentSchema,
});
export type SavePreparedScriptBody = z.infer<typeof SavePreparedScriptBodySchema>;

/** `POST …/prepared-scripts/:scriptId/ready` and `…/editing`: the state changed on `basedOnRevision`. */
export const PreparedScriptStateBodySchema = z.strictObject({
  basedOnRevision: z.number().int().min(1),
});

export const PREPARED_SCRIPT_ERROR_CODES = [
  'prepared_script_not_found',
  /** The id is taken by another script, or the same with another content. */
  'prepared_script_conflict',
  /** Saved by someone else since the revision named: read it again. */
  'prepared_script_stale_conflict',
  /** Recognised by an import: closed for good. */
  'prepared_script_closed_conflict',
  /** « Prêt à copier » asked while something is missing. */
  'prepared_script_gaps_unprocessable',
  /** The account is not one of hers. */
  'prepared_script_account_invalid',
] as const;
export type PreparedScriptErrorCode = (typeof PREPARED_SCRIPT_ERROR_CODES)[number];
