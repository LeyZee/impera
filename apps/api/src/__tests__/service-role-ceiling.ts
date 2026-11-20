/**
 * How many accesses each unit of the API makes through the service role, which crosses creators (ADR 0087 § 5, lot b;
 * SEC-16). `service-role-ceiling.test.ts` counts them from the sources and wants exactly these numbers.
 *
 * A number here only goes down. Lowering one comes with the change that removed the access. Raising one is the
 * exception: the access truly crosses creators, the task card says why, and the security review reads it.
 */
export const SERVICE_ROLE_CEILING: Readonly<Record<string, number>> = {
  'modules/ai-budget': 2,
  'modules/ai-usage': 9,
  'modules/alerts': 1,
  'modules/backups': 1,
  'modules/connectors': 35,
  'modules/content-drops': 29,
  'modules/contractors': 6,
  'modules/conversations': 1,
  'modules/creator-tasks': 1,
  'modules/creator-week': 2,
  // The agent's turn reads the creator's own custom price grid (ADR 0159): one creator per call, read only.
  'modules/custom-orders': 1,
  'modules/fans': 1,
  'modules/invoicing': 12,
  'modules/mcp': 1,
  'modules/media': 10,
  'modules/notifications': 3,
  'modules/payroll': 10,
  'modules/providers': 7,
  'modules/redirect-links': 2,
  'modules/rewards': 7,
  'modules/scheduling': 28,
  'modules/scripts': 20,
  'modules/supervision': 2,
  'modules/team': 1,
  'modules/telegram': 10,
  'modules/trends': 8,
  root: 52,
  scripts: 1,
  wiring: 7,
};

/** The whole on 20/11/2026, when the ceiling reached main (264), raised to 269 by her week (CR-16), then to 270 by the agent's read of her custom price grid (ADR 0159): the sum of the units never goes above it again. */
export const SERVICE_ROLE_TOTAL_AT_START = 270;
