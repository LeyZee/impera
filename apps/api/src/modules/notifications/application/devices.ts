import {
  DomainError,
  type NotificationErrorCode,
  type NotificationPreferences,
  type PushMessage,
  type PushSubscriptionInput,
  type PushTestResult,
} from '@impera/contracts';

import { DEFAULT_DAILY_CAP, DEFAULT_QUIET_HOURS } from '../domain/policy';
import type { PreferencesStore, PushSender, ServerKeyStore, SubscriptionStore } from '../domain/ports';

export interface DevicesDeps {
  readonly keys: ServerKeyStore;
  readonly subscriptions: SubscriptionStore;
  readonly preferences: PreferencesStore;
  readonly sender: PushSender;
}

class PushSubscriptionNotFound extends DomainError {
  constructor() {
    super(
      'push_subscription_not_found' satisfies NotificationErrorCode,
      'Aucun appareil n’a encore accepté les notifications sur ce compte',
    );
  }
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  quietHours: DEFAULT_QUIET_HOURS,
  dailyCap: DEFAULT_DAILY_CAP,
};

export async function publicKey(deps: DevicesDeps): Promise<string> {
  return (await deps.keys.current()).publicKey.toString('base64url');
}

export async function subscribe(
  deps: DevicesDeps,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const key = await deps.keys.current();
  await deps.subscriptions.save(userId, input, key.id);
}

export async function preferencesOf(deps: DevicesDeps, userId: string): Promise<NotificationPreferences> {
  return (await deps.preferences.get(userId)) ?? DEFAULT_PREFERENCES;
}

/**
 * Sends `message` to every device of the account made with the current key; a dead one is forgotten. The rules of
 * what may ring (quiet hours, cap) are the caller's: this only delivers.
 */
export async function deliver(
  deps: DevicesDeps,
  userId: string,
  message: PushMessage,
): Promise<PushTestResult> {
  const key = await deps.keys.current();
  const devices = await deps.subscriptions.listFor(userId, key.id);
  let sent = 0;
  for (const device of devices) {
    const outcome = await deps.sender.send(device, key, message);
    if (outcome === 'sent') {
      sent += 1;
      await deps.subscriptions.touch(userId, device.id);
    } else if (outcome === 'gone') {
      await deps.subscriptions.drop(userId, device.id);
    }
  }
  return { devices: devices.length, sent };
}

/** « Envoyer une notification de test » in Moi › Notifications: rings now, whatever the hour. */
export async function sendTest(deps: DevicesDeps, userId: string): Promise<PushTestResult> {
  const result = await deliver(deps, userId, {
    title: 'Notifications activées',
    body: 'C’est ici qu’Impera te préviendra.',
    url: '/moi',
    tag: 'test',
  });
  if (result.devices === 0) throw new PushSubscriptionNotFound();
  return result;
}
