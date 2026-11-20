import {
  AddOwnerBodySchema,
  AuditEntryIdSchema,
  DomainError,
  EVENT_PAYLOADS,
  MAX_OWNERS,
  networkOf,
  newId,
  OWNER_REMOVAL_NOTICE_HOURS,
  ownerCandidateRefusal,
  ownerRemovalEffectiveAt,
  OwnerRemovalSchema,
  OwnersSchema,
  type NotificationOutcome,
  type NotificationRequest,
  type OwnerCandidateRefusal,
  type OwnerErrorCode,
  type OwnerRemoval,
  type Owners,
  type PushMessage,
  type SecurityAlertPayload,
} from '@impera/contracts';
import {
  and,
  eq,
  revokeExtensionLinks,
  revokeSignIns,
  schema,
  sql,
  withAdmin,
  type Database,
  type Transaction,
} from '@impera/db';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { SessionUnauthenticated, type RequireRole } from './auth';
import { publishSecurityAlert } from './security-alerts';

/**
 * The owners of the agency (ADR 0096): two at most, made from a member of the team by the owner; either removes the
 * other only after a notice of 72 hours the other can cancel. Everything here runs on the service connection, under
 * one advisory lock, so that two gestures at once are read one after the other; each writes its line of `audit_log`
 * and a security alert in the same transaction. Réglages › Sécurité shows it to the owners only.
 */

class OwnersFull extends DomainError {
  constructor() {
    super(
      'owner_conflict' satisfies OwnerErrorCode,
      `Il y a déjà ${String(MAX_OWNERS)} propriétaires : il n’y en a jamais plus`,
    );
  }
}

class RemovalPending extends DomainError {
  constructor() {
    super(
      'owner_removal_conflict' satisfies OwnerErrorCode,
      'Un retrait attend déjà la fin de son préavis : rien d’autre ne change entre-temps',
    );
  }
}

const REFUSAL_TEXT: Readonly<Record<Exclude<OwnerCandidateRefusal, 'full' | 'removal_pending'>, string>> = {
  not_a_member: 'Seul un membre actif de l’équipe peut devenir propriétaire',
  second_factor_missing:
    'Ce compte n’a pas encore activé son code de double authentification : il se connecte une fois d’abord',
};

class OwnerUnprocessable extends DomainError {
  constructor(refusal: keyof typeof REFUSAL_TEXT) {
    super('owner_unprocessable' satisfies OwnerErrorCode, REFUSAL_TEXT[refusal], { details: { refusal } });
  }
}

class OwnerNotFound extends DomainError {
  constructor() {
    super('owner_not_found' satisfies OwnerErrorCode, 'Ce compte n’est pas propriétaire');
  }
}

class RemovalNotFound extends DomainError {
  constructor() {
    super('owner_removal_not_found' satisfies OwnerErrorCode, 'Aucun retrait n’attend');
  }
}

/** Only the owner a removal is about cancels it: the one who asked would only have to wait otherwise. */
class RemovalNotYours extends DomainError {
  constructor() {
    super(
      'owner_removal_forbidden' satisfies OwnerErrorCode,
      'Seul le propriétaire visé par le retrait peut l’annuler',
    );
  }
}

/** One writer among the owners at a time, held until the transaction ends. */
const lockOwners = (tx: Transaction) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('owners', 0))`);

const audit = (
  tx: Transaction,
  entry: {
    userId: string | null;
    action: string;
    entityId: string;
    ip: string | null;
    details: Record<string, unknown>;
  },
) =>
  tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: entry.userId,
    action: entry.action,
    entity: 'user',
    entityId: entry.entityId,
    details: entry.details,
    ip: entry.ip,
  });

async function ownerIds(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, 'owner'))
    .orderBy(schema.user.createdAt);
  return rows.map((row) => row.id);
}

const waiting = sql`${schema.ownerRemovals.cancelledAt} is null and ${schema.ownerRemovals.appliedAt} is null`;

async function waitingRemoval(tx: Transaction): Promise<OwnerRemoval | null> {
  const [row] = await tx
    .select()
    .from(schema.ownerRemovals)
    .where(waiting)
    .orderBy(schema.ownerRemovals.requestedAt)
    .limit(1);
  if (row === undefined) return null;
  return OwnerRemovalSchema.parse({
    id: row.id,
    targetUserId: row.targetUserId,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    effectiveAt: row.effectiveAt.toISOString(),
  });
}

/** Whether the account is an owner: read by the gestures elsewhere that must not shut one out (ADR 0096 § 2). */
export async function isOwnerAccount(tx: Transaction, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.role === 'owner';
}

/** `GET`: the owners, the members who could become the second one (and why not yet), the removal that waits. */
function readOwners(adminDb: Database, reader: string): Promise<Owners> {
  return withAdmin(adminDb, async (tx) => {
    const accounts = await tx.execute<{
      id: string;
      name: string;
      role: string;
      second_factor: boolean | null;
      passkeys: number;
      active_member: boolean;
    }>(sql`
      select u.id, u.name, u.role, u.two_factor_enabled as second_factor,
        (select count(*)::int from passkey p where p.user_id = u.id) as passkeys,
        exists (select 1 from team_members m where m.user_id = u.id and m.status = 'active') as active_member
      from "user" u
      where u.role = 'owner' or exists (select 1 from team_members m where m.user_id = u.id and m.status <> 'left')
      order by u.created_at, u.id`);
    const removal = await waitingRemoval(tx);
    const owners = accounts.rows.filter((row) => row.role === 'owner');
    const full = owners.length >= MAX_OWNERS;
    return OwnersSchema.parse({
      owners: owners.map((row) => ({
        userId: row.id,
        name: row.name,
        you: row.id === reader,
        secondFactor: row.second_factor === true,
        passkeys: row.passkeys,
      })),
      candidates: full
        ? []
        : accounts.rows
            .filter((row) => row.role === 'operator')
            .map((row) => ({
              userId: row.id,
              name: row.name,
              refusal: ownerCandidateRefusal({
                owners: owners.length,
                role: 'operator',
                activeMember: row.active_member,
                secondFactor: row.second_factor === true,
                removalPending: removal !== null,
              }),
            })),
      removal,
      noticeHours: OWNER_REMOVAL_NOTICE_HOURS,
    });
  });
}

interface Gesture {
  readonly by: string;
  readonly ip: string | null;
}

/**
 * Makes a member of the team the second owner (§ 1). His sessions, trusted devices and extension links are closed and
 * his live invitation link revoked: he signs in again, with his code, as an owner; nothing opened before carries the
 * role.
 */
function addOwner(adminDb: Database, userId: string, gesture: Gesture): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    await lockOwners(tx);
    const owners = await ownerIds(tx);
    const [account] = await tx
      .select({ role: schema.user.role, secondFactor: schema.user.twoFactorEnabled })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const [member] = await tx
      .select({ id: schema.teamMembers.id, status: schema.teamMembers.status })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId));
    const refusal = ownerCandidateRefusal({
      owners: owners.length,
      role: account?.role === 'owner' || account?.role === 'operator' ? account.role : 'creator',
      activeMember: member?.status === 'active',
      secondFactor: account?.secondFactor === true,
      removalPending: (await waitingRemoval(tx)) !== null,
    });
    if (refusal === 'full') throw new OwnersFull();
    if (refusal === 'removal_pending') throw new RemovalPending();
    if (refusal !== null) throw new OwnerUnprocessable(refusal);
    await tx
      .update(schema.user)
      .set({ role: 'owner', updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
    const closed = await revokeSignIns(tx, userId);
    const extensionLinks = await revokeExtensionLinks(tx, userId);
    if (member !== undefined) {
      await tx
        .update(schema.invitationLinks)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(schema.invitationLinks.memberId, member.id),
            sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
          ),
        );
    }
    await audit(tx, {
      userId: gesture.by,
      action: 'user.role_changed',
      entityId: userId,
      ip: gesture.ip,
      details: { role: 'owner', via: 'owner:add', sessions: closed.sessions, extensionLinks },
    });
    await publishSecurityAlert(tx, null, {
      reason: 'owner_added',
      userId,
      role: 'owner',
      network: networkOf(gesture.ip),
      by: gesture.by,
    });
  });
}

/** Asks for the other owner's removal (§ 2): it waits 72 hours, and that owner can cancel it. */
function requestOwnerRemoval(
  adminDb: Database,
  targetUserId: string,
  gesture: Gesture,
  at: Date = new Date(),
): Promise<OwnerRemoval> {
  return withAdmin(adminDb, async (tx) => {
    await lockOwners(tx);
    const owners = await ownerIds(tx);
    // Oneself is not « another owner »: an owner never asks for his own removal here.
    if (targetUserId === gesture.by || !owners.includes(targetUserId)) throw new OwnerNotFound();
    if ((await waitingRemoval(tx)) !== null) throw new RemovalPending();
    const id = newId(z.uuid());
    const effectiveAt = ownerRemovalEffectiveAt(at);
    await tx
      .insert(schema.ownerRemovals)
      .values({ id, targetUserId, requestedBy: gesture.by, requestedAt: at, effectiveAt });
    await audit(tx, {
      userId: gesture.by,
      action: 'owner.removal_requested',
      entityId: targetUserId,
      ip: gesture.ip,
      details: { removalId: id, effectiveAt: effectiveAt.toISOString() },
    });
    await publishSecurityAlert(
      tx,
      null,
      {
        reason: 'owner_removal_requested',
        userId: targetUserId,
        role: 'owner',
        network: networkOf(gesture.ip),
        by: gesture.by,
        effectiveAt: effectiveAt.toISOString(),
      },
      at,
    );
    return OwnerRemovalSchema.parse({
      id,
      targetUserId,
      requestedBy: gesture.by,
      requestedAt: at.toISOString(),
      effectiveAt: effectiveAt.toISOString(),
    });
  });
}

/** The owner a removal is about cancels it (§ 2); anyone else is refused, and the removal keeps waiting. */
function cancelOwnerRemoval(adminDb: Database, gesture: Gesture): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    await lockOwners(tx);
    const removal = await waitingRemoval(tx);
    if (removal === null) throw new RemovalNotFound();
    if (removal.targetUserId !== gesture.by) throw new RemovalNotYours();
    await tx
      .update(schema.ownerRemovals)
      .set({ cancelledAt: sql`now()` })
      .where(eq(schema.ownerRemovals.id, removal.id));
    await audit(tx, {
      userId: gesture.by,
      action: 'owner.removal_cancelled',
      entityId: gesture.by,
      ip: gesture.ip,
      details: { removalId: removal.id, requestedBy: removal.requestedBy },
    });
    await publishSecurityAlert(tx, null, {
      reason: 'owner_removal_cancelled',
      userId: gesture.by,
      role: 'owner',
      network: networkOf(gesture.ip),
    });
  });
}

/**
 * The job's first half: each removal whose notice ended at `at`, uncancelled, is applied. The account goes back to
 * `operator` (a member of the team finds his place again; an account without one keeps nothing), its sessions, trusted
 * devices and extension links are closed. Never the last owner: such a removal keeps waiting, and is told in the logs.
 * Returns the removals applied and those left because they would leave no owner.
 */
export function applyOwnerRemovalsUnscoped(
  adminDb: Database,
  at: Date = new Date(),
): Promise<{ readonly applied: number; readonly lapsed: number }> {
  return withAdmin(adminDb, async (tx) => {
    await lockOwners(tx);
    const due = await tx
      .select()
      .from(schema.ownerRemovals)
      .where(and(waiting, sql`${schema.ownerRemovals.effectiveAt} <= ${at.toISOString()}::timestamptz`))
      .orderBy(schema.ownerRemovals.requestedAt);
    let applied = 0;
    let lapsed = 0;
    for (const removal of due) {
      const owners = await ownerIds(tx);
      const stillOwner = owners.includes(removal.targetUserId);
      // Whoever asked must still be an owner when the notice ends: a removal never outlives the role that asked it.
      // Closed rather than left waiting: a removal nobody can apply would block every later one of the same account.
      if (stillOwner && (owners.length < 2 || !owners.includes(removal.requestedBy))) {
        await tx
          .update(schema.ownerRemovals)
          .set({ cancelledAt: at })
          .where(eq(schema.ownerRemovals.id, removal.id));
        await audit(tx, {
          userId: removal.requestedBy,
          action: 'owner.removal_cancelled',
          entityId: removal.targetUserId,
          ip: null,
          details: { removalId: removal.id, requestedBy: removal.requestedBy, via: 'owner:lapsed' },
        });
        lapsed += 1;
        continue;
      }
      await tx
        .update(schema.ownerRemovals)
        .set({ appliedAt: at })
        .where(eq(schema.ownerRemovals.id, removal.id));
      applied += 1;
      // Already no longer an owner (the server's command): the removal is closed, nothing more to take back.
      if (!stillOwner) continue;
      await tx
        .update(schema.user)
        .set({ role: 'operator', updatedAt: new Date() })
        .where(eq(schema.user.id, removal.targetUserId));
      const closed = await revokeSignIns(tx, removal.targetUserId);
      const extensionLinks = await revokeExtensionLinks(tx, removal.targetUserId);
      await audit(tx, {
        userId: removal.requestedBy,
        action: 'user.role_changed',
        entityId: removal.targetUserId,
        ip: null,
        details: {
          role: 'operator',
          via: 'owner:removal',
          removalId: removal.id,
          sessions: closed.sessions,
          extensionLinks,
        },
      });
      await publishSecurityAlert(
        tx,
        null,
        {
          reason: 'owner_removed',
          userId: removal.targetUserId,
          role: 'operator',
          network: null,
          by: removal.requestedBy,
        },
        at,
      );
    }
    return { applied, lapsed };
  });
}

/** The screen every notification of the owners opens. */
const OWNERS_PATH = '/reglages/securite';

/** The alerts the job's second half relays to the owners in the app (§§ 2 and 5). */
const RELAYED_REASONS = [
  'owner_added',
  'owner_removal_requested',
  'owner_removal_cancelled',
  'owner_removed',
  'new_device_sign_in',
  'passkey_new_sign_in',
] as const satisfies readonly SecurityAlertPayload['reason'][];

/** How far back the relay reads: an event is told once per account, so reading it again changes nothing. */
const RELAY_WINDOW_MINUTES = 30;

/**
 * The message of an alert and who else than the owners hears it. A sign-in is told to the other owners only, and only
 * when it is an owner's. Never a name: the screen it opens says who.
 */
export function ownerNotice(
  alert: SecurityAlertPayload,
): { readonly message: PushMessage; readonly also: string | null; readonly except: string | null } | null {
  const message = (title: string, body: string): PushMessage => ({ title, body, url: OWNERS_PATH });
  switch (alert.reason) {
    case 'owner_added':
      return {
        message: message('Nouveau propriétaire', 'Un membre de l’équipe vient de devenir propriétaire.'),
        also: null,
        except: null,
      };
    case 'owner_removal_requested':
      return {
        message: message(
          'Retrait d’un propriétaire demandé',
          `Il prend effet dans ${String(OWNER_REMOVAL_NOTICE_HOURS)} h. Le propriétaire visé peut l’annuler dans Réglages › Sécurité.`,
        ),
        also: null,
        except: null,
      };
    case 'owner_removal_cancelled':
      return {
        message: message('Retrait d’un propriétaire annulé', 'Le propriétaire visé a annulé le retrait.'),
        also: null,
        except: null,
      };
    case 'owner_removed':
      return {
        message: message('Propriétaire retiré', 'Le préavis est passé : ce compte n’est plus propriétaire.'),
        also: alert.userId,
        except: null,
      };
    case 'new_device_sign_in':
    case 'passkey_new_sign_in':
      if (alert.role !== 'owner' || alert.userId === null) return null;
      return {
        message: message(
          'Connexion d’un propriétaire',
          'L’autre propriétaire vient de se connecter depuis un nouvel appareil.',
        ),
        also: null,
        except: alert.userId,
      };
    case 'sign_in_refusals':
    case 'second_factor_reset':
    case 'passkey_added':
    case 'persona_activated':
    case 'automatic_enabled':
    case 'platform_session_replaced':
      return null;
  }
}

export type OwnerNotify = (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;

/**
 * The job's second half: each alert about the owners of the last half hour becomes a notification of the app for
 * every owner, once per event and account (`notify` keeps that), night and cap alike. Returns how many were asked.
 */
export async function relayOwnerAlertsUnscoped(
  adminDb: Database,
  deps: { readonly notify: OwnerNotify; readonly agencyTimeZone: () => Promise<string> },
  at: Date = new Date(),
): Promise<number> {
  const { events, owners } = await withAdmin(adminDb, async (tx) => ({
    events: await tx
      .select({ id: schema.domainEvents.id, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.type, 'security_alert'),
          sql`${schema.domainEvents.createdAt} > ${at.toISOString()}::timestamptz - make_interval(mins => ${RELAY_WINDOW_MINUTES})`,
          sql`${schema.domainEvents.payload} ->> 'reason' in (${sql.join(
            RELAYED_REASONS.map((reason) => sql`${reason}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(schema.domainEvents.createdAt),
    owners: await ownerIds(tx),
  }));
  if (events.length === 0) return 0;
  const timeZone = await deps.agencyTimeZone();
  let asked = 0;
  for (const event of events) {
    const alert = EVENT_PAYLOADS.security_alert.safeParse(event.payload);
    if (!alert.success) continue;
    const notice = ownerNotice(alert.data);
    if (notice === null) continue;
    const recipients = new Set(owners);
    if (notice.also !== null) recipients.add(notice.also);
    if (notice.except !== null) recipients.delete(notice.except);
    for (const userId of recipients) {
      await deps.notify(
        { userId, reason: 'owner_change', objectKey: event.id, timeZone, message: notice.message },
        at,
      );
      asked += 1;
    }
  }
  return asked;
}

export interface OwnersDeps {
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  readonly requireRecentLogin: preValidationAsyncHookHandler;
}

const OwnerParamsSchema = z.object({ userId: z.string().min(1).max(128) });

export function createOwnersRoutes(deps: OwnersDeps): FastifyPluginAsyncZod {
  const { adminDb, requireRole, requireRecentLogin } = deps;
  const owner = requireRole('owner');
  const gestureOf = (request: FastifyRequest): Gesture => {
    if (request.user === null) throw new SessionUnauthenticated();
    return { by: request.user.id, ip: request.ip };
  };

  return (app) => {
    app.get(
      '/settings/security/owners',
      { preValidation: owner, schema: { response: { 200: OwnersSchema } } },
      async (request): Promise<Owners> => readOwners(adminDb, gestureOf(request).by),
    );

    // A sensitive action (§ 1): the password and the code, confirmed on this session in the last 10 minutes.
    app.post(
      '/settings/security/owners',
      {
        preValidation: [owner, requireRecentLogin],
        schema: { body: AddOwnerBodySchema, response: { 200: OwnersSchema } },
      },
      async (request): Promise<Owners> => {
        const gesture = gestureOf(request);
        await addOwner(adminDb, request.body.userId, gesture);
        return readOwners(adminDb, gesture.by);
      },
    );

    app.post(
      '/settings/security/owners/:userId/removal',
      {
        preValidation: [owner, requireRecentLogin],
        schema: { params: OwnerParamsSchema, response: { 200: OwnersSchema } },
      },
      async (request): Promise<Owners> => {
        const gesture = gestureOf(request);
        await requestOwnerRemoval(adminDb, request.params.userId, gesture);
        return readOwners(adminDb, gesture.by);
      },
    );

    // The owner it is about, with his password and his code: a session left open somewhere does not cancel it.
    app.delete(
      '/settings/security/owners/removal',
      { preValidation: [owner, requireRecentLogin], schema: { response: { 200: OwnersSchema } } },
      async (request): Promise<Owners> => {
        const gesture = gestureOf(request);
        await cancelOwnerRemoval(adminDb, gesture);
        return readOwners(adminDb, gesture.by);
      },
    );
    return Promise.resolve();
  };
}
