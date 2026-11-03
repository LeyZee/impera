import { CONNECTION_SERVICES, type TelegramChatId, type TelegramTopic } from '@nirvana/contracts';

import { connectionReminder, connectionThreadKey } from '../domain/classify';
import { chatsFor } from '../domain/coverage';
import type { BotsStore, Clock, DeliveriesStore } from '../domain/ports';
import { isSilentTopic, renderNotice } from '../domain/render';

export interface ConnectionRemindersDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly clock: Clock;
  readonly webOrigin: string;
}

/** An outage still open this long after its alert gets its single reminder, in red (P3-12, Charles 03/11/2026). */
const CONNECTION_REMINDER_AFTER_MS = 2 * 60 * 60_000;

const REMINDER_PREFIX = 'reminder:';

/**
 * `telegram.connection_reminders`, every 10 minutes (P3-12): a service whose thread still ends on its outage alert,
 * 2 hours after it, gets one urgent reminder. The thread is read in the module's own deliveries: « Rétabli » or the
 * reminder itself is the latest message then, and nothing more goes; the reminder's key (`reminder:<alert>`) keeps it
 * once whatever the cron does. Returns the number of deliveries written.
 */
export async function connectionReminders(deps: ConnectionRemindersDeps): Promise<number> {
  const now = deps.clock.now();
  let written = 0;
  let reach: ((topic: TelegramTopic) => readonly TelegramChatId[]) | null = null;
  for (const service of CONNECTION_SERVICES) {
    const latest = await deps.deliveries.latestOfThread(connectionThreadKey(service));
    if (
      latest?.action !== 'send' ||
      latest.sourceKey.startsWith(REMINDER_PREFIX) ||
      now.getTime() - latest.createdAt.getTime() < CONNECTION_REMINDER_AFTER_MS
    )
      continue;
    reach ??= await reachableGroups(deps.bots);
    let notice = connectionReminder(service);
    let targets = reach(notice.topic);
    if (targets.length === 0 && notice.fallbackTopic !== undefined) {
      notice = { ...notice, topic: notice.fallbackTopic };
      targets = reach(notice.topic);
    }
    const rendered = renderNotice(notice, null, deps.webOrigin);
    for (const chatId of targets) {
      const added = await deps.deliveries.insertDelivery(
        {
          sourceKey: `${REMINDER_PREFIX}${latest.sourceKey}`,
          chatId,
          creatorId: null,
          topic: notice.topic,
          action: 'send',
          parentId: null,
          threadKey: notice.threadKey,
          text: rendered.text,
          summary: rendered.summary,
          isSilent: isSilentTopic(notice.topic),
          closedBy: null,
        },
        now,
      );
      if (added) written += 1;
    }
  }
  return written;
}

/** The agency's groups for a topic that can still be posted in; read once a run, and only when a reminder is due. */
async function reachableGroups(
  bots: BotsStore,
): Promise<(topic: TelegramTopic) => readonly TelegramChatId[]> {
  const [{ routes }, chats] = await Promise.all([bots.listRoutes(), bots.listChats()]);
  const reachable = new Set(
    chats.filter((chat) => chat.membership === 'member' && chat.canPost).map((chat) => chat.id),
  );
  return (topic) => chatsFor(routes, null, topic).filter((id) => reachable.has(id));
}
