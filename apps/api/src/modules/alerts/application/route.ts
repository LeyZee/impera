import type {
  CreatorAlertLine,
  CreatorAlertRole,
  CreatorId,
  NotificationOutcome,
  NotificationRequest,
} from '@impera/contracts';

import { classifyEvent } from '../domain/classify';
import { creatorAlertLines } from '../domain/creator-alerts';
import { agencyModesFor, alertMessage, modesFor, reachedRoles } from '../domain/route';

/** One event of the outbox, as the router reads it (the service role, every creator). */
export interface RoutedEventRow {
  readonly id: string;
  readonly creatorId: CreatorId | null;
  readonly type: string;
  readonly payload: unknown;
}

/** An account a notification goes to, in its own time zone (its quiet hours, its day). */
export interface Recipient {
  readonly userId: string;
  readonly timeZone: string;
}

/** What the router reads, as the service role (ADR 0150 § 18). */
export interface RouterReads {
  /** The routed events written after `since`, oldest first. */
  events(since: Date): Promise<readonly RoutedEventRow[]>;
  /** Her stored choices, through `creatorAlertLines`: a locked alert reads « reçoit » whatever a row says. */
  lines(creatorId: CreatorId): Promise<readonly CreatorAlertLine[]>;
  /** The creators not archived, with the name a notification shows. */
  creators(): Promise<readonly { readonly id: CreatorId; readonly name: string }[]>;
  /** The owners' accounts, in the agency's time zone. */
  owners(): Promise<readonly Recipient[]>;
  /** The active managers' accounts (the agency's scope), each in his own time zone. */
  managers(): Promise<readonly Recipient[]>;
  /** The accounts of these team members, active ones only, each in his own time zone. */
  members(memberIds: readonly string[]): Promise<readonly Recipient[]>;
}

export interface RouterDeps {
  readonly reads: RouterReads;
  /** Who is on shift on her accounts at `at` (the `scheduling` module). */
  readonly onShift: (creatorId: CreatorId, at: Date) => Promise<readonly { readonly memberId: string }[]>;
  /** The `notifications` module's `notify`: once per account, reason and event, even replayed. */
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  /** A failure to read her choices: logged by the caller; the defaults of the code apply. */
  readonly onLinesUnread?: (creatorId: CreatorId, error: unknown) => void;
}

/**
 * How far back each run reads. Each minute re-reads the last half hour: a run that failed, or a worker restarted, loses
 * nothing within it, and an event read twice rings once (the notification's key is the event).
 */
export const ROUTE_WINDOW_MS = 30 * 60_000;

/**
 * `alerts.route` (ADR 0150 lot 2): each alert of the window, to the roles her tab chooses. `deliver` rings, `muted`
 * comes without sound, `off` reaches nobody (the history keeps it anyway). Returns the notifications asked.
 */
export async function routeAlerts(deps: RouterDeps, now: Date): Promise<number> {
  const events = await deps.reads.events(new Date(now.getTime() - ROUTE_WINDOW_MS));
  if (events.length === 0) return 0;
  const creators = await deps.reads.creators();
  const nameOf = new Map(creators.map((creator) => [creator.id, creator.name]));
  const linesCache = new Map<CreatorId, readonly CreatorAlertLine[]>();
  const linesOf = async (creatorId: CreatorId): Promise<readonly CreatorAlertLine[]> => {
    const known = linesCache.get(creatorId);
    if (known !== undefined) return known;
    let lines: readonly CreatorAlertLine[];
    try {
      lines = await deps.reads.lines(creatorId);
    } catch (error) {
      // Never « nobody » because a read failed: the code's defaults, safety relays « reçoit » (relecture Sécurité).
      deps.onLinesUnread?.(creatorId, error);
      lines = creatorAlertLines([]);
    }
    linesCache.set(creatorId, lines);
    return lines;
  };
  const [owners, managers] = await Promise.all([deps.reads.owners(), deps.reads.managers()]);

  let asked = 0;
  for (const event of events) {
    const alert = classifyEvent(event.type, event.payload);
    if (alert === null) continue;
    // An event of an archived creator reaches nobody: her agent no longer works (ADR 0071).
    if (event.creatorId !== null && !nameOf.has(event.creatorId)) continue;
    const modes =
      event.creatorId === null
        ? agencyModesFor(alert.code, await Promise.all(creators.map((creator) => linesOf(creator.id))))
        : modesFor(alert.code, await linesOf(event.creatorId));

    const byRole = async (role: CreatorAlertRole): Promise<readonly Recipient[]> => {
      if (role === 'owner') return owners;
      if (role === 'manager') return managers;
      // An alert of no creator has no shift: the chatters are never told of the agency's budget by this road.
      if (event.creatorId === null) return [];
      const onShift = await deps.onShift(event.creatorId, now);
      return onShift.length === 0 ? [] : deps.reads.members(onShift.map((shift) => shift.memberId));
    };

    // One notification per account: the loudest of its roles (an owner on shift is not told twice).
    const loudest = new Map<string, { readonly recipient: Recipient; silent: boolean }>();
    for (const { role, silent } of reachedRoles(modes)) {
      for (const recipient of await byRole(role)) {
        const seen = loudest.get(recipient.userId);
        if (seen === undefined) loudest.set(recipient.userId, { recipient, silent });
        else seen.silent = seen.silent && silent;
      }
    }
    const creatorName = event.creatorId === null ? null : (nameOf.get(event.creatorId) ?? null);
    for (const { recipient, silent } of loudest.values()) {
      await deps.notify(
        {
          userId: recipient.userId,
          reason: 'creator_alert',
          objectKey: event.id,
          timeZone: recipient.timeZone,
          message: alertMessage(alert.code, creatorName, alert.conversationId, silent),
        },
        now,
      );
      asked += 1;
    }
  }
  return asked;
}
