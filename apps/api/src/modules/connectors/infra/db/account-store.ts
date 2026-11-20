import {
  AuditEntryIdSchema,
  ConnectorConfigSchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  EventIdSchema,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  accountQueueNameFor,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  SessionStateSchema,
  type JobName,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withTenant, type Database, type Transaction } from '@impera/db';

import { SessionOwnerConflict } from '../../domain/errors';
import type { AccountJobs, AccountStore, ConnectorAccount, EventMeta } from '../../domain/ports';

const POLLABLE_STATES = ['valid', 'warning'];

const OWNER_UNIQUE = 'platform_accounts_platform_session_owner_unique';

/** A unique constraint refused the row, raised by the driver directly or wrapped by Drizzle (`cause`). */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    [error, error.cause].some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        e.code === '23505' &&
        'constraint' in e &&
        e.constraint === constraint,
    )
  );
}

function toAccount(row: typeof schema.platformAccounts.$inferSelect): ConnectorAccount {
  return {
    id: PlatformAccountIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platform: PlatformSchema.parse(row.platform),
    sessionState: SessionStateSchema.parse(row.sessionState),
    lastPollAt: row.lastPollAt,
    profileBioReadAt: row.profileBioReadAt,
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
  /**
   * The account of an archived creator that holds `owner` on the platform of account `id` gives the identity back: its
   * owner and its stored session are emptied and its state is expired, so that it asks for a « Sync » again if she ever comes back (one
   * identity, one account). Found on the admin connection (no tenant sees another creator's account), written in the
   * holder's own tenant. `false` when nobody archived holds it.
   */
  const releaseArchivedHolder = async (
    id: string,
    owner: string,
    meta: EventMeta & { readonly userId: string | null },
  ): Promise<boolean> => {
    const holder = await withAdmin(adminDb, async (tx) => {
      const [row] = await tx
        .select({ id: schema.platformAccounts.id, creatorId: schema.platformAccounts.creatorId })
        .from(schema.platformAccounts)
        .innerJoin(schema.creators, eq(schema.creators.id, schema.platformAccounts.creatorId))
        .where(
          and(
            eq(schema.platformAccounts.sessionOwner, owner),
            sql`${schema.platformAccounts.platform} = (select platform from platform_accounts where id = ${id})`,
            sql`${schema.creators.archivedAt} is not null`,
          ),
        );
      return row;
    });
    if (holder === undefined) return false;
    await withTenant(db, holder.creatorId, async (tx) => {
      const [row] = await tx
        .select({ sessionState: schema.platformAccounts.sessionState })
        .from(schema.platformAccounts)
        .where(and(byId(holder.id), eq(schema.platformAccounts.sessionOwner, owner)))
        .for('update');
      if (row === undefined) return;
      const expires = row.sessionState !== 'none' && row.sessionState !== 'expired';
      await tx
        .update(schema.platformAccounts)
        .set({
          sessionOwner: null,
          sessionCiphertext: null,
          ...(expires ? { sessionState: 'expired' as const } : {}),
        })
        .where(byId(holder.id));
      if (expires) {
        await insertEvent(
          tx,
          holder.creatorId,
          {
            type: 'session_state_changed',
            payload: {
              platformAccountId: holder.id,
              from: SessionStateSchema.parse(row.sessionState),
              to: 'expired',
            },
          },
          meta,
        );
      }
      await tx.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId: meta.userId,
        action: 'connector.session_released',
        entity: 'platform_account',
        entityId: holder.id,
        details: { correlationId: meta.correlationId, releasedTo: id },
        createdAt: meta.at,
      });
    });
    return true;
  };

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
          .select({
            creatorId: schema.platformAccounts.creatorId,
            platform: schema.platformAccounts.platform,
          })
          .from(schema.platformAccounts)
          .where(byId(id));
        return row === undefined
          ? null
          : { creatorId: CreatorIdSchema.parse(row.creatorId), platform: PlatformSchema.parse(row.platform) };
      }),

    listSyncable: (platform) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            id: schema.platformAccounts.id,
            platform: schema.platformAccounts.platform,
            handle: schema.platformAccounts.handle,
            creatorName: schema.creators.displayName,
            sessionState: schema.platformAccounts.sessionState,
            sessionUpdatedAt: schema.platformAccounts.sessionUpdatedAt,
            modelId: schema.platformAccounts.sessionOwner,
          })
          .from(schema.platformAccounts)
          .innerJoin(schema.creators, eq(schema.creators.id, schema.platformAccounts.creatorId))
          .where(
            and(eq(schema.platformAccounts.platform, platform), sql`${schema.creators.archivedAt} is null`),
          )
          .orderBy(schema.creators.displayName, schema.platformAccounts.handle);
        return rows.map((row) => ({
          id: PlatformAccountIdSchema.parse(row.id),
          platform: PlatformSchema.parse(row.platform),
          handle: row.handle,
          creatorName: row.creatorName,
          sessionState: SessionStateSchema.parse(row.sessionState),
          sessionUpdatedAt: row.sessionUpdatedAt,
          modelId: row.modelId,
        }));
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

    recordProfileBio: (creatorId, id, bio, at) =>
      withTenant(db, creatorId, async (tx) => {
        await tx
          .update(schema.platformAccounts)
          .set({ profileBio: bio, profileBioReadAt: at })
          .where(byId(id));
      }),

    profileBioOf: (creatorId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ bio: schema.platformAccounts.profileBio })
          .from(schema.platformAccounts)
          .where(
            and(
              eq(schema.platformAccounts.creatorId, creatorId),
              sql`${schema.platformAccounts.profileBioReadAt} is not null`,
            ),
          )
          .orderBy(sql`${schema.platformAccounts.profileBioReadAt} desc`)
          .limit(1);
        const bio = row?.bio?.trim() ?? '';
        return bio === '' ? null : bio;
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

    storeSession: async (creatorId, id, session, meta) => {
      const write = () =>
        withTenant(db, creatorId, async (tx) => {
          const [row] = await tx
            .select({
              platform: schema.platformAccounts.platform,
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
              sessionOwner: session.owner,
              ...(renewed ? { sessionUpdatedAt: meta.at } : {}),
              sessionState: session.state,
              consecutiveErrors: 0,
              pausedUntil: null,
            })
            .where(byId(id));
          if (row.sessionState !== session.state) {
            await insertEvent(
              tx,
              creatorId,
              {
                type: 'session_state_changed',
                payload: {
                  platformAccountId: id,
                  from: SessionStateSchema.parse(row.sessionState),
                  to: session.state,
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
            details: { correlationId: meta.correlationId, trigger: meta.trigger },
            createdAt: meta.at,
          });
          // A valid session replaced by a different one (ADR 0046 § 8): the agent may now speak through another
          // account. Renewing an expired session, or storing the same one again, is ordinary and says nothing.
          if (
            row.sessionState === 'valid' &&
            row.sessionCiphertext !== null &&
            !session.isSame(row.sessionCiphertext)
          ) {
            await insertEvent(
              tx,
              creatorId,
              {
                type: 'security_alert',
                payload: EVENT_PAYLOADS.security_alert.parse({
                  reason: 'platform_session_replaced',
                  userId: meta.userId,
                  platformAccountId: id,
                  platform: PlatformSchema.parse(row.platform),
                }),
              },
              meta,
            );
          }
        });
      try {
        await write();
      } catch (error) {
        if (!isUniqueViolation(error, OWNER_UNIQUE)) throw error;
        // Another account of the platform already holds this owner (the unique constraint): the session is hers,
        // unless her creator left the agency (ADR 0071), whose account then gives the identity back.
        if (!(await releaseArchivedHolder(id, session.owner, meta))) throw new SessionOwnerConflict();
        await write().catch((again: unknown) => {
          if (isUniqueViolation(again, OWNER_UNIQUE)) throw new SessionOwnerConflict();
          throw again;
        });
      }
    },

    recordRefusedSession: (creatorId, id, reason, meta) =>
      withTenant(db, creatorId, async (tx) => {
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: meta.userId,
          action: 'connector.session_refused',
          entity: 'platform_account',
          entityId: id,
          details: { correlationId: meta.correlationId, reason, trigger: meta.trigger },
          createdAt: meta.at,
        });
      }),

    publish: (creatorId, body, meta) =>
      withTenant(db, creatorId, (tx) => insertEvent(tx, creatorId, body, meta)),
  };
}

/** Enqueues the account jobs with the owner role (the dispatcher has no tenant): `public.enqueue_job`. */
/** One waiting job of each kind per account (`job_key`). */
const JOB_KEYS = {
  'connector.poll': 'poll',
  'connector.reconcile': 'reconcile',
  'connector.vault_sync': 'vault',
} as const;

export function createDrizzleAccountJobs(adminDb: Database): AccountJobs {
  async function enqueue(
    job: Extract<JobName, 'connector.poll' | 'connector.reconcile' | 'connector.vault_sync'>,
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
        job_key => ${`${JOB_KEYS[job]}:${account.id}`},
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
    enqueueVaultSync: (account, correlationId) =>
      enqueue('connector.vault_sync', account, { runAt: null, jobKeyMode: 'preserve_run_at' }, correlationId),
    enqueueConversationRead: async (account, platformConversationId, correlationId) => {
      const job = 'connector.read_conversation';
      const payload: unknown = JOB_PAYLOADS[job].parse({
        creatorId: account.creatorId,
        platformAccountId: account.id,
        platformConversationId,
        correlationId,
      });
      await adminDb.execute(
        sql`select public.enqueue_job(
          task => ${job},
          payload => ${JSON.stringify(payload)}::jsonb,
          queue_name => ${accountQueueNameFor(account.id)},
          run_at => ${null}::timestamptz,
          max_attempts => ${JOB_MAX_ATTEMPTS[job]}::int,
          job_key => ${`read:${account.id}:${platformConversationId}`},
          job_key_mode => 'preserve_run_at'
        )`,
      );
    },
  };
}
