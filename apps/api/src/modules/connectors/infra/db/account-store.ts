import {
  AuditEntryIdSchema,
  ConnectorConfigSchema,
  CreatorIdSchema,
  EventIdSchema,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  accountQueueNameFor,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  SessionStateSchema,
  type JobName,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, withTenant, type Database, type Transaction } from '@nirvana/db';

import type { AccountJobs, AccountStore, ConnectorAccount, EventMeta } from '../../domain/ports';

const POLLABLE_STATES = ['valid', 'warning'];

function toAccount(row: typeof schema.platformAccounts.$inferSelect): ConnectorAccount {
  return {
    id: PlatformAccountIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platform: PlatformSchema.parse(row.platform),
    sessionState: SessionStateSchema.parse(row.sessionState),
    lastPollAt: row.lastPollAt,
    consecutiveErrors: row.consecutiveErrors,
    pausedUntil: row.pausedUntil,
    // A bad configuration falls back to the defaults rather than stopping the account.
    config: ConnectorConfigSchema.catch(ConnectorConfigSchema.parse({})).parse(row.connectorConfig),
  };
}

async function insertEvent(
  tx: Transaction,
  creatorId: string,
  body: { type: string; payload: unknown },
  meta: EventMeta,
): Promise<void> {
  await tx.insert(schema.domainEvents).values({
    id: newId(EventIdSchema),
    creatorId,
    type: body.type,
    payload: body.payload,
    actor: 'system',
    correlationId: meta.correlationId,
    createdAt: meta.at,
  });
}

/**
 * `platform_accounts` through both roles: the dispatcher and the device-token route look across creators with
 * the owner role (`withAdmin`); everything else runs in a tenant transaction (RLS).
 */
export function createDrizzleAccountStore(db: Database, adminDb: Database): AccountStore {
  const byId = (id: string) => eq(schema.platformAccounts.id, id);
  return {
    listPollable: (platforms) =>
      withAdmin(adminDb, async (tx) => {
        if (platforms.length === 0) return [];
        const rows = await tx
          .select()
          .from(schema.platformAccounts)
          .where(
            and(
              sql`${schema.platformAccounts.sessionState} in ${POLLABLE_STATES}`,
              sql`${schema.platformAccounts.platform} in ${platforms}`,
            ),
          );
        return rows.map(toAccount);
      }),

    creatorOf: (id) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ creatorId: schema.platformAccounts.creatorId })
          .from(schema.platformAccounts)
          .where(byId(id));
        return row === undefined ? null : CreatorIdSchema.parse(row.creatorId);
      }),

    get: (creatorId, id) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx.select().from(schema.platformAccounts).where(byId(id));
        return row === undefined ? null : toAccount(row);
      }),

    sessionOf: (creatorId, id) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ ciphertext: schema.platformAccounts.sessionCiphertext })
          .from(schema.platformAccounts)
          .where(byId(id));
        return row?.ciphertext ?? null;
      }),

    recordPoll: (creatorId, id, at) =>
      withTenant(db, creatorId, async (tx) => {
        await tx
          .update(schema.platformAccounts)
          .set({ lastPollAt: at, consecutiveErrors: 0, pausedUntil: null })
          .where(byId(id));
      }),

    recordFailure: (creatorId, id, state) =>
      withTenant(db, creatorId, async (tx) => {
        await tx
          .update(schema.platformAccounts)
          .set({ consecutiveErrors: state.consecutiveErrors, pausedUntil: state.pausedUntil })
          .where(byId(id));
      }),

    setSessionState: (creatorId, id, to, meta) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ sessionState: schema.platformAccounts.sessionState })
          .from(schema.platformAccounts)
          .where(byId(id))
          .for('update');
        if (row === undefined || row.sessionState === to) return;
        await tx.update(schema.platformAccounts).set({ sessionState: to }).where(byId(id));
        await insertEvent(
          tx,
          creatorId,
          {
            type: 'session_state_changed',
            payload: { platformAccountId: id, from: SessionStateSchema.parse(row.sessionState), to },
          },
          meta,
        );
      }),

    storeSession: (creatorId, id, session, meta) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({
            sessionState: schema.platformAccounts.sessionState,
            sessionCiphertext: schema.platformAccounts.sessionCiphertext,
          })
          .from(schema.platformAccounts)
          .where(byId(id))
          .for('update');
        if (row === undefined) return;
        const renewed =
          row.sessionCiphertext === null ||
          !session.isSame(row.sessionCiphertext) ||
          row.sessionState === 'none' ||
          row.sessionState === 'expired';
        await tx
          .update(schema.platformAccounts)
          .set({
            sessionCiphertext: session.ciphertext,
            ...(renewed ? { sessionUpdatedAt: meta.at } : {}),
            sessionState: 'valid',
            consecutiveErrors: 0,
            pausedUntil: null,
          })
          .where(byId(id));
        if (row.sessionState !== 'valid') {
          await insertEvent(
            tx,
            creatorId,
            {
              type: 'session_state_changed',
              payload: {
                platformAccountId: id,
                from: SessionStateSchema.parse(row.sessionState),
                to: 'valid',
              },
            },
            meta,
          );
        }
        // Audit without the session: who stored one, for which account, when (security.md).
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: meta.userId,
          action: 'connector.session_stored',
          entity: 'platform_account',
          entityId: id,
          details: { correlationId: meta.correlationId },
          createdAt: meta.at,
        });
      }),

    publish: (creatorId, body, meta) =>
      withTenant(db, creatorId, (tx) => insertEvent(tx, creatorId, body, meta)),
  };
}

/** Enqueues the account jobs with the owner role (the dispatcher has no tenant): `public.enqueue_job`. */
export function createDrizzleAccountJobs(adminDb: Database): AccountJobs {
  async function enqueue(
    job: Extract<JobName, 'connector.poll' | 'connector.reconcile'>,
    account: ConnectorAccount,
    options: { runAt: Date | null; jobKeyMode: 'replace' | 'preserve_run_at' },
    correlationId: string,
  ): Promise<void> {
    const payload: unknown = JOB_PAYLOADS[job].parse({
      creatorId: account.creatorId,
      platformAccountId: account.id,
      correlationId,
    });
    await adminDb.execute(
      sql`select public.enqueue_job(
        task => ${job},
        payload => ${JSON.stringify(payload)}::jsonb,
        queue_name => ${accountQueueNameFor(account.id)},
        run_at => ${options.runAt?.toISOString() ?? null}::timestamptz,
        max_attempts => ${JOB_MAX_ATTEMPTS[job]}::int,
        job_key => ${`${job === 'connector.poll' ? 'poll' : 'reconcile'}:${account.id}`},
        job_key_mode => ${options.jobKeyMode}
      )`,
    );
  }
  return {
    // A poll already waiting keeps its time: the dispatcher never stacks a second one (fiche P0-06).
    enqueuePoll: (account, runAt, correlationId) =>
      enqueue('connector.poll', account, { runAt, jobKeyMode: 'preserve_run_at' }, correlationId),
    enqueueReconcile: (account, correlationId) =>
      enqueue('connector.reconcile', account, { runAt: null, jobKeyMode: 'replace' }, correlationId),
  };
}
