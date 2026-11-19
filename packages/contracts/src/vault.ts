import { z } from 'zod';

import { BlurhashSchema, PlatformScriptMomentSchema } from './connector';
import { PlatformSchema } from './enums';
import { CreatorIdSchema, PlatformAccountIdSchema } from './ids';

/**
 * `GET /v1/creators/:creatorId/vault` (ADR 0099 § 2 to 4, fiche vault-sync): her vault as the last sync read it,
 * folder by folder in the platform's order. Never a file, an address nor a link: the bytes stay at the platform.
 */
export const VaultMediaViewSchema = z.strictObject({
  platformMediaId: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio']),
  durationSeconds: z.number().int().min(0).nullable(),
  /** When it was uploaded, as the platform says it. */
  uploadedAt: z.iso.datetime({ offset: true }),
  /** The platform's text on it: a starting point never validated, shown as plain text only (ADR 0099 § 4). */
  platformDescription: z.string().nullable(),
  /** The platform's suggested range, in its minor unit: shown beside the price, never applied (§ 4). */
  suggestedPriceMinor: z
    .strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) })
    .nullable(),
  /** The platform's blurred preview, drawn as the tile (ADR 0030 § 4): a few colours, never the image. */
  blurhash: BlurhashSchema.nullable(),
  /** No longer listed by the platform at the last sync: kept, with its descriptions (ADR 0030 § 2). */
  removed: z.boolean(),
});
export type VaultMediaView = z.infer<typeof VaultMediaViewSchema>;

export const VaultFolderViewSchema = z.strictObject({
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  /** `null` for the vault's root. */
  folderRef: z.string().min(1).nullable(),
  folderName: z.string().nullable(),
  /** ☀️ or 🌙 read in the folder's name, which decides; `null` when it says neither or both. */
  moment: PlatformScriptMomentSchema.nullable(),
  media: z.array(VaultMediaViewSchema),
});
export type VaultFolderView = z.infer<typeof VaultFolderViewSchema>;

export const VaultViewSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  folders: z.array(VaultFolderViewSchema),
  /** The latest vault sync of any of her accounts that went through, changes or not; `null` before a first one. */
  syncedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type VaultView = z.infer<typeof VaultViewSchema>;

/** `POST /v1/creators/:creatorId/vault/sync`: the accounts whose sync was asked (a sync already waiting is kept). */
export const VaultSyncAskedSchema = z.strictObject({ accounts: z.number().int().min(0) });
export type VaultSyncAsked = z.infer<typeof VaultSyncAskedSchema>;

/**
 * What enters the CRM of her vault, and what is described (ADR 0145 § 5, amendment of 17/11): the sync reads the whole
 * list, the owner ticks a folder whole or a media alone. Nothing is ticked at first, the root included.
 */
export const VAULT_DESCRIBE_MAX = 500;
/** The beginning of a description shown under a tile: two lines at most on the screen. */
export const VAULT_EXCERPT_MAX = 160;
/**
 * What one description costs, in tenths of a euro cent, rounded up from what the vision spends: a photo about 0.4 c€
 * (5 photos ≈ 0.02 €, essai du 16/11 sur le PC), a video, read whole or as keyframes and a transcript, about three
 * times that. The screen says it on the button and the server in its estimate, the same figures; never billed: the
 * gateway's journal is the spend, and the daily cap still holds (ADR 0091).
 */
export const VAULT_DESCRIBE_COST_TENTHS = { image: 5, video: 15 } as const;

/**
 * Where a media's description stands: `none`, never asked; `asked`, waiting for its run; `described`, it has its
 * media (described, or linked to a media of the same bytes); `to_agency`, the vision could not read it and it waits for
 * the agency's text, never an invented one.
 */
export const VaultDescriptionStateSchema = z.enum(['none', 'asked', 'described', 'to_agency']);
export type VaultDescriptionState = z.infer<typeof VaultDescriptionStateSchema>;

export const VaultFolderChoiceSchema = z.strictObject({
  platformAccountId: PlatformAccountIdSchema,
  /** `null` for the vault's root, a folder like the others here. */
  folderRef: z.string().min(1).max(200).nullable(),
  /** The folder ticked whole: its media are imported, but those unticked one by one. */
  imported: z.boolean(),
});
export type VaultFolderChoice = z.infer<typeof VaultFolderChoiceSchema>;

export const VaultMediaChoiceSchema = z.strictObject({
  platformAccountId: PlatformAccountIdSchema,
  platformMediaId: z.string().min(1).max(200),
  /** Imported or not, its folder's tick and its own read together. */
  imported: z.boolean(),
  description: VaultDescriptionStateSchema,
  /** The beginning of its latest description, plain text; `null` while it has none. */
  excerpt: z.string().max(VAULT_EXCERPT_MAX).nullable(),
});
export type VaultMediaChoice = z.infer<typeof VaultMediaChoiceSchema>;

/** `GET /v1/creators/:creatorId/vault/choices`: the ticks and the descriptions, beside `VaultView`. */
export const VaultChoicesViewSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  folders: z.array(VaultFolderChoiceSchema),
  media: z.array(VaultMediaChoiceSchema),
});
export type VaultChoicesView = z.infer<typeof VaultChoicesViewSchema>;

/**
 * `PUT /v1/creators/:creatorId/vault/choices`, the owner's: a folder ticked or unticked whole (its media's own ticks
 * go), or media one by one (a tick equal to its folder's is no tick of its own).
 */
export const VaultChoicesChangeSchema = z
  .strictObject({
    platformAccountId: PlatformAccountIdSchema,
    folders: z
      .array(z.strictObject({ folderRef: z.string().min(1).max(200).nullable(), imported: z.boolean() }))
      .max(200),
    media: z
      .array(z.strictObject({ platformMediaId: z.string().min(1).max(200), imported: z.boolean() }))
      .max(VAULT_DESCRIBE_MAX),
  })
  .refine((change) => change.folders.length + change.media.length > 0, 'nothing to change');
export type VaultChoicesChange = z.infer<typeof VaultChoicesChangeSchema>;

/**
 * `POST /v1/creators/:creatorId/vault/describe`, the owner's, in two steps: without `confirm`, the estimate; with the
 * count and the cost it showed, the run. An estimate that moved meanwhile answers the new one, nothing asked.
 */
export const VaultDescribeAskSchema = z.strictObject({
  platformAccountId: PlatformAccountIdSchema,
  platformMediaIds: z.array(z.string().min(1).max(200)).min(1).max(VAULT_DESCRIBE_MAX),
  confirm: z.strictObject({ count: z.number().int().min(1), costCents: z.number().int().min(0) }).nullable(),
  /** One per gesture: the same key asked again answers what it asked, nothing twice. */
  idempotencyKey: z.uuid(),
});
export type VaultDescribeAsk = z.infer<typeof VaultDescribeAskSchema>;

export const VaultDescribeAnswerSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('estimate'),
    /** What would be described: imported, still listed, not a voice note, never described nor asked. */
    count: z.number().int().min(0),
    photos: z.number().int().min(0),
    videos: z.number().int().min(0),
    /** Left out, and why: never counted twice. */
    alreadyDescribed: z.number().int().min(0),
    alreadyAsked: z.number().int().min(0),
    notImported: z.number().int().min(0),
    notDescribable: z.number().int().min(0),
    /** An estimate, in euro cents, rounded up. */
    costCents: z.number().int().min(0),
    /** What is left of today's AI cap, in euro cents. */
    capLeftCents: z.number().int().min(0),
  }),
  z.strictObject({ status: z.literal('asked'), count: z.number().int().min(0) }),
]);
export type VaultDescribeAnswer = z.infer<typeof VaultDescribeAnswerSchema>;
