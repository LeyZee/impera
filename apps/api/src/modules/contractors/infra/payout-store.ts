import {
  JOB_MAX_ATTEMPTS,
  newId,
  PAYOUT_CHANGES_PER_DAY,
  PayoutDetailsSchema,
  PayoutReceiveMethodSchema,
  type PayoutDestination,
  type PayoutDestinationList,
  type PayoutDestinationSummary,
  type PayoutDetails,
  type TeamMemberId,
  TeamMemberIdSchema,
} from '@impera/contracts';
import {
  and,
  decryptSecret,
  encryptSecret,
  eq,
  keyVersionOf,
  schema,
  sql,
  withMember,
  type Database,
  type EncryptionKey,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import {
  PayoutDestinationForbidden,
  PayoutDestinationLimited,
  PayoutDestinationUnavailable,
  TeamMemberNotFound,
} from '../domain/errors';
import type { Actor } from '../domain/ports';

import { audit } from './audit';

const { payoutDestinations, teamMembers } = schema;
type Row = typeof payoutDestinations.$inferSelect;

/**
 * The associated data a version is sealed with (ADR 0165 § 2): the member and the version, so that a block copied on
 * another member, or an old version replayed as the current one, does not open.
 */
const payoutContext = (memberId: string, versionId: string): string =>
  `payout_destination:${memberId}:${versionId}`;

export interface PayoutDestinationStore {
  /** The owner's list: the way each member receives and his last change, never a number (ADR 0165 § 4). */
  list(actor: Actor): Promise<PayoutDestinationList>;
  /** The member's own, with its details; anyone else is refused, the owner included (he reveals). */
  readOwn(actor: Actor, memberId: TeamMemberId): Promise<PayoutDestination>;
  /** The owner reveals one member's details; journalised, never the value. */
  reveal(actor: Actor, memberId: TeamMemberId): Promise<PayoutDestination>;
  /** The member writes his own: a new version, sealed, journalised, told to his devices. Same details: nothing written. */
  write(
    actor: Actor,
    memberId: TeamMemberId,
    details: PayoutDetails,
  ): Promise<{ readonly destination: PayoutDestination; readonly created: boolean }>;
}

async function memberOf(
  tx: Transaction,
  memberId: TeamMemberId,
): Promise<{ readonly userId: string | null; readonly timeZone: string }> {
  const [row] = await tx
    .select({ userId: teamMembers.userId, timeZone: teamMembers.timeZone })
    .from(teamMembers)
    .where(eq(teamMembers.id, memberId));
  if (row === undefined) throw new TeamMemberNotFound();
  return row;
}

async function versionsOf(tx: Transaction, memberId: TeamMemberId): Promise<Row[]> {
  return tx
    .select()
    .from(payoutDestinations)
    .where(eq(payoutDestinations.memberId, memberId))
    .orderBy(sql`${payoutDestinations.createdAt} desc, ${payoutDestinations.id} desc`);
}

/** The way he receives (the newest version) and his last real change (a key rotation is none). */
function summaryOf(memberId: TeamMemberId, rows: readonly Row[]): PayoutDestinationSummary {
  const newest = rows[0];
  const changed = rows.find((row) => !row.resealed);
  return {
    memberId,
    method: newest === undefined ? null : PayoutReceiveMethodSchema.parse(newest.method),
    changedAt: changed === undefined ? null : changed.createdAt.toISOString(),
  };
}

export function createPayoutDestinationStore(
  db: Database,
  keys: readonly EncryptionKey[] | null,
  now: () => Date,
): PayoutDestinationStore {
  function opened(memberId: TeamMemberId, rows: readonly Row[]): PayoutDestination {
    const newest = rows[0];
    if (newest === undefined) return { ...summaryOf(memberId, rows), details: null };
    if (keys === null) throw new PayoutDestinationUnavailable();
    // A block no listed key opens is unreadable, never guessed: the member writes it again.
    let details: PayoutDetails | null;
    try {
      details = PayoutDetailsSchema.parse(
        JSON.parse(decryptSecret(newest.detailsCiphertext, keys, payoutContext(memberId, newest.id))),
      );
    } catch {
      throw new PayoutDestinationUnavailable();
    }
    return { ...summaryOf(memberId, rows), details };
  }

  return {
    list: (actor) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayoutDestinationForbidden();
        const members = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .orderBy(teamMembers.createdAt);
        const rows = await tx
          .select()
          .from(payoutDestinations)
          .orderBy(sql`${payoutDestinations.createdAt} desc, ${payoutDestinations.id} desc`);
        return {
          destinations: members.map((member) => {
            const memberId = TeamMemberIdSchema.parse(member.id);
            return summaryOf(
              memberId,
              rows.filter((row) => row.memberId === memberId),
            );
          }),
        };
      }),

    readOwn: (actor, memberId) =>
      withMember(db, actor.userId, async (tx) => {
        const member = await memberOf(tx, memberId);
        if (member.userId !== actor.userId) throw new PayoutDestinationForbidden();
        return opened(memberId, await versionsOf(tx, memberId));
      }),

    reveal: (actor, memberId) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayoutDestinationForbidden();
        await memberOf(tx, memberId);
        const destination = opened(memberId, await versionsOf(tx, memberId));
        await audit(tx, actor, 'payout_destination.reveal', { kind: 'payout_destination', id: memberId }, {});
        return destination;
      }),

    write: (actor, memberId, details) =>
      withMember(db, actor.userId, async (tx) => {
        const member = await memberOf(tx, memberId);
        if (member.userId !== actor.userId) throw new PayoutDestinationForbidden();
        if (keys === null) throw new PayoutDestinationUnavailable();
        // One change at a time per member: the count of the day and the version before are read under it.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`payout_destination:${memberId}`}, 0))`,
        );
        const before = await versionsOf(tx, memberId);
        if (
          before.length > 0 &&
          JSON.stringify(opened(memberId, before).details) === JSON.stringify(details)
        ) {
          return { destination: opened(memberId, before), created: false };
        }
        const since = new Date(now().getTime() - 86_400_000);
        const [today] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(payoutDestinations)
          .where(
            and(
              eq(payoutDestinations.memberId, memberId),
              eq(payoutDestinations.resealed, false),
              sql`${payoutDestinations.createdAt} > ${since.toISOString()}`,
            ),
          );
        if ((today?.count ?? 0) >= PAYOUT_CHANGES_PER_DAY)
          throw new PayoutDestinationLimited(PAYOUT_CHANGES_PER_DAY);
        const versionId = newId(z.uuid());
        await tx.insert(payoutDestinations).values({
          id: versionId,
          memberId,
          method: details.method,
          detailsCiphertext: encryptSecret(JSON.stringify(details), keys, payoutContext(memberId, versionId)),
          createdBy: actor.userId,
        });
        await audit(
          tx,
          actor,
          'payout_destination.update',
          { kind: 'payout_destination', id: memberId },
          { method: details.method, version: versionId },
        );
        await tx.execute(
          sql`select public.enqueue_job(
            task => 'payroll.notify_payout_change',
            payload => ${JSON.stringify({ memberId, versionId, userId: actor.userId, timeZone: member.timeZone })}::jsonb,
            max_attempts => ${JOB_MAX_ATTEMPTS['payroll.notify_payout_change']}::int,
            job_key => ${`payroll.notify_payout_change:${versionId}`}
          )`,
        );
        return { destination: opened(memberId, await versionsOf(tx, memberId)), created: true };
      }),
  };
}

/** The newest version of each member, the one in force: older ones are history, unread once their key is retired. */
async function newestVersions(ownerDb: Database): Promise<Row[]> {
  return ownerDb
    .selectDistinctOn([payoutDestinations.memberId])
    .from(payoutDestinations)
    .orderBy(
      payoutDestinations.memberId,
      sql`${payoutDestinations.createdAt} desc, ${payoutDestinations.id} desc`,
    );
}

function opens(row: Row, keys: readonly EncryptionKey[]): string | null {
  try {
    return decryptSecret(row.detailsCiphertext, keys, payoutContext(row.memberId, row.id));
  } catch {
    return null;
  }
}

/**
 * `pnpm ops:check-keys` (ADR 0028 § 7): whether the keys open each member's version in force, decrypted in memory and
 * dropped at once. Unreadable ones are named by the member's id, never a value.
 */
export async function checkPayoutDestinations(
  ownerDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly string[] }> {
  const rows = await newestVersions(ownerDb);
  return {
    total: rows.length,
    unreadable: rows.filter((row) => opens(row, keys) === null).map((row) => row.memberId),
  };
}

/**
 * `pnpm ops:reencrypt-credentials` (ADR 0165 § 2): each version in force not sealed with the newest key gets a new
 * version, the same details sealed with it, marked `resealed` (neither a change said to the owner, nor told to the
 * member, nor counted for the day). No row is ever updated. On the owner's connection (`ownerDatabaseUrl`, `DATABASE_ADMIN_URL`), never the service role, which has no grant here.
 */
export async function resealPayoutDestinations(
  ownerDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly rewritten: number; readonly unreadable: readonly string[] }> {
  const newest = keys[0];
  if (newest === undefined) return { rewritten: 0, unreadable: [] };
  let rewritten = 0;
  const unreadable: string[] = [];
  for (const row of await newestVersions(ownerDb)) {
    if (keyVersionOf(row.detailsCiphertext) === newest.version) continue;
    const plain = opens(row, keys);
    if (plain === null) {
      unreadable.push(row.memberId);
      continue;
    }
    const id = newId(z.uuid());
    await ownerDb.insert(payoutDestinations).values({
      id,
      memberId: row.memberId,
      method: row.method,
      detailsCiphertext: encryptSecret(plain, [newest], payoutContext(row.memberId, id)),
      resealed: true,
      createdBy: row.createdBy,
    });
    rewritten += 1;
  }
  return { rewritten, unreadable };
}
