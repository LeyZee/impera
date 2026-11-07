import {
  calendarDayAt,
  CreatorIdSchema,
  ok,
  err,
  payPeriodLastDay,
  SALES_FEED_MISMATCH_DAYS_MAX,
  type ConnectionSignal,
  type JobPayload,
  type PayPeriod,
  type LinkSalesFeedChatterBody,
  type Platform,
  type Result,
  type SalesFeedChatterLink,
  type SalesFeedCheckBody,
  type SalesFeedCheckReport,
  type SalesFeedLastCheck,
  type SalesFeedNewModels,
  type ImportSalesFeedModelsBody,
  type SalesFeedDismissedModel,
  type SalesFeedImportCandidate,
  type SalesFeedImportLineResult,
  type SalesFeedImportResult,
  type SalesFeedModelLink,
  type SalesFeedOverview,
  type SalesFeedRefusal,
  type SalesFeedStatus,
} from '@impera/contracts';

import { fortnightBefore, mismatchDays, type CheckedAccount } from '../domain/auto-check';
import type { AvatarPorts } from '../domain/avatar';
import { isLastingOutage, nextUnreachableRun, type UnreachableRun } from '../domain/connection-outage';
import {
  SalesFeedAccountUnprocessable,
  SalesFeedCheckDaysUnprocessable,
  SalesFeedDeliveryRefused,
  SalesFeedListUnavailable,
  SalesFeedMemberUnprocessable,
  SalesFeedTeamForbidden,
  SalesFeedModelConflict,
  SalesFeedNotConnected,
  SalesFeedNotFound,
  SalesFeedVaultMissing,
  SalesFeedWebhookNotFound,
  SalesFeedWebhookUrlUnprocessable,
} from '../domain/errors';
import { proposeImports } from '../domain/model-import';
import { sightingChanges } from '../domain/model-sightings';
import type { Clock, JobLogger } from '../domain/ports';
import {
  buildCheckReport,
  isCleanMatch,
  readDashboardExport,
  type CheckSources,
} from '../domain/reliability-check';
import {
  errorKindOf,
  unknownValueSignals,
  type DateRange,
  type KeyActor,
  type ListedModel,
  type PlatformSalesFeed,
  type SalesFeedFactory,
  type SalesFeedFailure,
  type SalesFeedJobs,
  type SalesFeedKeyStore,
  type SalesFeedWebhookStore,
  type SalesFeedRegistry,
  type SalesLedger,
  type StoredSalesFeedKey,
} from '../domain/sales-feed';
import { SALES_FEED_ERROR_MESSAGES, salesFeedMessage } from '../domain/sales-feed-messages';
import type { TeamImportStore } from '../domain/team-import';

import { copyAvatarFrom } from './avatar-copy';
import { createTeamImport, teamLinkOf, type TeamImport } from './team-import';

/**
 * How often the reading looks at the platform's model list (CRM-07 a2): for the badge of new models, and the signal of a
 * linked model gone or banned. One call more in a quarter of an hour, under Reveal's ten a minute.
 */
const WATCH_MODELS_MS = 15 * 60 * 1000;
/** At most this many pages per platform and run (500 lines each): the next minute goes on from the cursor. */
const MAX_PAGES_PER_RUN = 20;
/** The inbox only tells a second sending of a delivery, which the platform makes within hours: a week is plenty. */
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** The register is read a day wider on each side than the days checked: each line is then placed on its own day. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** With a working webhook, the minute's reading becomes an hourly catch-up; a delivery wakes it in between. */
const CATCH_UP_MS = 60 * 60 * 1000;
/** A mismatch of the automatic check is looked at again a day later: a late line or refund may have come since. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

/** An account the automatic check compares, as the pay rules say it (the `scheduling` module's read). */
interface AutoCheckedAccount extends CheckedAccount {
  readonly platform: Platform;
}

export interface SalesFeedDeps {
  /** `null` without CREDENTIALS_ENCRYPTION_KEYS: no key can be kept, nothing is read. */
  readonly keys: SalesFeedKeyStore | null;
  readonly ledger: SalesLedger;
  /** The team imported from the platform after review (ADR 0076), read and written as the viewer (`withMember`). */
  readonly team: TeamImportStore;
  readonly registry: SalesFeedRegistry;
  readonly clock: Clock;
  /** `null` without CREDENTIALS_ENCRYPTION_KEYS, like `keys`. */
  readonly webhooks: SalesFeedWebhookStore | null;
  readonly jobs: SalesFeedJobs;
  /** Impera's public address for a platform's deliveries; `null` when it is not HTTPS (development). */
  readonly webhookUrl: (platform: Platform) => string | null;
  /**
   * The accounts paid on the platform's net over the whole of a fortnight (CRM-04 b3): the pay rules' `detected`, read
   * by the `scheduling` module and given by the composition root.
   */
  readonly detectedAccounts: (period: PayPeriod) => Promise<readonly AutoCheckedAccount[]>;
  /**
   * What the reading saw of the platform's register (Telegram P3-12): the outbox keeps the transitions only
   * (`connection_state_changed`). Absent in tests that do not look at it.
   */
  readonly connectionState?: (
    platform: Platform,
    signal: ConnectionSignal,
    correlationId: string,
  ) => Promise<unknown>;
  /** Her photo's copy at import (CRM-07 a2b); `null` without a media bucket (`S3_*`): her initials stay. */
  readonly avatars?: AvatarPorts | null;
}

export interface SalesFeeds {
  /** The team imported from the platform after review (ADR 0076): the owner's and an active manager's screen. */
  readonly team: TeamImport;
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
  /**
   * « Importer la sélection » (CRM-07, ADR 0069): each line imported in its own transaction, from the platform's live
   * list read now, never from what the client sent; a refused line does not stop the others.
   */
  importModels(
    platform: Platform,
    body: ImportSalesFeedModelsBody,
    by: string | null,
  ): Promise<SalesFeedImportResult>;
  /** Sets a model aside from the import (`true`), or takes it back (`false`). */
  dismissModel(
    platform: Platform,
    platformModelId: string,
    dismissed: boolean,
    by: string | null,
  ): Promise<SalesFeedOverview>;
  /** Registers Impera's webhook at the platform (replacing one already there) and keeps its secret sealed. */
  connectWebhook(platform: Platform, by: KeyActor): Promise<Result<SalesFeedStatus, SalesFeedRefusal>>;
  disconnectWebhook(platform: Platform, by: KeyActor): Promise<SalesFeedStatus>;
  /**
   * A delivery of the platform's webhook: checked against the secret, put in the inbox once, and the reading of the
   * register woken. Throws `SalesFeedDeliveryRefused` (401) when it does not pass; nothing of it is kept then.
   */
  receive(
    platform: Platform,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    logger: JobLogger,
  ): Promise<void>;
  /**
   * The `connector.read_sales` job: every connected feed, from its cursor. `woken` by a delivery, it reads now;
   * otherwise a feed whose webhook works is read once an hour, the others every minute (ADR 0050 § 3).
   */
  read(logger: JobLogger, correlationId: string, woken: boolean): Promise<void>;
  /**
   * The reliability check of ADR 0050 § 8 (CRM-02): the register against the platform's statistics and the
   * dashboard's export, read for this answer only. The report is kept, by `by`, for the switch of CRM-03; the export
   * never is. A refusal of the platform is said, not recorded (the minute's reading records it). Throws
   * `SalesFeedExportUnprocessable` (422) for an export it cannot read.
   */
  check(
    platform: Platform,
    body: SalesFeedCheckBody,
    by: string | null,
  ): Promise<Result<SalesFeedCheckReport, SalesFeedRefusal>>;
  /** The latest report kept, `null` before any check. */
  lastCheck(platform: Platform): Promise<SalesFeedLastCheck>;
  /** The models listed last with no link and not set aside, for the owner's badge (ADR 0069 § 5). */
  newModels(): Promise<SalesFeedNewModels>;
  /**
   * The `connector.check_sales` job (CRM-04 b3). On the 2nd and the 17th, without `recheck`: every connected feed,
   * the fortnight just over, the register's net against the platform's statistics for the accounts paid on that net
   * over the whole fortnight; a mismatch is looked at again a day later. With `recheck`: that look, which publishes
   * `sales_feed_mismatch` once if the mismatch is still there. No export, nothing kept in `sales_feed_checks`, never
   * a switch; pay never reads it. Throws when a platform refused, so the job is tried again.
   */
  autoCheck(
    payload: JobPayload<'connector.check_sales'>,
    logger: JobLogger,
    correlationId: string,
  ): Promise<void>;
  /**
   * The `connector.copy_avatar` job (CRM-07 a2b): the model read again in the platform's live list, never an address
   * the client or the queue carried, and her photo copied to our bucket. What cannot be copied is said in the log and
   * left (her initials stay); a platform or storage that does not answer throws, so the job is tried again.
   */
  copyAvatar(payload: JobPayload<'connector.copy_avatar'>, logger: JobLogger): Promise<void>;
}

/** The two statistics of the days, one call after the other: Reveal allows ten a minute a key. */
async function checkStats(feed: PlatformSalesFeed, range: DateRange): Promise<CheckSources['stats']> {
  const daily = await feed.dailyStats(range);
  if (!daily.ok) return { ok: false, errorKind: errorKindOf(daily.failure) };
  const chatters = await feed.chatterDailyStats(range);
  if (!chatters.ok) return { ok: false, errorKind: errorKindOf(chatters.failure) };
  return { ok: true, daily: daily.value, chatters: chatters.value };
}

function refusal(kind: SalesFeedRefusal['kind']): SalesFeedRefusal {
  return { kind, message: SALES_FEED_ERROR_MESSAGES[kind] };
}

export function createSalesFeeds(deps: SalesFeedDeps): SalesFeeds {
  const { ledger, registry, clock } = deps;
  /** The failed reads in a row of each platform, in the worker that reads; a restart starts the count again. */
  const unreachable = new Map<Platform, UnreachableRun>();
  /** When each platform's model list was last looked at, in the worker that reads; a restart looks at once. */
  const watchedAt = new Map<Platform, number>();

  /**
   * One reading of the model list kept (ADR 0069 § 5): the sightings, a signal for a linked model gone or banned (sent
   * before its mark is written: a failure repeats it rather than loses it), and a status the adapter did not know.
   */
  async function watchModels(
    platform: Platform,
    listed: readonly ListedModel[],
    correlationId: string,
  ): Promise<void> {
    const [previous, links] = await Promise.all([ledger.sightings(platform), ledger.modelLinks(platform)]);
    const changes = sightingChanges(previous, listed, new Set(links.keys()));
    for (const signal of changes.signals) await ledger.signal(platform, signal, false, correlationId);
    const unknown = listed
      .filter((model) => model.status === 'other' && model.rawStatus !== '')
      .map((model) => ({ field: 'status' as const, value: model.rawStatus }));
    for (const signal of unknownValueSignals(unknown))
      await ledger.signal(platform, signal, true, correlationId);
    await ledger.recordSightings(platform, listed, changes, clock.now());
  }

  async function tell(platform: Platform, signal: ConnectionSignal, correlationId: string): Promise<void> {
    await deps.connectionState?.(platform, signal, correlationId);
  }

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
    const [stored, cursor, quarantined, webhook] = await Promise.all([
      deps.keys?.find(platform) ?? Promise.resolve(null),
      ledger.cursorOf(platform),
      ledger.quarantined(platform),
      deps.webhooks?.find(platform) ?? Promise.resolve(null),
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
      webhook:
        webhook === null
          ? null
          : {
              createdAt: webhook.createdAt.toISOString(),
              lastDeliveryAt: webhook.lastDeliveryAt?.toISOString() ?? null,
              lastRejectedAt: webhook.lastRejectedAt?.toISOString() ?? null,
            },
    };
  }

  function webhooksOrThrow(): SalesFeedWebhookStore {
    if (deps.webhooks === null) throw new SalesFeedVaultMissing();
    return deps.webhooks;
  }

  /** Removes the webhook at the platform (when the key still works) and here; a platform that refuses is not waited for. */
  async function dropWebhook(platform: Platform, by: KeyActor): Promise<void> {
    const store = webhooksOrThrow();
    const stored = await store.find(platform);
    if (stored === null) return;
    const feed = await liveFeed(platform);
    // Best effort at the platform: its webhook then posts to an address that refuses it (404), until it gives up.
    if (feed !== null) await feed.deleteWebhook(stored.platformWebhookId);
    await store.remove(platform, by);
  }

  /** The feed of the saved key, or `null` when there is none that works. */
  async function liveFeed(platform: Platform): Promise<PlatformSalesFeed | null> {
    const stored = await deps.keys?.find(platform);
    if (stored?.key == null || stored.state !== 'connected') return null;
    return factoryOf(platform).create(stored.key);
  }

  /** The photo's copy, or why it was not made (CRM-07 a2b). */
  async function copyAvatarOf(payload: JobPayload<'connector.copy_avatar'>): Promise<string | null> {
    const avatars = deps.avatars ?? null;
    if (avatars === null) return 'no_bucket';
    if (registry[payload.platform] === undefined) return 'not_connected';
    const feed = await liveFeed(payload.platform);
    if (feed === null) return 'not_connected';
    const listed = await feed.listModels();
    if (!listed.ok) {
      if (listed.failure.kind === 'refused') return 'list_refused';
      throw new Error(`creator photo: ${payload.platform} model list unavailable (${listed.failure.kind})`);
    }
    const model = listed.value.find((candidate) => candidate.platformModelId === payload.platformModelId);
    if (model === undefined) return 'not_listed';
    if (model.avatarUrl === null) return 'no_photo';
    const outcome = await copyAvatarFrom(avatars, payload.creatorId, model.avatarUrl);
    return outcome.copied ? null : outcome.skip;
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
    let candidates: SalesFeedImportCandidate[] = [];
    const dismissed: SalesFeedDismissedModel[] = [];
    if (feed !== null) {
      const [listedModels, listedChatters] = await Promise.all([feed.listModels(), feed.listChatters()]);
      if (listedModels.ok) {
        const [creators, dismissals] = await Promise.all([ledger.creators(), ledger.dismissals(platform)]);
        candidates = proposeImports({
          models: listedModels.value,
          linked: new Set(links.keys()),
          dismissed: new Set(dismissals.keys()),
          accounts: platformAccounts.map((account) => ({
            creatorId: CreatorIdSchema.parse(account.creatorId),
            handle: account.handle,
          })),
          creators,
        });
        for (const model of listedModels.value) {
          const at = dismissals.get(model.platformModelId);
          if (at !== undefined && !links.has(model.platformModelId)) {
            dismissed.push({ model, dismissedAt: at.toISOString() });
          }
        }
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
        await deps.team.recordReading(platform, listedChatters.value, clock.now());
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
    return { status, models, accounts, chatters, listError, candidates, dismissed };
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
      await tell(platform, { state: 'down', reason: 'refused' }, correlationId);
      logger.warn({ platform, kind }, 'sales feed key refused: reading stopped until it is connected again');
      return;
    }
    if (failure.kind === 'unreachable') {
      const now = clock.now();
      const run = nextUnreachableRun(unreachable.get(platform) ?? null, now);
      unreachable.set(platform, run);
      if (isLastingOutage(run, now))
        await tell(platform, { state: 'down', reason: 'unreachable' }, correlationId);
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
    woken: boolean,
  ): Promise<void> {
    const { platform } = stored;
    const factory = registry[platform];
    if (factory === undefined || stored.key === null || stored.state !== 'connected') return;
    const cursor = await ledger.cursorOf(platform);
    const now = clock.now();
    if (cursor.pausedUntil !== null && cursor.pausedUntil > now) return;
    const feed = factory.create(stored.key);
    if (now.getTime() - (watchedAt.get(platform) ?? 0) >= WATCH_MODELS_MS) {
      watchedAt.set(platform, now.getTime());
      const listed = await feed.listModels();
      // A list that does not answer is looked at again in a quarter of an hour; the sales are read all the same.
      if (listed.ok) await watchModels(platform, listed.value, correlationId);
    }
    if (!woken && cursor.readAt !== null && now.getTime() - cursor.readAt.getTime() < CATCH_UP_MS) {
      const webhook = await deps.webhooks?.find(platform);
      // A webhook whose secret still opens: its deliveries wake the reading, the minute has nothing to add.
      if (webhook?.secret != null) return;
    }
    let position = cursor.position;
    const totals = { pages: 0, recorded: 0, quarantined: 0, duplicates: 0 };
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const read = await feed.readSales(position);
      if (!read.ok) {
        await onFailure(platform, stored, read.failure, logger, correlationId);
        return;
      }
      const result = await ledger.recordPage(platform, position, read.value, clock.now(), correlationId);
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
    unreachable.delete(platform);
    if (stored.lastErrorKind !== null) {
      await keysOrThrow().markState(platform, 'connected', null);
      // An answer after a failure: back, if a `down` was published.
      await tell(platform, { state: 'back' }, correlationId);
    }
    await deps.webhooks?.prune(new Date(now.getTime() - DELIVERY_RETENTION_MS));
    // Counts only: never a sale's id, a fan's id or pseudo.
    logger.info({ platform, ...totals }, 'sales feed read');
  }

  /**
   * The reliability check's report over `range` (ADR 0050 § 8, CRM-02), with the export when one is given, and the
   * owner's model links it was built with. Shared by the check of Réglages and the automatic one (CRM-04 b3).
   */
  async function buildReport(
    platform: Platform,
    feed: PlatformSalesFeed,
    range: DateRange,
    exportText: string | null,
  ): Promise<
    Result<
      {
        readonly report: SalesFeedCheckReport;
        readonly modelLinks: Awaited<ReturnType<SalesLedger['modelLinks']>>;
      },
      SalesFeedRefusal
    >
  > {
    const models = await feed.listModels();
    if (!models.ok) return err(refusal(errorKindOf(models.failure)));
    const exported =
      exportText === null
        ? null
        : readDashboardExport(exportText, {
            from: range.from,
            to: range.to,
            timeZone: feed.timeZone,
            models: models.value,
          });
    const stats = await checkStats(feed, range);
    const platformChatters = await feed.listChatters();
    const [lines, firstLineAt, cursor, modelLinks, chatterLinks] = await Promise.all([
      ledger.checkLines(
        platform,
        new Date(Date.parse(`${range.from}T00:00:00Z`) - DAY_MS),
        new Date(Date.parse(`${range.to}T00:00:00Z`) + 2 * DAY_MS),
      ),
      ledger.firstLineAt(platform),
      ledger.cursorOf(platform),
      ledger.modelLinks(platform),
      ledger.chatterLinks(platform),
    ]);
    const report = buildCheckReport({
      platform,
      from: range.from,
      to: range.to,
      timeZone: feed.timeZone,
      generatedAt: clock.now(),
      lines,
      stats,
      exported,
      firstLineAt,
      registerReadAt: cursor.readAt,
      models: models.value,
      modelLinks: new Set(modelLinks.keys()),
      platformChatters: platformChatters.ok ? platformChatters.value : [],
      chatterLinks,
    });
    return ok({ report, modelLinks });
  }

  /**
   * One platform's automatic check (CRM-04 b3): `refused` when the platform did not answer, so the job is tried again.
   */
  async function autoCheckOne(
    platform: Platform,
    recheckOf: PayPeriod | null,
    logger: JobLogger,
    correlationId: string,
  ): Promise<'done' | 'refused'> {
    const feed = await liveFeed(platform);
    if (feed === null) return 'done';
    const from = recheckOf ?? fortnightBefore(clock.now(), feed.timeZone).from;
    const to = payPeriodLastDay(from);
    // A recheck of a fortnight not over yet cannot happen from the crontab; refused here all the same.
    if (to >= calendarDayAt(clock.now(), feed.timeZone)) return 'done';
    const accounts = (await deps.detectedAccounts(from)).filter((account) => account.platform === platform);
    if (accounts.length === 0) return 'done';
    const built = await buildReport(platform, feed, { from, to }, null);
    if (!built.ok) {
      logger.warn({ platform, from, kind: built.error.kind }, 'sales feed automatic check refused');
      return 'refused';
    }
    // Without the platform's statistics nothing was compared: not an agreement, the job is tried again (Équipe, #476).
    const statsNote = built.value.report.notes.find((note) => note.kind === 'stats_unavailable');
    if (statsNote !== undefined) {
      logger.warn({ platform, from, kind: statsNote.errorKind }, 'sales feed automatic check: no statistics');
      return 'refused';
    }
    const modelAccounts = new Map(
      [...built.value.modelLinks].map(
        ([platformModelId, link]) => [platformModelId, link.platformAccountId] as const,
      ),
    );
    const days = mismatchDays(built.value.report, modelAccounts, accounts);
    if (days.length === 0) {
      logger.info(
        { platform, from, recheck: recheckOf !== null },
        'sales feed automatic check: the nets agree',
      );
      return 'done';
    }
    if (recheckOf === null) {
      await deps.jobs.recheckLater(platform, from, new Date(clock.now().getTime() + RECHECK_AFTER_MS));
      logger.info(
        { platform, from, days: days.length },
        'sales feed automatic check: mismatch, looked at again tomorrow',
      );
      return 'done';
    }
    const published = await ledger.publishMismatch(
      { platform, from, to, days: days.slice(0, SALES_FEED_MISMATCH_DAYS_MAX) },
      correlationId,
    );
    logger.info(
      { platform, from, days: days.length, published },
      'sales feed automatic check: mismatch confirmed',
    );
    return 'done';
  }

  const team = createTeamImport({
    store: deps.team,
    clock,
    live: async (platform) => {
      const feed = await liveFeed(platform);
      return { feed, error: feed === null ? (await statusOf(platform)).lastErrorKind : null };
    },
  });

  return {
    team,
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
      unreachable.delete(platform);
      await tell(platform, { state: 'back' }, `sales_feed_key:${platform}`);
      await linkByHandle(platform, feed);
      return ok(await statusOf(platform));
    },

    async disconnect(platform, by) {
      factoryOf(platform);
      // The webhook goes first, while the key can still remove it at the platform.
      if (deps.webhooks !== null) await dropWebhook(platform, by);
      await keysOrThrow().remove(platform, by);
      return statusOf(platform);
    },

    async connectWebhook(platform, by) {
      factoryOf(platform);
      const store = webhooksOrThrow();
      const feed = await liveFeed(platform);
      if (feed === null) throw new SalesFeedNotConnected();
      const url = deps.webhookUrl(platform);
      if (url === null) throw new SalesFeedWebhookUrlUnprocessable();
      const existing = await store.find(platform);
      const created = await feed.createWebhook(url);
      // Webhooks not opened by the support (403), key refused, platform away: nothing changes here.
      if (!created.ok) return err(refusal(errorKindOf(created.failure)));
      if (existing !== null) await feed.deleteWebhook(existing.platformWebhookId);
      await store.save(platform, created.value, url, clock.now(), by);
      return ok(await statusOf(platform));
    },

    async disconnectWebhook(platform, by) {
      factoryOf(platform);
      await dropWebhook(platform, by);
      return statusOf(platform);
    },

    async receive(platform, rawBody, headers, logger) {
      const factory = factoryOf(platform);
      const stored = await deps.webhooks?.find(platform);
      if (stored == null) throw new SalesFeedWebhookNotFound();
      const now = clock.now();
      if (stored.secret === null) {
        await webhooksOrThrow().reject(platform, now);
        logger.warn(
          { platform },
          'sales feed delivery refused: no listed encryption key opens the webhook secret',
        );
        throw new SalesFeedDeliveryRefused();
      }
      const delivery = factory.readDelivery({ rawBody, headers, secret: stored.secret, now });
      if (!delivery.ok) {
        await webhooksOrThrow().reject(platform, now);
        // The reason only: never the body, which carries a fan's pseudo.
        logger.warn({ platform, reason: delivery.reason }, 'sales feed delivery refused');
        throw new SalesFeedDeliveryRefused();
      }
      const received = await webhooksOrThrow().receive(platform, delivery, now);
      if (received === 'new') await deps.jobs.readNow(`delivery:${platform}`);
      logger.info({ platform, event: delivery.event, received }, 'sales feed delivery');
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

    async importModels(platform, body, by) {
      factoryOf(platform);
      const feed = await liveFeed(platform);
      if (feed === null) throw new SalesFeedNotConnected();
      const listed = await feed.listModels();
      if (!listed.ok) throw new SalesFeedListUnavailable();
      const live = new Map(listed.value.map((model) => [model.platformModelId, model]));
      const lines: SalesFeedImportLineResult[] = [];
      // One after the other: each line is its own transaction, and a refused one leaves the others standing.
      for (const line of body.lines) {
        const model = live.get(line.platformModelId);
        lines.push(
          model === undefined
            ? { platformModelId: line.platformModelId, outcome: 'refused', reason: 'not_listed' }
            : await ledger.importModel(platform, model, line.action, by),
        );
      }
      return { lines, overview: await overview(platform) };
    },

    async dismissModel(platform, platformModelId, dismissed, by) {
      factoryOf(platform);
      if (dismissed) await ledger.dismissModel(platform, platformModelId, by);
      else await ledger.restoreModel(platform, platformModelId, by);
      return overview(platform);
    },

    async linkChatter(platform, platformChatterId, link, by) {
      factoryOf(platform);
      if (by === null) throw new SalesFeedTeamForbidden();
      // The same guarded write as the review's (ADR 0076 § 4): in the owner's own transaction (`withMember`).
      const outcomes = await deps.team.link(by, platform, [
        {
          platformChatterId,
          link: teamLinkOf(link),
          isExternal: false,
        },
      ]);
      if (outcomes === null) throw new SalesFeedTeamForbidden();
      const [outcome] = outcomes;
      if (outcome?.ok === false) {
        if (outcome.kind === 'member_unknown') throw new SalesFeedMemberUnprocessable();
        throw new SalesFeedTeamForbidden();
      }
      return overview(platform);
    },

    async check(platform, body, by) {
      const feed = await liveFeed(platform);
      if (feed === null) throw new SalesFeedNotConnected();
      if (body.to >= calendarDayAt(clock.now(), feed.timeZone)) throw new SalesFeedCheckDaysUnprocessable();
      const built = await buildReport(platform, feed, { from: body.from, to: body.to }, body.export);
      if (!built.ok) return built;
      await ledger.recordCheck(built.value.report, isCleanMatch(built.value.report), by);
      return ok(built.value.report);
    },

    async newModels() {
      const byPlatform = (await ledger.newModels()).filter((row) => row.count > 0);
      return { total: byPlatform.reduce((sum, row) => sum + row.count, 0), byPlatform: [...byPlatform] };
    },

    async lastCheck(platform) {
      factoryOf(platform);
      return { last: await ledger.lastCheck(platform) };
    },

    async autoCheck(payload, logger, correlationId) {
      if (deps.keys === null) return;
      const platforms =
        payload.recheck === undefined
          ? (await deps.keys.list()).map((stored) => stored.platform)
          : [payload.recheck.platform];
      const refused: Platform[] = [];
      for (const platform of platforms) {
        if (registry[platform] === undefined) continue;
        const outcome = await autoCheckOne(platform, payload.recheck?.from ?? null, logger, correlationId);
        if (outcome === 'refused') refused.push(platform);
      }
      if (refused.length > 0) throw new Error(`sales feed automatic check refused by ${refused.join(', ')}`);
    },

    async copyAvatar(payload, logger) {
      const { platform, platformModelId, creatorId } = payload;
      const skip = await copyAvatarOf(payload);
      // Ids only: never the address, which names her at the platform.
      if (skip === null) logger.info({ platform, platformModelId, creatorId }, 'creator photo copied');
      else logger.info({ platform, platformModelId, creatorId, skip }, 'creator photo not copied');
    },

    async read(logger, correlationId, woken) {
      if (deps.keys === null) return;
      for (const stored of await deps.keys.list()) {
        await readOne(stored, logger, correlationId, woken);
      }
    },
  };
}
