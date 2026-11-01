import { z } from 'zod';

import { REAUTHENTICATION_ERROR_CODE } from './auth';
import { CountryCodeSchema } from './team';

/**
 * Invitation links (EQ-10, glossary « Lien d’invitation »): Nirvana sends no e-mail, so the owner shares a link (WhatsApp, the phone's share
 * sheet) for a member's first access or for a new password. The token travels in the URL fragment, then in a POST
 * body, never in a query string: it reaches neither the server's logs nor a `Referer` header.
 */

/** Why the link exists: the first access of a new member, or a new password chosen without e-mail. */
export const INVITATION_LINK_PURPOSES = ['invitation', 'reset'] as const;
export const InvitationLinkPurposeSchema = z.enum(INVITATION_LINK_PURPOSES);
export type InvitationLinkPurpose = z.infer<typeof InvitationLinkPurposeSchema>;

/** The shortest password Better Auth accepts (`emailAndPassword.minPasswordLength`), said on the page before sending. */
export const PASSWORD_MIN_LENGTH = 12;
/** Better Auth's default ceiling. */
export const PASSWORD_MAX_LENGTH = 128;

/** At least 128 random bits, base64url: what the page reads after `#t=` and posts back. */
export const InvitationLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/);

/**
 * `POST /v1/team/members/:memberId/invitation-link` (owner): a new link cancels the one before; valid 72 h. It needs a
 * recent sign-in (`requireRecentLogin`, otherwise 403 `reauthentication_forbidden`: the page asks for the password and
 * retries), and refuses a member who left (409 `member_left_conflict`, as every route of `/v1/team`).
 */
export const CreateInvitationLinkBodySchema = z.object({ purpose: InvitationLinkPurposeSchema });
export const InvitationLinkCreatedSchema = z.object({
  /** Built by the server, the token in its fragment: `/bienvenue#t=…` or `/nouveau-mot-de-passe#t=…`. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type InvitationLinkCreated = z.infer<typeof InvitationLinkCreatedSchema>;

/**
 * `POST /v1/invitation-links/inspect`: what the page shows before the link is used (« Bienvenue, Théo », the e-mail read
 * only); reading does not use it. Unknown, used, cancelled or expired all answer `invitation_link_not_found`, so the
 * answer tells nothing about which.
 */
export const InspectInvitationLinkBodySchema = z.object({ token: InvitationLinkTokenSchema });
export const InvitationLinkPreviewSchema = z.object({
  purpose: InvitationLinkPurposeSchema,
  email: z.email(),
  displayName: z.string().min(1),
  country: CountryCodeSchema,
  expiresAt: z.iso.datetime(),
});
export type InvitationLinkPreview = z.infer<typeof InvitationLinkPreviewSchema>;

/**
 * `POST /v1/invitation-links/redeem`: uses the link once (an atomic update), sets the password, ends the member's other
 * sessions, opens his own and answers `MeSchema`. A refused password answers 400 `password_invalid` with
 * `details.reason` (`PasswordInvalidReasonSchema`) and leaves the link unused: the member tries again.
 */
export const RedeemInvitationLinkBodySchema = z.object({
  token: InvitationLinkTokenSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type RedeemInvitationLinkBody = z.infer<typeof RedeemInvitationLinkBodySchema>;

/** `details.reason` of `password_invalid`: too short, too long, or refused by Better Auth. */
export const PasswordInvalidReasonSchema = z.enum(['too_short', 'too_long', 'refused']);
export type PasswordInvalidReason = z.infer<typeof PasswordInvalidReasonSchema>;

/** The error codes of these routes, besides `rate_limited` from the limiter of the redeem and inspect routes. */
export const INVITATION_LINK_ERROR_CODES = [
  'invitation_link_not_found',
  'password_invalid',
  'member_not_found',
  'member_left_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type InvitationLinkErrorCode = (typeof INVITATION_LINK_ERROR_CODES)[number];
