import {
  AuditEntryIdSchema,
  EVENT_PAYLOADS,
  EventIdSchema,
  networkOf,
  newId,
  SIGN_IN_REFUSALS_ALERT_AT,
  SIGN_IN_REFUSALS_WINDOW_MINUTES,
  UserRoleSchema,
  type SecurityAlertPayload,
  type UserRole,
} from '@nirvana/contracts';
import { eq, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';

/**
 * The security alerts of the server's own files (ADR 0046 § 8): sign-ins, refusals, second factor resets. Each is
 * written with the owner role (`withAdmin`, no creator: the outbox's RLS) next to its line of `audit_log`, and the
 * Telegram module tells it to the urgent groups. The modules (persona, conversations, connectors) write theirs in
 * their own transaction, with the same contract.
 */

/** One `security_alert` row in the outbox, in the caller's transaction. */
export async function publishSecurityAlert(
  tx: Transaction,
  creatorId: string | null,
  alert: SecurityAlertPayload,
  at: Date = new Date(),
): Promise<void> {
  await tx.insert(schema.domainEvents).values({
    id: newId(EventIdSchema),
    creatorId,
    type: 'security_alert',
    payload: EVENT_PAYLOADS.security_alert.parse(alert),
    actor: 'system',
    correlationId: `security:${alert.reason}:${at.toISOString()}`,
    createdAt: at,
  });
}

/** The role of an account, null if it does not exist. */
export async function roleOf(tx: Transaction, userId: string): Promise<UserRole | null> {
  const [row] = await tx
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const role = UserRoleSchema.safeParse(row?.role);
  return role.success ? role.data : null;
}

/**
 * A sign-in that no trusted device spared (a code was asked, or none is set yet): told when it is the owner's
 * (ADR 0046 § 8). Its line of `audit_log` (`auth.login`) is the session's, written when it opened.
 */
export function alertOwnerSignIn(adminDb: Database, userId: string, ip: string | null): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    if ((await roleOf(tx, userId)) !== 'owner') return;
    await publishSecurityAlert(tx, null, {
      reason: 'new_device_sign_in',
      userId,
      role: 'owner',
      network: networkOf(ip),
    });
  });
}

/**
 * The refusals counted for an alert: a password at sign-in, a code, a passkey the server refused at sign-in (ADR 0053
 * § 6), a confirmation before a sensitive action (password and code, or a gesture).
 */
const REFUSAL_ACTIONS = [
  'auth.sign_in_refused',
  'auth.code_refused',
  'auth.passkey_refused',
  'auth.reauthentication_refused',
] as const;
export type RefusalAction = (typeof REFUSAL_ACTIONS)[number];

/**
 * A refused password or code on an account: its line of `audit_log`, then, from the fifth of the last 15 minutes,
 * an alert, at most one per account in that window (a lasting attack is told once per quarter of an hour, not at
 * each try). The account's lock serialises two refusals at the same instant.
 */
export function recordRefusal(
  adminDb: Database,
  refusal: { readonly userId: string; readonly action: RefusalAction; readonly ip: string | null },
): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`refusals:${refusal.userId}`}, 0))`);
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: refusal.userId,
      action: refusal.action,
      entity: 'user',
      entityId: refusal.userId,
      ip: refusal.ip,
    });
    const window = sql`now() - make_interval(mins => ${SIGN_IN_REFUSALS_WINDOW_MINUTES})`;
    const counted = await tx.execute<{ refusals: number; told: boolean }>(sql`
      select
        (select count(*)::int from audit_log
          where user_id = ${refusal.userId} and created_at > ${window}
            and action in (${sql.join(
              REFUSAL_ACTIONS.map((action) => sql`${action}`),
              sql`, `,
            )})) as refusals,
        exists (select 1 from domain_events
          where type = 'security_alert' and created_at > ${window}
            and payload->>'reason' = 'sign_in_refusals' and payload->>'userId' = ${refusal.userId}) as told`);
    const row = counted.rows[0];
    if (row === undefined || row.refusals < SIGN_IN_REFUSALS_ALERT_AT || row.told) return;
    await publishSecurityAlert(tx, null, {
      reason: 'sign_in_refusals',
      userId: refusal.userId,
      role: await roleOf(tx, refusal.userId),
      network: networkOf(refusal.ip),
      refusals: row.refusals,
      windowMinutes: SIGN_IN_REFUSALS_WINDOW_MINUTES,
    });
  });
}
