import {
  AuditEntryIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  EventIdSchema,
  JOB_MAX_ATTEMPTS,
  jobKeyFor,
  KillSwitchIdSchema,
  KillSwitchScopeSchema,
  newId,
  queueNameFor,
  resumeRunAt,
  type KillSwitchScope,
} from '@nirvana/contracts';
import {
  and,
  decryptSecret,
  encryptSecret,
  eq,
  keyVersionOf,
  schema,
  sql,
  withAdmin,
  type Database,
  type EncryptionKey,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

/**
 * Operator commands run from a terminal on the server (operations.md, runbooks). Owner role: they act across
 * creators. Each one leaves an `audit_log` line with `user_id` null, the actor being whoever holds the server.
 */

export const KillSwitchInputSchema = z
  .object({
    active: z.boolean(),
    scope: KillSwitchScopeSchema,
    scopeId: z.uuid().nullable(),
    reason: z.string().min(1),
  })
  .refine((input) => (input.scope === 'global') === (input.scopeId === null), {
    message: 'global sans identifiant ; creator et conversation avec un identifiant',
  });
export type KillSwitchInput = z.infer<typeof KillSwitchInputSchema>;

/** The creator a scoped switch belongs to (RLS of `kill_switches`); `null` for the global one. */
async function creatorOf(
  tx: Transaction,
  scope: KillSwitchScope,
  scopeId: string | null,
): Promise<string | null> {
  if (scopeId === null) return null;
  if (scope === 'creator') return CreatorIdSchema.parse(scopeId);
  const [row] = await tx
    .select({ creatorId: schema.conversations.creatorId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, ConversationIdSchema.parse(scopeId)));
  if (row === undefined) throw new Error('Conversation introuvable');
  return row.creatorId;
}

/**
 * Turns a kill switch on or off (message-flow.md §6): the latest row of a scope decides, `respond` and `send`
 * re-read it on every run. Writes the switch, its `kill_switch_toggled` event and the audit line together.
 */
export async function setKillSwitch(adminDb: Database, input: KillSwitchInput): Promise<void> {
  const parsed = KillSwitchInputSchema.parse(input);
  return withAdmin(adminDb, async (tx) => {
    const creatorId = await creatorOf(tx, parsed.scope, parsed.scopeId);
    // Same lock and clock as the Dashboard's control (PUT /v1/agent/mode): a click and a command land in order.
    if (parsed.scope === 'creator' && creatorId !== null) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent_mode:${creatorId}`}, 0))`);
    }
    const at = new Date();
    await tx.insert(schema.killSwitches).values({
      id: newId(KillSwitchIdSchema),
      scope: parsed.scope,
      scopeId: parsed.scopeId,
      creatorId,
      active: parsed.active,
      reason: parsed.reason,
      setBy: 'ops',
      setAt: sql`clock_timestamp()`,
    });
    await tx.insert(schema.domainEvents).values({
      id: newId(EventIdSchema),
      creatorId,
      type: 'kill_switch_toggled',
      payload: { scope: parsed.scope, scopeId: parsed.scopeId, active: parsed.active, reason: parsed.reason },
      actor: 'system',
      correlationId: `ops:${at.toISOString()}`,
      createdAt: at,
    });
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: parsed.active ? 'kill_switch.on' : 'kill_switch.off',
      entity: 'kill_switch',
      entityId: parsed.scopeId,
      details: { scope: parsed.scope, reason: parsed.reason },
    });
    if (!parsed.active) await answerWhoWaited(tx, parsed, creatorId, `ops:${at.toISOString()}`);
  });
}

/**
 * A fan who wrote while a switch was on stays `pending`: `respond` ran, saw the switch and did nothing. Lifting it
 * answers each of them now (recette R-G2); a switch still on elsewhere keeps `respond` doing nothing, as before.
 */
async function answerWhoWaited(
  tx: Transaction,
  input: KillSwitchInput,
  creatorId: string | null,
  correlationId: string,
): Promise<void> {
  const pending = eq(schema.conversations.state, 'pending');
  const waiting = await tx
    .select({ id: schema.conversations.id, creatorId: schema.conversations.creatorId })
    .from(schema.conversations)
    .where(
      input.scope === 'global'
        ? pending
        : input.scope === 'creator' && creatorId !== null
          ? and(pending, eq(schema.conversations.creatorId, creatorId))
          : and(pending, eq(schema.conversations.id, ConversationIdSchema.parse(input.scopeId))),
    )
    .orderBy(sql`${schema.conversations.lastInboundAt} asc nulls last`, schema.conversations.id);
  // One after the other, the longest wait first, as from the Dashboard (`setAgentMode`).
  const now = new Date();
  for (const [index, conversation] of waiting.entries()) {
    await tx.execute(sql`select public.enqueue_job(
      task => 'conversation.respond',
      payload => ${JSON.stringify({ creatorId: conversation.creatorId, conversationId: conversation.id, correlationId })}::jsonb,
      queue_name => ${queueNameFor(conversation.id)},
      run_at => ${resumeRunAt(index, now).toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['conversation.respond']}::int,
      job_key => ${jobKeyFor('conversation.respond', conversation.id)}
    )`);
  }
}

/** Signs out every dashboard session, or one user's (by e-mail). Returns how many were revoked. */
export function revokeDashboardSessions(adminDb: Database, email: string | null): Promise<number> {
  return withAdmin(adminDb, async (tx) => {
    const result =
      email === null
        ? await tx.delete(schema.session).returning({ id: schema.session.id })
        : await tx
            .delete(schema.session)
            .where(sql`${schema.session.userId} in (select id from "user" where email = ${email})`)
            .returning({ id: schema.session.id });
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: 'auth.sessions_revoked',
      entity: 'session',
      entityId: null,
      details: { scope: email === null ? 'all' : 'user', revoked: result.length },
    });
    return result.length;
  });
}

/**
 * After a key rotation (`SESSION_ENCRYPTION_KEYS=v2:…,v1:…`, rotate-secrets.md): re-seals every platform session
 * still under an older key with the newest one. Idempotent; returns how many were rewritten.
 */
export function reencryptPlatformSessions(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<number> {
  const current = keys[0]?.version;
  if (current === undefined) throw new Error('SESSION_ENCRYPTION_KEYS est vide');
  return withAdmin(adminDb, async (tx) => {
    const rows = await tx
      .select({ id: schema.platformAccounts.id, sealed: schema.platformAccounts.sessionCiphertext })
      .from(schema.platformAccounts)
      .for('update');
    let rewritten = 0;
    for (const row of rows) {
      if (row.sealed === null || keyVersionOf(row.sealed) === current) continue;
      const session = decryptSecret(row.sealed, keys, row.id);
      await tx
        .update(schema.platformAccounts)
        .set({ sessionCiphertext: encryptSecret(session, keys, row.id) })
        .where(eq(schema.platformAccounts.id, row.id));
      rewritten += 1;
    }
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: 'connector.sessions_reencrypted',
      entity: 'platform_account',
      entityId: null,
      details: { keyVersion: current, rewritten },
    });
    return rewritten;
  });
}
