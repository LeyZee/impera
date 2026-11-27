import type { CreatorId, NotificationOutcome, NotificationRequest } from '@impera/contracts';

import { classify } from '../domain/agency/classify';
import { toScannedEvent } from '../domain/agency/events';
import { agencyMessage, safetyReminderDue, safetyReminderMessage } from '../domain/agency/message';

import type { RouterReads } from './route';

/**
 * The agency's alerts and the safety reminders (decision « Telegram pour les canaux seulement », 27/11/2026): what the
 * Telegram groups used to hear now rings on the owners' phones, through `notifications`. Nothing of what a fan wrote:
 * only the event's kind, its cause and the place to open.
 */
export interface AgencyAlertDeps {
  readonly reads: RouterReads;
  readonly onShift: (creatorId: CreatorId, at: Date) => Promise<readonly { readonly memberId: string }[]>;
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  readonly onFailure?: (step: string, error: unknown) => void;
}

/** Each run re-reads the last half hour, as `alerts.route`: an event read twice rings once (the key is the event). */
const WINDOW_MS = 30 * 60_000;
/** The reminders look back an hour and five minutes: the last one is due at 60 minutes. */
const REMINDER_WINDOW_MS = 65 * 60_000;

/**
 * `alerts.agency` (every minute): each agency alert of the window, to every owner. Urgent rings through the quiet hours
 * and outside the daily cap (`agency_urgent`); the others wait for the morning (`agency_alert`). A fact told in several
 * events (one per currency) rings once: its thread is the key. Returns the notifications asked.
 */
export async function routeAgencyAlerts(deps: AgencyAlertDeps, now: Date): Promise<number> {
  const rows = await deps.reads.agencyEvents(new Date(now.getTime() - WINDOW_MS));
  if (rows.length === 0) return 0;
  const [creators, owners] = await Promise.all([deps.reads.creators(), deps.reads.owners()]);
  const nameOf = new Map(creators.map((creator) => [creator.id, creator.name]));
  let asked = 0;
  for (const row of rows) {
    const scanned = toScannedEvent(row);
    if (scanned === null) continue;
    // An event of an archived creator reaches nobody (ADR 0071), as her tab's alerts.
    if (scanned.creatorId !== null && !nameOf.has(scanned.creatorId)) continue;
    const notice = classify(scanned.signal);
    if (notice === null) continue;
    const creatorName = scanned.creatorId === null ? null : (nameOf.get(scanned.creatorId) ?? null);
    const message = agencyMessage(scanned.signal, notice, creatorName);
    const objectKey =
      notice.oncePerThread === true && notice.threadKey !== null ? `thread:${notice.threadKey}` : row.id;
    for (const owner of owners) {
      try {
        await deps.notify(
          {
            userId: owner.userId,
            reason: notice.topic === 'urgent' ? 'agency_urgent' : 'agency_alert',
            objectKey,
            timeZone: owner.timeZone,
            message,
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

/**
 * `alerts.remind_safety` (every minute): a safety relay nobody took (no `takeover_started` nor `takeover_ended` after
 * it) rings again every 5 minutes for an hour, to whom it reached the first time: the owners, her managers, the
 * chatters on shift on her. Through the quiet hours, outside the cap (`safety_alert`). Returns the reminders asked.
 */
export async function remindSafety(deps: AgencyAlertDeps, now: Date): Promise<number> {
  const waiting = await deps.reads.waitingSafety(new Date(now.getTime() - REMINDER_WINDOW_MS));
  if (waiting.length === 0) return 0;
  const failed = (step: string) => (error: unknown) => {
    deps.onFailure?.(step, error);
    return [];
  };
  const [creators, owners, managers] = await Promise.all([
    deps.reads.creators(),
    deps.reads.owners().catch(failed('owners')),
    deps.reads.managers().catch(failed('managers')),
  ]);
  const nameOf = new Map(creators.map((creator) => [creator.id, creator.name]));
  let asked = 0;
  for (const relay of waiting) {
    const reminder = safetyReminderDue(relay.createdAt, now);
    if (reminder === null || !nameOf.has(relay.creatorId)) continue;
    const onShift = await deps.onShift(relay.creatorId, now).catch(failed('on_shift'));
    const chatters =
      onShift.length === 0
        ? []
        : await deps.reads.members(onShift.map((shift) => shift.memberId)).catch(failed('members'));
    const recipients = new Map(
      [...owners, ...managers.filter((m) => m.creatorIds.includes(relay.creatorId)), ...chatters].map(
        (recipient) => [recipient.userId, recipient],
      ),
    );
    const message = safetyReminderMessage(
      nameOf.get(relay.creatorId) ?? null,
      relay.conversationId,
      reminder,
    );
    for (const recipient of recipients.values()) {
      try {
        await deps.notify(
          {
            userId: recipient.userId,
            reason: 'safety_alert',
            objectKey: `${relay.id}:relance:${String(reminder)}`,
            timeZone: recipient.timeZone,
            message,
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
