import type { NotificationOutcome, NotificationRequest, PushMessage } from '@impera/contracts';

import { decideNotification, localClock } from '../domain/policy';
import type { DeliveryRegistry } from '../domain/ports';

import { deliver, preferencesOf, type DevicesDeps } from './devices';

export interface NotifyDeps extends DevicesDeps {
  readonly registry: DeliveryRegistry;
}

const OUTCOMES = {
  ring: 'rang',
  hold: 'held',
  group: 'grouped',
  silent: 'silent',
  duplicate: 'duplicate',
} as const;

/** The grouped notification of a burst of sales: one tag, so each new one replaces the last on the device. */
const SALES_BURST: Omit<PushMessage, 'url'> = {
  title: 'Les ventes s’enchaînent',
  body: 'Plusieurs ventes en quelques minutes : le détail est dans Impera.',
  tag: 'sales-burst',
};

/**
 * A notification another module asks for an account (CR-01): recorded once with its decision (a replayed job is a
 * no-op), then sent when it rings. Sent after the decision is kept, never before: at most once, even if the send
 * fails.
 */
export async function notify(
  deps: NotifyDeps,
  request: NotificationRequest,
  at: Date,
): Promise<NotificationOutcome> {
  const preferences = await preferencesOf(deps, request.userId);
  const clock = localClock(at, request.timeZone);
  const decision = await deps.registry.record(request, at, clock.day, (facts) =>
    decideNotification({
      kind: request.reason,
      at,
      timeZone: request.timeZone,
      quiet: preferences.quietHours,
      dailyCap: preferences.dailyCap,
      ...facts,
    }),
  );
  if (decision.action === 'ring') await deliver(deps, request.userId, request.message);
  if (decision.action === 'group')
    await deliver(deps, request.userId, { ...SALES_BURST, url: request.message.url });
  return OUTCOMES[decision.action];
}

/** `notifications.recap`, at the end of an account's quiet hours: one notification for all it held, or nothing. */
export async function recap(deps: NotifyDeps, userId: string, at: Date): Promise<number> {
  const held = await deps.registry.takeHeld(userId, at);
  if (held === 0) return 0;
  await deliver(deps, userId, {
    title: 'Pendant tes heures calmes',
    body:
      held === 1
        ? 'Une notification t’attend dans Impera.'
        : `${String(held)} notifications t’attendent dans Impera.`,
    url: '/',
    tag: 'quiet-recap',
  });
  return held;
}
