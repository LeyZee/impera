import {
  ok,
  err,
  type LinkSalesFeedChatterBody,
  type Platform,
  type Result,
  type SalesFeedChatterLink,
  type SalesFeedModelLink,
  type SalesFeedOverview,
  type SalesFeedRefusal,
  type SalesFeedStatus,
} from '@nirvana/contracts';

import {
  SalesFeedAccountUnprocessable,
  SalesFeedMemberUnprocessable,
  SalesFeedModelConflict,
  SalesFeedNotFound,
  SalesFeedVaultMissing,
} from '../domain/errors';
import type { Clock, JobLogger } from '../domain/ports';
import {
  errorKindOf,
  unknownValueSignals,
  type KeyActor,
  type PlatformSalesFeed,
  type SalesFeedFactory,
  type SalesFeedFailure,
  type SalesFeedKeyStore,
  type SalesFeedRegistry,
  type SalesLedger,
  type StoredSalesFeedKey,
} from '../domain/sales-feed';
import { SALES_FEED_ERROR_MESSAGES, salesFeedMessage } from '../domain/sales-feed-messages';

/** At most this many pages per platform and run (500 lines each): the next minute goes on from the cursor. */
const MAX_PAGES_PER_RUN = 20;

export interface SalesFeedDeps {
  /** `null` without CREDENTIALS_ENCRYPTION_KEYS: no key can be kept, nothing is read. */
  readonly keys: SalesFeedKeyStore | null;
  readonly ledger: SalesLedger;
  readonly registry: SalesFeedRegistry;
  readonly clock: Clock;
}

export interface SalesFeeds {
  list(): Promise<SalesFeedStatus[]>;
  overview(platform: Platform): Promise<SalesFeedOverview>;
  connect(platform: Platform, key: string, by: KeyActor): Promise<Result<SalesFeedStatus, SalesFeedRefusal>>;
  disconnect(platform: Platform, by: KeyActor): Promise<SalesFeedStatus>;
  linkModel(
    platform: Platform,
    platformModelId: string,
    platformAccountId: string | null,
    by: string | null,
  ): Promise<SalesFeedOverview>;
  linkChatter(
    platform: Platform,
    platformChatterId: string,
    link: LinkSalesFeedChatterBody,
    by: string | null,
  ): Promise<SalesFeedOverview>;
  /** The `connector.read_sales` job: every connected feed, from its cursor. */
  read(logger: JobLogger, correlationId: string): Promise<void>;
}

function refusal(kind: SalesFeedRefusal['kind']): SalesFeedRefusal {
  return { kind, message: SALES_FEED_ERROR_MESSAGES[kind] };
}

export function createSalesFeeds(deps: SalesFeedDeps): SalesFeeds {
  const { ledger, registry, clock } = deps;

  function factoryOf(platform: Platform): SalesFeedFactory {
    const factory = registry[platform];
    if (factory === undefined) throw new SalesFeedNotFound();
    return factory;
  }

  function keysOrThrow(): SalesFeedKeyStore {
    if (deps.keys === null) throw new SalesFeedVaultMissing();
    return deps.keys;
  }

  async function statusOf(platform: Platform): Promise<SalesFeedStatus> {
    factoryOf(platform);
    const [stored, cursor, quarantined] = await Promise.all([
      deps.keys?.find(platform) ?? Promise.resolve(null),
      ledger.cursorOf(platform),
      ledger.quarantined(platform),
    ]);
    const state = stored?.state ?? 'not_connected';
    const lastErrorKind = stored?.lastErrorKind ?? null;
    return {
      platform,
      state,
      capabilities: [...(stored?.capabilities ?? [])],
      verifiedAt: stored?.verifiedAt.toISOString() ?? null,
      lastReadAt: cursor.readAt?.toISOString() ?? null,
      lastErrorKind,
      message: salesFeedMessage(state, lastErrorKind),
      quarantined: [...quarantined.values()].reduce((sum, count) => sum + count, 0),
    };
  }

  /** The feed of the saved key, or `null` when there is none that works. */
  async function liveFeed(platform: Platform): Promise<PlatformSalesFeed | null> {
    const stored = await deps.keys?.find(platform);
    if (stored?.key == null || stored.state !== 'connected') return null;
    return factoryOf(platform).create(stored.key);
  }

  async function overview(platform: Platform): Promise<SalesFeedOverview> {
    const status = await statusOf(platform);
    const [links, quarantined, chatterLinks, platformAccounts] = await Promise.all([
      ledger.modelLinks(platform),
      ledger.quarantined(platform),
      ledger.chatterLinks(platform),
      ledger.accounts(platform),
    ]);
    const linkedBy = (id: string): SalesFeedModelLink['linkedBy'] => {
      const link = links.get(id);
      if (link === undefined) return null;
      return link.linkedBy === null ? { kind: 'auto' } : { kind: 'member', userId: link.linkedBy };
    };
    const modelOf = new Map([...links].map(([id, link]) => [link.platformAccountId, id]));
    const accounts = platformAccounts.map((account) => ({
      platformAccountId: account.platformAccountId,
      handle: account.handle,
      creatorDisplayName: account.creatorDisplayName,
      linkedTo: modelOf.get(account.platformAccountId) ?? null,
    }));
    const feed = await liveFeed(platform);
    let listError: SalesFeedOverview['listError'] = feed === null ? status.lastErrorKind : null;
    const models: SalesFeedModelLink[] = [];
    const chatters: SalesFeedChatterLink[] = [];
    if (feed !== null) {
      const [listedModels, listedChatters] = await Promise.all([feed.listModels(), feed.listChatters()]);
      if (listedModels.ok) {
        for (const model of listedModels.value) {
          models.push({
            platformModelId: model.platformModelId,
            handle: model.handle,
            displayName: model.displayName,
            platformAccountId: links.get(model.platformModelId)?.platformAccountId ?? null,
            linkedBy: linkedBy(model.platformModelId),
            quarantined: quarantined.get(model.platformModelId) ?? 0,
          });
        }
      } else listError = errorKindOf(listedModels.failure);
      if (listedChatters.ok) {
        for (const chatter of listedChatters.value) {
          chatters.push({ ...chatter, link: chatterLinks.get(chatter.platformChatterId) ?? null });
        }
      } else listError ??= errorKindOf(listedChatters.failure);
    }
    // A model with a link or waiting lines that the platform no longer lists (or that could not be listed) stays
    // visible, so its lines are never out of sight.
    const listed = new Set(models.map((model) => model.platformModelId));
    for (const id of new Set([...links.keys(), ...quarantined.keys()])) {
      if (listed.has(id)) continue;
      models.push({
        platformModelId: id,
        handle: id,
        displayName: '',
        platformAccountId: links.get(id)?.platformAccountId ?? null,
        linkedBy: linkedBy(id),
        quarantined: quarantined.get(id) ?? 0,
      });
    }
    return { status, models, accounts, chatters, listError };
  }

  /** Links each listed model to the one account of the platform with the same handle, when nothing links them yet. */
  async function linkByHandle(platform: Platform, feed: PlatformSalesFeed): Promise<void> {
    const listed = await feed.listModels();
    if (!listed.ok) return;
    const [accounts, links] = await Promise.all([ledger.accounts(platform), ledger.modelLinks(platform)]);
    const linkedAccounts = new Set([...links.values()].map((link) => link.platformAccountId));
    for (const model of listed.value) {
      if (links.has(model.platformModelId)) continue;
      const matches = accounts.filter(
        (account) => account.handle.toLowerCase() === model.handle.toLowerCase(),
      );
      const [account] = matches;
      if (matches.length !== 1 || account === undefined || linkedAccounts.has(account.platformAccountId))
        continue;
      await ledger.linkModel(
        platform,
        model.platformModelId,
        { platformAccountId: account.platformAccountId, creatorId: account.creatorId },
        null,
      );
      linkedAccounts.add(account.platformAccountId);
    }
  }

  async function onFailure(
    platform: Platform,
    stored: StoredSalesFeedKey,
    failure: SalesFeedFailure,
    logger: JobLogger,
    correlationId: string,
  ): Promise<void> {
    const keys = keysOrThrow();
    const kind = errorKindOf(failure);
    if (failure.kind === 'refused') {
      const before = await keys.markState(platform, 'needs_reconnect', kind);
      if (before?.state !== 'needs_reconnect') {
        await ledger.signal(platform, { kind: 'needs_reconnect', errorKind: kind }, false, correlationId);
      }
      logger.warn({ platform, kind }, 'sales feed key refused: reading stopped until it is connected again');
      return;
    }
    if (failure.kind === 'rate_limited') {
      await ledger.pause(platform, new Date(clock.now().getTime() + failure.retryAfterMs));
    }
    const before = await keys.markState(platform, stored.state, kind);
    if (failure.kind === 'unexpected_answer') {
      if (before?.lastErrorKind !== 'unexpected_answer') {
        await ledger.signal(platform, { kind: 'unexpected_answer' }, false, correlationId);
      }
      // Paths only, never values (adapter): nothing of a fan reaches the log.
      logger.warn({ platform, detail: failure.detail }, 'sales feed answer not readable: cursor kept');
      return;
    }
    logger.info({ platform, kind }, 'sales feed not read this time');
  }

  async function readOne(
    stored: StoredSalesFeedKey,
    logger: JobLogger,
    correlationId: string,
  ): Promise<void> {
    const { platform } = stored;
    const factory = registry[platform];
    if (factory === undefined || stored.key === null || stored.state !== 'connected') return;
    const cursor = await ledger.cursorOf(platform);
    const now = clock.now();
    if (cursor.pausedUntil !== null && cursor.pausedUntil > now) return;
    const feed = factory.create(stored.key);
    let position = cursor.position;
    const totals = { pages: 0, recorded: 0, quarantined: 0, duplicates: 0 };
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const read = await feed.readSales(position);
      if (!read.ok) {
        await onFailure(platform, stored, read.failure, logger, correlationId);
        return;
      }
      const result = await ledger.recordPage(platform, position, read.value, clock.now());
      if (result.stale) {
        logger.info({ platform }, 'sales feed cursor moved by another run: stopping here');
        break;
      }
      totals.pages += 1;
      totals.recorded += result.recorded;
      totals.quarantined += result.quarantined;
      totals.duplicates += result.duplicates;
      for (const signal of unknownValueSignals(read.value.unknown)) {
        await ledger.signal(platform, signal, true, correlationId);
      }
      for (const platformModelId of result.unlinkedModels) {
        await ledger.signal(platform, { kind: 'model_unlinked', platformModelId }, true, correlationId);
      }
      for (const line of result.changed) {
        await ledger.signal(platform, { kind: 'line_changed', ...line }, false, correlationId);
      }
      position = read.value.endPosition ?? position;
      if (!read.value.hasMore) break;
    }
    if (stored.lastErrorKind !== null) await keysOrThrow().markState(platform, 'connected', null);
    // Counts only: never a sale's id, a fan's id or pseudo.
    logger.info({ platform, ...totals }, 'sales feed read');
  }

  return {
    async list() {
      const platforms = Object.keys(registry).filter((name): name is Platform => name in registry);
      return Promise.all(platforms.map(statusOf));
    },

    overview,

    async connect(platform, key, by) {
      const factory = factoryOf(platform);
      const keys = keysOrThrow();
      if (!factory.isPlausibleKey(key)) return err(refusal('malformed'));
      const feed = factory.create(key);
      const verified = await feed.verify();
      // Refused, rate-limited or unreachable: nothing is kept, a key already saved stays as it was.
      if (!verified.ok) return err(refusal(errorKindOf(verified.failure)));
      await keys.save(platform, key, verified.value, clock.now(), by);
      await linkByHandle(platform, feed);
      return ok(await statusOf(platform));
    },

    async disconnect(platform, by) {
      factoryOf(platform);
      await keysOrThrow().remove(platform, by);
      return statusOf(platform);
    },

    async linkModel(platform, platformModelId, platformAccountId, by) {
      factoryOf(platform);
      if (platformAccountId === null) {
        await ledger.unlinkModel(platform, platformModelId, by);
        return overview(platform);
      }
      const account = (await ledger.accounts(platform)).find(
        (candidate) => candidate.platformAccountId === platformAccountId,
      );
      if (account === undefined) throw new SalesFeedAccountUnprocessable();
      const linked = await ledger.linkModel(
        platform,
        platformModelId,
        { platformAccountId: account.platformAccountId, creatorId: account.creatorId },
        by,
      );
      if (linked === 'conflict') throw new SalesFeedModelConflict();
      return overview(platform);
    },

    async linkChatter(platform, platformChatterId, link, by) {
      factoryOf(platform);
      if (link.kind === 'member' && !(await ledger.memberExists(link.memberId))) {
        throw new SalesFeedMemberUnprocessable();
      }
      await ledger.linkChatter(platform, platformChatterId, link.kind === 'none' ? null : link, by);
      return overview(platform);
    },

    async read(logger, correlationId) {
      if (deps.keys === null) return;
      for (const stored of await deps.keys.list()) {
        await readOne(stored, logger, correlationId);
      }
    },
  };
}
