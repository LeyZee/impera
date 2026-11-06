import { z } from 'zod';

import { InvitationLinkTokenSchema, PASSWORD_MAX_LENGTH } from './invitation-links';

/**
 * « Mot de passe oublié » (SEC-05 lot 3, ADR 0068 §§ 2–5): an account of the agency asks a new password from the
 * sign-in page; the link goes to its private Telegram chat (lot 2), never to the page.
 */

/** A link is valid 15 minutes, and one is made per account every 5 minutes at most (ADR 0068 §§ 2–3). */
export const PASSWORD_RESET_LINK_MINUTES = 15;
export const PASSWORD_RESET_REQUEST_MINUTES = 5;

/** Where the web app reads the token, in the fragment: `/mot-de-passe-oublie#t=…`; without one, the request form. */
export const PASSWORD_RESET_PAGE = '/mot-de-passe-oublie';

export const RequestPasswordResetBodySchema = z.object({ email: z.string().trim().max(254) });
export type RequestPasswordResetBody = z.infer<typeof RequestPasswordResetBodySchema>;

/**
 * The one answer of `POST /v1/auth/password-reset` (202), known account or not, linked chat or not: the page shows
 * this sentence as it is.
 */
export const PASSWORD_RESET_REQUESTED_MESSAGE =
  'Si cette adresse a un compte relié à Telegram, le lien vient d’y partir ; il vaut 15 minutes. Sinon, demande à un autre propriétaire.';
export const PasswordResetRequestedSchema = z.object({
  message: z.literal(PASSWORD_RESET_REQUESTED_MESSAGE),
});
export type PasswordResetRequested = z.infer<typeof PasswordResetRequestedSchema>;

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
