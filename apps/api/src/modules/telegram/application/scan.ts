import type { CreatorId, TelegramChatId, TelegramTopic } from '@nirvana/contracts';

import { classify, type AlertNameOf, type MemberNameOf } from '../domain/classify';
import { chatsFor } from '../domain/coverage';
import type {
  AlertNames,
  BotsStore,
  Clock,
  CreatorRecord,
  DeliveriesStore,
  NewDelivery,
} from '../domain/ports';
import { isSilentTopic, renderNotice, renderClosedBy, renderPlain } from '../domain/render';
import { saleRings, saleSettingsFor } from '../domain/sales';
import { SCAN_OVERLAP_MS } from '../domain/schedule';
import type { Closure, Notice, ScannedEvent } from '../domain/signals';

export interface ScanDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly clock: Clock;
  /** The CRM's origin, for the links in the messages (WEB_ORIGIN). */
  readonly webOrigin: string;
  /** An urgent alert that no group can receive (ADR 0020 §12): logged as an error by the caller. */
  readonly onUncovered: (event: ScannedEvent) => void;
  /** Her alerts' names (P4-01); without them, a message says « une alerte personnalisée ». */
  readonly alertNames?: AlertNames;
}

const SCAN_LIMIT = 500;

/**
 * `telegram.scan` (ADR 0020 §7): turns the consumed events of the outbox into deliveries. Each event is applied in
 * its own transaction with the cursor, so a crash leaves nothing half done; the window re-read behind the cursor is
 * harmless thanks to the unique (source, group). Returns the number of events read.
 */
export async function scanEvents(deps: ScanDeps): Promise<number> {
  const cursor = await deps.deliveries.getCursor();
  const { events, lastReadAt } = await deps.deliveries.readEvents(
    new Date(cursor.getTime() - SCAN_OVERLAP_MS),
    SCAN_LIMIT,
  );
  if (events.length === 0) {
    // Rows it cannot read (a payload it does not know): the cursor goes past them, the scan never stalls behind them.
    if (lastReadAt !== null && lastReadAt > cursor)
      await deps.deliveries.applyScan({ deliveries: [], cursor: lastReadAt });
    return 0;
  }

  const [{ routes }, chats, creators, saleSettings] = await Promise.all([
    deps.bots.listRoutes(),
    deps.bots.listChats(),
    deps.bots.listCreators(),
    deps.bots.listSaleSettings(),
  ]);
  const reachable = new Set(
    chats.filter((chat) => chat.membership === 'member' && chat.canPost).map((chat) => chat.id),
  );
  const creatorById = new Map<CreatorId, CreatorRecord>(creators.map((creator) => [creator.id, creator]));
  const nameOf = alertNamer(deps.alertNames);
  const memberNameOf = memberNamer(deps.bots);

  let reached = cursor;
  for (const event of events) {
    const { signal } = event;
    // Under the minimum, or not the agent's when only his ring (CRM-04 lot b): read, and nothing sent.
    if (signal.kind === 'sale' && !saleRings(saleSettingsFor(saleSettings, event.creatorId), signal)) {
      if (event.createdAt > reached) reached = event.createdAt;
      await deps.deliveries.applyScan({ deliveries: [], cursor: reached });
      continue;
    }
    const outcome = classify(event.signal, await nameOf(event), await memberNameOf(event));
    let deliveries: readonly NewDelivery[] = [];
    if (outcome?.kind === 'notice') {
      const reach = (topic: TelegramTopic) =>
        chatsFor(routes, event.creatorId, topic).filter((id) => reachable.has(id));
      let notice = outcome;
      let targets = reach(notice.topic);
      if (targets.length === 0 && notice.fallbackTopic !== undefined) {
        notice = { ...notice, topic: notice.fallbackTopic };
        targets = reach(notice.topic);
      }
      if (targets.length === 0 && notice.topic === 'urgent') deps.onUncovered(event);
      const creatorName =
        event.creatorId === null ? null : (creatorById.get(event.creatorId)?.displayName ?? null);
      deliveries = noticeDeliveries(event, notice, targets, creatorName, deps.webOrigin);
    } else if (outcome?.kind === 'closure') {
      deliveries = await closureDeliveries(deps, event, outcome);
    }
    if (event.createdAt > reached) reached = event.createdAt;
    await deps.deliveries.applyScan({ deliveries, cursor: reached });
  }
  // Unreadable rows after the last readable one: the cursor goes past them too.
  if (lastReadAt !== null && lastReadAt > reached) {
    await deps.deliveries.applyScan({ deliveries: [], cursor: lastReadAt });
  }
  return events.length;
}

/** Her alerts' names, read once a scan per creator and only for an event that names one of hers. */
function alertNamer(names: AlertNames | undefined): (event: ScannedEvent) => Promise<AlertNameOf> {
  const read = new Map<CreatorId, Promise<ReadonlyMap<string, string>>>();
  return async (event) => {
    const { signal } = event;
    const alert = signal.kind === 'alert' || signal.kind === 'handoff' ? signal.alert : undefined;
    if (names === undefined || alert?.kind !== 'custom' || event.creatorId === null) return () => null;
    let hers = read.get(event.creatorId);
    if (hers === undefined) {
      // A name not read leaves the generic line: the message still goes, never held behind a name.
      hers = names.ofCreator(event.creatorId).catch(() => new Map<string, string>());
      read.set(event.creatorId, hers);
    }
    const byId = await hers;
    return (one) => byId.get(one.id) ?? null;
  };
}

/** A seller's name, read once a scan per member and only for a sale a member made (CRM-04 lot b). */
function memberNamer(bots: BotsStore): (event: ScannedEvent) => Promise<MemberNameOf> {
  const read = new Map<string, Promise<string | null>>();
  return async (event) => {
    const { signal } = event;
    if (signal.kind !== 'sale' || signal.seller.kind !== 'member') return () => null;
    const { memberId } = signal.seller;
    let name = read.get(memberId);
    if (name === undefined) {
      // A name not read leaves « vendue par un chatteur »: the sale still rings, never held behind a name.
      name = bots.memberName(memberId).catch(() => null);
      read.set(memberId, name);
    }
    const known = await name;
    return (id) => (id === memberId ? known : null);
  };
}

function noticeDeliveries(
  event: ScannedEvent,
  notice: Notice,
  targets: readonly TelegramChatId[],
  creatorName: string | null,
  webOrigin: string,
): readonly NewDelivery[] {
  const rendered = renderNotice(notice, creatorName, webOrigin);
  return targets.map((chatId) => ({
    sourceKey: event.id,
    chatId,
    creatorId: event.creatorId,
    topic: notice.topic,
    action: 'send',
    parentId: null,
    threadKey: notice.threadKey,
    text: rendered.text,
    summary: rendered.summary,
    isSilent: isSilentTopic(notice.topic),
    closedBy: null,
  }));
}

/** One edit or one reply per group that got a message of the thread. */
async function closureDeliveries(
  deps: ScanDeps,
  event: ScannedEvent,
  closure: Closure,
): Promise<readonly NewDelivery[]> {
  // A takeover then a release close the same alert: only the first one rewrites it.
  const roots = (await deps.deliveries.threadRoots(closure.threadKey)).filter(
    (root) => closure.mode !== 'edit' || root.closedBy === null,
  );
  if (roots.length === 0) return [];
  const name = closure.userId === null ? null : await deps.bots.userName(closure.userId);
  const firstName = name?.trim().split(/\s+/)[0] ?? null;
  return Promise.all(
    roots.map(async (root) => {
      if (closure.mode === 'edit') {
        const closedBy = firstName ?? 'un humain';
        await deps.deliveries.setClosedBy(root.id, closedBy);
        return {
          sourceKey: event.id,
          chatId: root.chatId,
          creatorId: root.creatorId,
          topic: root.topic,
          action: 'edit',
          parentId: root.id,
          threadKey: closure.threadKey,
          text: renderClosedBy(root.text, closure.text, firstName),
          summary: `${closure.text} par ${closedBy}`,
          isSilent: true,
          closedBy,
        } satisfies NewDelivery;
      }
      return {
        sourceKey: event.id,
        chatId: root.chatId,
        creatorId: root.creatorId,
        topic: root.topic === 'urgent' || root.topic === 'important' ? 'info' : root.topic,
        action: 'reply',
        parentId: root.id,
        threadKey: closure.threadKey,
        text: `✓ ${renderPlain(closure.text)}`,
        summary: closure.text,
        isSilent: true,
        closedBy: null,
      } satisfies NewDelivery;
    }),
  );
}
