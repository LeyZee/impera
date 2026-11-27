import {
  CREATOR_ALERT_CODES,
  CREATOR_ALERT_DEFAULTS,
  CREATOR_ALERT_FAMILY,
  CREATOR_ALERT_ROLES,
  isClosedToChatters,
  isCreatorAlertLocked,
  type CreatorAlertCode,
  type CreatorAlertLine,
  type CreatorAlertMode,
  type CreatorAlertRole,
  type CreatorAlertRouting,
} from '@impera/contracts';

/** One stored choice: an alert of hers, a role, its mode (ADR 0150 § F). */
export interface CreatorAlertRouteRow {
  readonly alertCode: CreatorAlertCode;
  readonly role: CreatorAlertRole;
  readonly mode: CreatorAlertMode;
}

/**
 * The tab's lines from her stored choices, pure: every alert in the contract's order, each role on its stored mode or
 * the code's default. A locked alert is always `deliver` for every role, and one closed to chatters always `off` for
 * them (ADR 0094 § 3), whatever a row says (it never should).
 */
export function creatorAlertLines(rows: readonly CreatorAlertRouteRow[]): CreatorAlertLine[] {
  return CREATOR_ALERT_CODES.map((code) => {
    const locked = isCreatorAlertLocked(code);
    const chattersClosed = isClosedToChatters(code);
    const stored = rows.filter((row) => row.alertCode === code);
    const modeOf = (role: CreatorAlertRole): CreatorAlertMode => {
      if (locked) return 'deliver';
      if (chattersClosed && role === 'chatter_on_shift') return 'off';
      return stored.find((row) => row.role === role)?.mode ?? CREATOR_ALERT_DEFAULTS[code][role];
    };
    return {
      code,
      family: CREATOR_ALERT_FAMILY[code],
      locked,
      chattersClosed,
      routes: {
        owner: modeOf('owner'),
        manager: modeOf('manager'),
        chatter_on_shift: modeOf('chatter_on_shift'),
      },
      isDefault: stored.length === 0,
    };
  });
}

/** The rows to store for a choice: one per role. */
export function routeRowsOf(code: CreatorAlertCode, routes: CreatorAlertRouting): CreatorAlertRouteRow[] {
  return CREATOR_ALERT_ROLES.map((role) => ({ alertCode: code, role, mode: routes[role] }));
}
