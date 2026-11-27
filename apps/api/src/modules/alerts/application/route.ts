import {
  isCreatorAlertLocked,
  type CreatorAlertLine,
  type CreatorAlertRole,
  type CreatorId,
  type NotificationOutcome,
  type NotificationRequest,
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

/** A safety relay nobody took yet: the event, her, the conversation and when it was raised. */
export interface WaitingSafetyRelay {
  readonly id: string;
  readonly creatorId: CreatorId;
  readonly conversationId: string | null;
  readonly createdAt: Date;
}

/** An account a notification goes to, in its own time zone (its quiet hours, its day). */
interface Recipient {
  readonly userId: string;
  readonly timeZone: string;
}

/** A manager is told of a creator's alert only when she is one of his (`user.creator_ids`, relecture Bilan). */
interface Manager extends Recipient {
  readonly creatorIds: readonly string[];
}

/** What the router reads, as the service role (ADR 0150 § 18). */
export interface RouterReads {
  /**
   * The human relays for safety written after `since`, by a read of their own: never crowded out of the window by a
   * burst of other events (relecture Sécurité).
   */
  safetyEvents(since: Date): Promise<readonly RoutedEventRow[]>;
  /** Every routed event written after `since`, oldest first, read page by page to the window's newest. */
  events(since: Date): Promise<readonly RoutedEventRow[]>;
  /** The agency's alerts written after `since` (`AGENCY_EVENT_TYPES`), oldest first, page by page. */
  agencyEvents(since: Date): Promise<readonly RoutedEventRow[]>;
  /** The safety relays written after `since` that no takeover followed yet (no `takeover_started` nor `_ended`). */
  waitingSafety(since: Date): Promise<readonly WaitingSafetyRelay[]>;
  /** Her stored choices, through `creatorAlertLines`: a locked alert reads « reçoit » whatever a row says. */
  lines(creatorId: CreatorId): Promise<readonly CreatorAlertLine[]>;
  /** The creators not archived, with the name a notification shows. */
  creators(): Promise<readonly { readonly id: CreatorId; readonly name: string }[]>;
  /** The owners' accounts, in the agency's time zone. */
  owners(): Promise<readonly Recipient[]>;
  /** The active managers' accounts, each in his own time zone, with the creators his account is given. */
  managers(): Promise<readonly Manager[]>;
  /** The accounts of these team members, active ones only, each in his own time zone. */
  members(memberIds: readonly string[]): Promise<readonly Recipient[]>;
  /** The name the team gives a member, `null` for one unknown: who sold, in a sale's notification (recette G19). */
  memberName(memberId: string): Promise<string | null>;
}

export interface RouterDeps {
  readonly reads: RouterReads;
  /** Who is on shift on her accounts at `at` (the `scheduling` module). */
  readonly onShift: (creatorId: CreatorId, at: Date) => Promise<readonly { readonly memberId: string }[]>;
  /** The `notifications` module's `notify`: once per account, reason and event, even replayed. */
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  /** A failure to read her choices: logged by the caller; the defaults of the code apply. */
  readonly onLinesUnread?: (creatorId: CreatorId, error: unknown) => void;
  /**
   * A failure to read who a role is, or to notify one account: logged by the caller; the other roles and accounts are
   * told all the same, and the next run tries again (the notification's key is the event).
   */
  readonly onFailure?: (step: string, error: unknown) => void;
}

/**
 * How far back each run reads. Each minute re-reads the last half hour: a run that failed, or a worker restarted, loses
 * nothing within it, and an event read twice rings once (the notification's key is the event).
 */
const ROUTE_WINDOW_MS = 30 * 60_000;

/**
 * `alerts.route` (ADR 0150 lot 2): each alert of the window, to the roles her tab chooses. `deliver` rings, `muted`
 * comes without sound, `off` reaches nobody (the history keeps it anyway). Returns the notifications asked.
 */
export async function routeAlerts(deps: RouterDeps, now: Date): Promise<number> {
  const since = new Date(now.getTime() - ROUTE_WINDOW_MS);
  // The safety relays first, by their own read: whatever else the window holds, they are routed (relecture Sécurité).
  const safety = await deps.reads.safetyEvents(since);
  let others: readonly RoutedEventRow[] = [];
  try {
    others = await deps.reads.events(since);
  } catch (error) {
    deps.onFailure?.('events', error);
  }
  const first = new Set(safety.map((event) => event.id));
  const events = [...safety, ...others.filter((event) => !first.has(event.id))];
  if (events.length === 0) return 0;
  const failed = (step: string) => (error: unknown) => {
    deps.onFailure?.(step, error);
    return [];
  };
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
  // Each role read on its own: the owner is told even when the managers or the shift cannot be read.
  const [owners, managers] = await Promise.all([
    deps.reads.owners().catch(failed('owners')),
    deps.reads.managers().catch(failed('managers')),
  ]);

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
      // The owners hear of the AI budget by the agency's alerts, with the figures (`alerts.agency`): never twice.
      if (role === 'owner') return alert.code === 'ai_budget' ? [] : owners;
      // A creator's alert to her managers only; the agency's (budget, no creator) to every active manager.
      if (role === 'manager') {
        const creatorId = event.creatorId;
        return creatorId === null ? managers : managers.filter((m) => m.creatorIds.includes(creatorId));
      }
      // An alert of no creator has no shift: the chatters are never told of the agency's budget by this road.
      if (event.creatorId === null) return [];
      const onShift = await deps.onShift(event.creatorId, now).catch(failed('on_shift'));
      return onShift.length === 0
        ? []
        : deps.reads.members(onShift.map((shift) => shift.memberId)).catch(failed('members'));
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
    // Who sold, by his name (recette 27/11, G19); a read that fails says « le chatteur en poste », never no notification.
    const sellerId = alert.sale?.memberId ?? null;
    const sellerName = sellerId === null ? null : await deps.reads.memberName(sellerId).catch(() => null);
    // A safety relay rings through the quiet hours and outside the daily cap (ADR 0150 § 6: « partent toujours »).
    const reason = isCreatorAlertLocked(alert.code) ? 'safety_alert' : 'creator_alert';
    for (const { recipient, silent } of loudest.values()) {
      try {
        await deps.notify(
          {
            userId: recipient.userId,
            reason,
            objectKey: event.id,
            timeZone: recipient.timeZone,
            message: alertMessage(
              alert.code,
              creatorName,
              alert.conversationId,
              silent,
              alert.sale,
              sellerName,
            ),
          },
          now,
        );
        asked += 1;
      } catch (error) {
        deps.onFailure?.('notify', error);
      }
    }
  }
  return asked;
}
