import {
  DEFAULT_TELEGRAM_SALE_SETTINGS,
  err,
  ok,
  type Result,
  type TelegramSaleSettingsEntry,
  type TelegramSalesSettings,
} from '@nirvana/contracts';

import { chatsFor } from '../domain/coverage';
import type { BotsStore, Clock, DeliveriesStore, SalesTotalsReader } from '../domain/ports';
import { eveningDigestText, saleSettingsFor } from '../domain/sales';
import { eveningDigestOf } from '../domain/schedule';

/** The sales topic of Réglages › Telegram and its evening digest (CRM-04 lot b). */

/** The whole list, the entry for every creator first and always there (the defaults when none was saved). */
export async function saleSettings(deps: { readonly bots: BotsStore }): Promise<TelegramSalesSettings> {
  const entries = await deps.bots.listSaleSettings();
  const forAll = entries.find((entry) => entry.creatorId === null) ?? {
    creatorId: null,
    ...DEFAULT_TELEGRAM_SALE_SETTINGS,
  };
  return { settings: [forAll, ...entries.filter((entry) => entry.creatorId !== null)] };
}

/** Replaces the list; a creator who does not exist refuses it whole. */
export async function saveSaleSettings(
  deps: { readonly bots: BotsStore },
  entries: readonly TelegramSaleSettingsEntry[],
  userId: string,
): Promise<Result<TelegramSalesSettings, 'unknown_creator'>> {
  const creators = new Set((await deps.bots.listCreators()).map((creator) => creator.id));
  if (entries.some((entry) => entry.creatorId !== null && !creators.has(entry.creatorId))) {
    return err('unknown_creator');
  }
  await deps.bots.replaceSaleSettings(entries, userId);
  return ok(await saleSettings(deps));
}

/**
 * `telegram.evening_digest`, hourly: in each creator's 23 o'clock hour, her day's sales to the groups of her sales
 * topic, unless the owner turned the digest off for her. The key of the day makes it once, whatever the cron does. A
 * creator whose totals cannot be read does not hold the others back: the run goes on, then fails naming how many were
 * missed, so the worker logs it.
 */
export async function eveningDigest(deps: {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly clock: Clock;
  readonly salesTotals: SalesTotalsReader;
}): Promise<number> {
  const now = deps.clock.now();
  const [creators, { routes }, chats, settings] = await Promise.all([
    deps.bots.listCreators(),
    deps.bots.listRoutes(),
    deps.bots.listChats(),
    deps.bots.listSaleSettings(),
  ]);
  const reachable = new Set(
    chats.filter((chat) => chat.membership === 'member' && chat.canPost).map((chat) => chat.id),
  );
  let sent = 0;
  let missed = 0;
  for (const creator of creators) {
    const evening = eveningDigestOf(creator.id, creator.timezone, now);
    if (evening === null || !saleSettingsFor(settings, creator.id).eveningDigest) continue;
    const targets = chatsFor(routes, creator.id, 'sale').filter((id) => reachable.has(id));
    if (targets.length === 0) continue;
    let totals;
    try {
      totals = await deps.salesTotals.totalsOf(creator.id, evening.day);
    } catch {
      missed += 1;
      continue;
    }
    const memberIds = new Set(
      totals.rows.flatMap((row) => (row.seller.kind === 'member' ? [row.seller.memberId] : [])),
    );
    const names = new Map<string, string | null>();
    for (const memberId of memberIds) {
      names.set(memberId, await deps.bots.memberName(memberId).catch(() => null));
    }
    const { text, summary } = eveningDigestText(
      creator.displayName,
      totals,
      (memberId) => names.get(memberId) ?? null,
    );
    for (const chatId of targets) {
      const added = await deps.deliveries.insertDelivery(
        {
          sourceKey: evening.key,
          chatId,
          creatorId: creator.id,
          topic: 'sale',
          action: 'send',
          parentId: null,
          threadKey: null,
          text,
          summary,
          isSilent: true,
          closedBy: null,
        },
        now,
      );
      if (added) sent += 1;
    }
  }
  if (missed > 0) throw new Error(`evening digest: totals unreadable for ${String(missed)} creator(s)`);
  return sent;
}
