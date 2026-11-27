import { z } from 'zod';

import { InvitationLinkTokenSchema, PASSWORD_MAX_LENGTH } from './invitation-links';

/**
 * « Mot de passe oublié » (SEC-05 lot 3, ADR 0068 §§ 2–5, amended 27/11/2026): a link to choose a new password, made
 * by the agency (EQ-10) or on the server (`pnpm ops:password-reset-link`), never asked from the sign-in page.
 */

/** A link is valid 15 minutes, and one is made per account every 5 minutes at most (ADR 0068 §§ 2–3). */
export const PASSWORD_RESET_LINK_MINUTES = 15;
export const PASSWORD_RESET_REQUEST_MINUTES = 5;

/** Where the web app reads the token, in the fragment: `/mot-de-passe-oublie#t=…`; without one, where to get it. */
export const PASSWORD_RESET_PAGE = '/mot-de-passe-oublie';

export const PasswordResetTokenBodySchema = z.object({ token: InvitationLinkTokenSchema });
export type PasswordResetTokenBody = z.infer<typeof PasswordResetTokenBodySchema>;

/**
 * The new password, read as a plain string (bounded) so that one out of bounds answers `password_invalid` with its
 * reason, as the page expects (same rule as the invitation page).
 */
export const RedeemPasswordResetBodySchema = z.object({
  token: InvitationLinkTokenSchema,
  password: z.string().max(4 * PASSWORD_MAX_LENGTH),
});
export type RedeemPasswordResetBody = z.infer<typeof RedeemPasswordResetBodySchema>;

/** What the page shows before the new password is typed; reading does not use the link. */
export const PasswordResetPreviewSchema = z.object({ email: z.email(), expiresAt: z.iso.datetime() });
export type PasswordResetPreview = z.infer<typeof PasswordResetPreviewSchema>;

/**
 * Codes of `/v1/auth/password-reset/*`: a link unknown, used, replaced or expired is one answer (404); a password
 * refused is `password_invalid` with its reason, as on the invitation page.
 */
export const PASSWORD_RESET_ERROR_CODES = ['password_reset_link_not_found', 'password_invalid'] as const;
