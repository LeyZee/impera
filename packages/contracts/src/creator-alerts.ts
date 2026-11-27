import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * The Alertes tab of a creator's sheet (ADR 0150): her alerts as the agency watches them, and for each one, by role,
 * whether it rings, stays silent in the CRM, or reaches nobody. The owner's alone; she never sees it. Her own
 * Notifications (Moi › Notifications) are another thing, chosen by her.
 */

/** One line of the tab, in the order the tab shows them (ADR 0150 § B). */
export const CREATOR_ALERT_CODES = [
  /** A human relay for safety: maybe a minor, non-consent, distress, a meeting, manipulation. Locked. */
  'safety_handoff',
  /** The fan doubts it is her (system alert `identity_doubt`). */
  'identity_doubt',
  /** A sale read in the platform's register (`sale_detected`). */
  'sale',
  /** Something sold outside the scripts, put forward by the agent or asked by the fan (ADR 0150 § D). */
  'offer_proposed',
  /** A script step's price on the platform is no longer the one decided (system alert `script_price`). */
  'script_price',
  /** The agent would open a script and none is playable for this fan (ADR 0150 § C). */
  'scripts_exhausted',
  /** A word of her persona, or one of her own alerts (P4-01). */
  'her_alerts',
  /** The agency's AI budget: threshold, cap reached, credits low. One per day and role, not one per creator. */
  'ai_budget',
  /** The platform session expired. */
  'session_expired',
  /**
   * A créneau began on one of her accounts with nobody answering: no chatter in post, the agent not in Automatique,
   * and a fan wrote in the 24 hours before (ADR 0094 § 1, « compte sans personne »). Never to a chatter.
   */
  'uncovered_account',
] as const;
export const CreatorAlertCodeSchema = z.enum(CREATOR_ALERT_CODES);
export type CreatorAlertCode = z.infer<typeof CreatorAlertCodeSchema>;

export const CREATOR_ALERT_FAMILIES = ['safety', 'sales', 'conversation', 'steering', 'system'] as const;
export const CreatorAlertFamilySchema = z.enum(CREATOR_ALERT_FAMILIES);
export type CreatorAlertFamily = z.infer<typeof CreatorAlertFamilySchema>;

export const CREATOR_ALERT_FAMILY: Readonly<Record<CreatorAlertCode, CreatorAlertFamily>> = {
  safety_handoff: 'safety',
  identity_doubt: 'safety',
  sale: 'sales',
  offer_proposed: 'sales',
  script_price: 'sales',
  scripts_exhausted: 'conversation',
  her_alerts: 'conversation',
  ai_budget: 'system',
  session_expired: 'system',
  uncovered_account: 'steering',
};

/** Who an alert may reach. `chatter_on_shift`: the chatters whose shift covers her at the time of the alert. */
export const CREATOR_ALERT_ROLES = ['owner', 'manager', 'chatter_on_shift'] as const;
export const CreatorAlertRoleSchema = z.enum(CREATOR_ALERT_ROLES);
export type CreatorAlertRole = z.infer<typeof CreatorAlertRoleSchema>;

/** `deliver`: the CRM's bell and the phone. `muted`: the bell only. `off`: nothing; the history keeps it anyway. */
export const CREATOR_ALERT_MODES = ['deliver', 'muted', 'off'] as const;
export const CreatorAlertModeSchema = z.enum(CREATOR_ALERT_MODES);
export type CreatorAlertMode = z.infer<typeof CreatorAlertModeSchema>;

export const CreatorAlertRoutingSchema = z.object({
  owner: CreatorAlertModeSchema,
  manager: CreatorAlertModeSchema,
  chatter_on_shift: CreatorAlertModeSchema,
});
export type CreatorAlertRouting = z.infer<typeof CreatorAlertRoutingSchema>;

const routing = (
  owner: CreatorAlertMode,
  manager: CreatorAlertMode,
  chatter_on_shift: CreatorAlertMode,
): CreatorAlertRouting => ({ owner, manager, chatter_on_shift });

/** What applies without a row (ADR 0150 § 8): the code decides, never a prompt. */
export const CREATOR_ALERT_DEFAULTS: Readonly<Record<CreatorAlertCode, CreatorAlertRouting>> = {
  safety_handoff: routing('deliver', 'deliver', 'deliver'),
  identity_doubt: routing('deliver', 'muted', 'deliver'),
  sale: routing('deliver', 'muted', 'muted'),
  offer_proposed: routing('deliver', 'deliver', 'deliver'),
  script_price: routing('deliver', 'deliver', 'off'),
  scripts_exhausted: routing('deliver', 'deliver', 'muted'),
  her_alerts: routing('deliver', 'muted', 'deliver'),
  ai_budget: routing('deliver', 'deliver', 'off'),
  session_expired: routing('deliver', 'deliver', 'muted'),
  uncovered_account: routing('deliver', 'deliver', 'off'),
};

/** Always delivered to every role (ADR 0150 § 6): no mute, no off. These rules come before any setting. */
export const LOCKED_CREATOR_ALERTS: readonly CreatorAlertCode[] = ['safety_handoff'];

export function isCreatorAlertLocked(code: CreatorAlertCode): boolean {
  return LOCKED_CREATOR_ALERTS.includes(code);
}

/**
 * Never to a chatter (ADR 0094 § 3): the steering alerts are for the owner and the managers. Their « chatteur en
 * shift » is closed on `off`, whatever is asked; the code decides, never a setting.
 */
export const CHATTER_CLOSED_CREATOR_ALERTS: readonly CreatorAlertCode[] = ['uncovered_account'];

export function isClosedToChatters(code: CreatorAlertCode): boolean {
  return CHATTER_CLOSED_CREATOR_ALERTS.includes(code);
}

/** A routing the alert accepts: a locked one has every role on `deliver`, one closed to chatters has theirs `off`. */
export function acceptsRouting(code: CreatorAlertCode, routes: CreatorAlertRouting): boolean {
  if (isClosedToChatters(code) && routes.chatter_on_shift !== 'off') return false;
  return !isCreatorAlertLocked(code) || CREATOR_ALERT_ROLES.every((role) => routes[role] === 'deliver');
}

/** One line of the tab: its routing, stored or default. */
export const CreatorAlertLineSchema = z.object({
  code: CreatorAlertCodeSchema,
  family: CreatorAlertFamilySchema,
  locked: z.boolean(),
  /** Its « chatteur en shift » is closed on `off` (ADR 0094 § 3): the tab shows it shut. */
  chattersClosed: z.boolean(),
  routes: CreatorAlertRoutingSchema,
  /** No row stored for any role: the defaults of the code apply. */
  isDefault: z.boolean(),
});
export type CreatorAlertLine = z.infer<typeof CreatorAlertLineSchema>;

/** `GET /v1/creators/:creatorId/alerts`: every line, in the order of `CREATOR_ALERT_CODES`. */
export const CreatorAlertsViewSchema = z.object({
  creatorId: CreatorIdSchema,
  alerts: z.array(CreatorAlertLineSchema),
});
export type CreatorAlertsView = z.infer<typeof CreatorAlertsViewSchema>;

/** `PUT /v1/creators/:creatorId/alerts/:code`: the three roles, whole; the same body again changes nothing. */
export const SetCreatorAlertBodySchema = z.object({ routes: CreatorAlertRoutingSchema });
export type SetCreatorAlertBody = z.infer<typeof SetCreatorAlertBodySchema>;

export const CREATOR_ALERT_ERROR_CODES = [
  /** No such creator, or archived. */
  'creator_alert_creator_not_found',
  /** A locked alert set to anything but `deliver`, or one closed to chatters opened to them. */
  'creator_alert_locked_unprocessable',
] as const;
export type CreatorAlertErrorCode = (typeof CREATOR_ALERT_ERROR_CODES)[number];
