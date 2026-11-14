import { z } from 'zod';

import { PlatformScriptMomentSchema } from './connector';
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
  /** The latest sync of any of her accounts; `null` before a first one. */
  syncedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type VaultView = z.infer<typeof VaultViewSchema>;

/** `POST /v1/creators/:creatorId/vault/sync`: the accounts whose sync was asked (a sync already waiting is kept). */
export const VaultSyncAskedSchema = z.strictObject({ accounts: z.number().int().min(0) });
export type VaultSyncAsked = z.infer<typeof VaultSyncAskedSchema>;
