import { z } from 'zod';

import { SocialAccountIdSchema } from './ids';

/**
 * « Ses comptes » (ADR 0143 § C): her accounts on other platforms, each with its use, entered by the owner in the CRM.
 * Real data: never in the repository, a fixture or a versioned prompt. The agent gives one only for the use a fan looks
 * for, and only one the owner marked « l'agent peut le donner »; code decides it, never the model (§ 18).
 */

export const SOCIAL_ACCOUNT_PLATFORMS = ['instagram', 'tiktok', 'x', 'youtube', 'twitch', 'other'] as const;
export const SocialAccountPlatformSchema = z.enum(SOCIAL_ACCOUNT_PLATFORMS);
export type SocialAccountPlatform = z.infer<typeof SocialAccountPlatformSchema>;

/** What the account is for: her lives, her practice (ADR 0143 § A), her own, or anything else. */
export const SOCIAL_ACCOUNT_USAGES = ['lives', 'practice', 'personal', 'other'] as const;
export const SocialAccountUsageSchema = z.enum(SOCIAL_ACCOUNT_USAGES);
export type SocialAccountUsage = z.infer<typeof SocialAccountUsageSchema>;

export const SOCIAL_ACCOUNTS_MAX = 12;
export const SOCIAL_ACCOUNT_USERNAME_MAX = 60;

/**
 * A user name as a fan types it: letters, digits, dot, underscore, hyphen, never a link nor a space. A leading « @ »
 * is dropped.
 */
export const SocialAccountUsernameSchema = z
  .string()
  .trim()
  .transform((name) => name.replace(/^@/u, ''))
  .pipe(
    z
      .string()
      .min(1)
      .max(SOCIAL_ACCOUNT_USERNAME_MAX)
      .regex(/^[\p{L}\p{N}._-]+$/u, 'Le nom d’utilisateur seul, sans lien ni espace'),
  );

/** One of her accounts as the CRM stores it. `agentMayShare` is off until the owner turns it on (§ 20). */
export const SocialAccountSchema = z.strictObject({
  id: SocialAccountIdSchema,
  platform: SocialAccountPlatformSchema,
  /** As stored: already read by `SocialAccountUsernameSchema` when it came in. */
  username: z.string().min(1).max(SOCIAL_ACCOUNT_USERNAME_MAX),
  usage: SocialAccountUsageSchema,
  agentMayShare: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type SocialAccount = z.infer<typeof SocialAccountSchema>;

/** `GET /v1/creators/:creatorId/social-accounts`, the owner and a manager: hers, in the owner's order. */
export const SocialAccountListSchema = z.strictObject({
  accounts: z.array(SocialAccountSchema).max(SOCIAL_ACCOUNTS_MAX),
});
export type SocialAccountList = z.infer<typeof SocialAccountListSchema>;

/**
 * `PUT /v1/creators/:creatorId/social-accounts`, the owner only → 200 `SocialAccountList`: the whole list, in its order. An
 * account keeps its `id`; one left out is removed. Each change of « l'agent peut le donner » is audited.
 */
export const PutSocialAccountsBodySchema = z
  .strictObject({
    accounts: z
      .array(
        z.strictObject({
          id: SocialAccountIdSchema,
          platform: SocialAccountPlatformSchema,
          username: SocialAccountUsernameSchema,
          usage: SocialAccountUsageSchema,
          agentMayShare: z.boolean().default(false),
        }),
      )
      .max(SOCIAL_ACCOUNTS_MAX),
  })
  .refine(
    ({ accounts }) =>
      new Set(accounts.map((a) => `${a.platform}:${a.username.toLowerCase()}`)).size === accounts.length,
    { message: 'Ce compte est déjà dans la liste', path: ['accounts'] },
  )
  .refine(({ accounts }) => new Set(accounts.map((a) => a.id)).size === accounts.length, {
    message: 'Deux comptes ont le même identifiant',
    path: ['accounts'],
  });
export type PutSocialAccountsBody = z.infer<typeof PutSocialAccountsBodySchema>;
