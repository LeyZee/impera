/**
 * How many accesses each unit of the API makes through the service role, which crosses creators (ADR 0087 § 5, lot b;
 * SEC-16). `service-role-ceiling.test.ts` counts them from the sources and wants exactly these numbers.
 *
 * A number here only goes down. Lowering one comes with the change that removed the access. Raising one is the
 * exception: the access truly crosses creators, the task card says why, and the security review reads it.
 */
export const SERVICE_ROLE_CEILING: Readonly<Record<string, number>> = {
  'modules/ai-budget': 2,
  // +1 for the forecast (ADR 0091 § 8): the owner's screen reads every creator's calls, sales and name, sums only.
  'modules/ai-usage': 10,
  'modules/alerts': 1,
  'modules/audit': 3,
  'modules/backups': 1,
  // +3 for the agency's key of the redirect service (INS-02): a table closed to the app role, read, kept and removed
  // through the owner's gesture; +1 for its re-sealing after a rotation of the encryption keys (ops command); +1 for
  // the hourly reading of the links' hours, which asks which creators have an attached link (identifiers only).
  'modules/connectors': 40,
  'modules/content-drops': 14,
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
  // The agent reads the agency's active base style (ADR 0173) out of any session: one row, read only, no creator's data.
  'modules/persona': 1,
  'modules/providers': 7,
  'modules/redirect-links': 2,
  'modules/rewards': 7,
  // +1 (EQ-23): the incident notice reads its facts and the agency's recipients across creators, under withAdmin.
  // +1 for the light feedback (ADR 0170, 26/11): each member's last opened shift and whether it has its feedback,
  // across creators, bounded to the members named; read only.
  // +1 for « compte sans personne » (ADR 0094 § 1): its job reads every creator's planning, agent and last fan
  // message to publish one event per account and créneau.
  'modules/scheduling': 31,
  'modules/scripts': 16,
  'modules/supervision': 2,
  'modules/team': 1,
  // -4 on 27/11/2026 (ADR 0176): Telegram keeps the creators' channels only.
  'modules/telegram': 6,
  'modules/trends': 8,
  // +2 for a live worker freeing its own locks on jobs whose completion was lost (recette COUV-14): Graphile's tables,
  // closed to the app role, as the release of dead workers' locks.
  // -1 on 27/11/2026 (ADR 0176): no « mot de passe oublié » asked from the sign-in page.
  root: 53,
  scripts: 1,
  // -2 on 27/11/2026 (ADR 0176): no sales nor alerts wired to Telegram.
  wiring: 5,
};

/**
 * The whole on 20/11/2026, when the ceiling reached main (264): the sum of the units never goes above it again. Raised
 * since: 269 by her week (CR-16, +5), 270 by the agent's read of her custom price grid (ADR 0159, +1), then 273 with
 * the audit journal (EQ-18), which reads `audit_log`, out of RLS by design, for the owner alone (+3), then 276 with
 * the agency's key of the redirect service (INS-02), a table closed to the app role (+3), and 277 with its
 * re-sealing by the ops command after a rotation of the encryption keys (+1), and 278 with the forecast of the AI
 * bill (ADR 0091 § 8), the owner's sums of every creator's calls and sales in one read (+1).
 */
export const SERVICE_ROLE_TOTAL_AT_START = 278;
