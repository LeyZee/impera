import { createHash } from 'node:crypto';

import type {
  EventPayload,
  PayPeriod,
  Platform,
  PlatformChatter,
  PlatformChatterDailyStat,
  PlatformDailyStat,
  PlatformModel,
  PlatformSale,
  PlatformSalesPage,
  SalesFeedCapability,
  SalesFeedCheckReport,
  SalesFeedErrorKind,
  SalesFeedImportAction,
  SalesFeedImportLineResult,
  SalesFeedSignal,
} from '@impera/contracts';

import type { ImportableCreator } from './model-import';
import type { ModelSighting, SightingChanges } from './model-sightings';
import type { CheckLine } from './reliability-check';

/**
 * The second port of ADR 0050 § 2, apart from `PlatformConnector`: a platform's register of sales and refunds, its
 * statistics and its team, read with an agency key and no session. An adapter maps its platform's answers onto the
 * contract's types; the core never sees a platform's shape (ADR 0003).
 */

/** Why a call gave nothing. A refusal stops the reading until the key is connected again (ADR 0050 § 3). */
export type SalesFeedFailure =
  | { readonly kind: 'refused'; readonly errorKind: 'unauthorized' | 'missing_access' }
  | { readonly kind: 'rate_limited'; readonly retryAfterMs: number }
  | { readonly kind: 'unreachable' }
  /** The answer does not have the shape Impera reads, or breaks an invariant (net ≠ agency + creator). */
  | { readonly kind: 'unexpected_answer'; readonly detail: string };

/** A value the adapter met and does not know: kept as `other` (type, status) or skipped (event), and signalled. */
export interface UnknownValue {
  readonly field: 'event' | 'type' | 'status';
  readonly value: string;
}

export type SalesFeedResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: SalesFeedFailure };

interface SalesPageRead extends PlatformSalesPage {
  readonly unknown: readonly UnknownValue[];
}

export interface DateRange {
  /** `YYYY-MM-DD`, included, in the platform's own day. */
  readonly from: string;
  readonly to: string;
}

/** A model as the platform lists it, with its status as the platform wrote it (an unknown one is read `other`). */
export interface ListedModel extends PlatformModel {
  readonly rawStatus: string;
}

export interface PlatformSalesFeed {
  readonly platform: Platform;
  /** What this adapter can do at all; a key may open less (`verify`). */
  readonly capabilities: readonly SalesFeedCapability[];
  /** The zone the platform counts its statistics' days in (Reveal: `Europe/Paris`). */
  readonly timeZone: string;
  /** The calls the platform asks for before a key is trusted; the capabilities this key opens. */
  verify(): Promise<SalesFeedResult<readonly SalesFeedCapability[]>>;
  /** The register after `position` (`null`: from its start), in the register's order. */
  readSales(position: string | null): Promise<SalesFeedResult<SalesPageRead>>;
  listModels(): Promise<SalesFeedResult<readonly ListedModel[]>>;
  listChatters(): Promise<SalesFeedResult<readonly PlatformChatter[]>>;
  dailyStats(range: DateRange): Promise<SalesFeedResult<readonly PlatformDailyStat[]>>;
  chatterDailyStats(range: DateRange): Promise<SalesFeedResult<readonly PlatformChatterDailyStat[]>>;
  /** Registers Impera's address for the sales and refunds; the secret the platform signs with, given once. */
  createWebhook(url: string): Promise<SalesFeedResult<CreatedWebhook>>;
  /** Removes it at the platform; one the platform no longer knows counts as removed. */
  deleteWebhook(platformWebhookId: string): Promise<SalesFeedResult<null>>;
}

interface CreatedWebhook {
  readonly platformWebhookId: string;
  readonly secret: string;
}

/** A delivery as it reached Impera: its raw bytes, untouched, and its headers (lower-case names). */
export interface DeliveryRequest {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly secret: string;
  readonly now: Date;
}

/**
 * A delivery checked: its id (to tell a second sending of it) and its position in the register. Its content is never
 * kept: the line is read again by cursor, in the register's order (ADR 0050 § 3, the webhook only wakes the reading).
 */
export type DeliveryRead =
  | { readonly ok: true; readonly deliveryId: string; readonly event: string; readonly position: string }
  | { readonly ok: false; readonly reason: 'unsigned' | 'bad_signature' | 'stale' | 'malformed' };

/** Builds a platform's feed from its decrypted key, and tells a paste that cannot be one of its keys. */
export interface SalesFeedFactory {
  create(key: string): PlatformSalesFeed;
  isPlausibleKey(key: string): boolean;
  /** Checks a delivery's signature and time against the webhook's secret before anything of it is read. */
  readDelivery(request: DeliveryRequest): DeliveryRead;
}

/** One factory per platform that has a sales feed (Reveal's CRM API only, today). */
export type SalesFeedRegistry = Partial<Record<Platform, SalesFeedFactory>>;

/** The kind the Réglages line shows for a failure (`SalesFeedErrorKind`). */
export function errorKindOf(failure: SalesFeedFailure): SalesFeedErrorKind {
  switch (failure.kind) {
    case 'refused':
      return failure.errorKind;
    case 'rate_limited':
      return 'rate_limited';
    case 'unreachable':
      return 'unreachable';
    case 'unexpected_answer':
      return 'unexpected_answer';
  }
}

/**
 * SHA-256 of what a line says, in a fixed order: the same line read again (a webhook, an overlap) is the same line
 * only if this matches. The register's position and the status at reading are left out: neither changes the sale.
 */
export function inputsHashOf(sale: PlatformSale): string {
  const said = [
    sale.platformSaleId,
    sale.event,
    sale.type,
    sale.rawType,
    sale.occurredAt,
    sale.platformModelId,
    sale.platformChatterId,
    sale.platformFanId,
    sale.currency,
    sale.amounts.grossInclVat,
    sale.amounts.grossExclVat,
    sale.amounts.net,
    sale.amounts.agency,
    sale.amounts.creator,
  ];
  return createHash('sha256').update(JSON.stringify(said)).digest('hex');
}

/** The signals a page's unknown values make, once per field and value within the page. */
export function unknownValueSignals(unknown: readonly UnknownValue[]): SalesFeedSignal[] {
  const seen = new Set<string>();
  const signals: SalesFeedSignal[] = [];
  for (const value of unknown) {
    const key = `${value.field}:${value.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({ kind: 'unknown_value', field: value.field, value: value.value.slice(0, 100) });
  }
  return signals;
}

/** Who touches a key, for `audit_log`. */
export interface KeyActor {
  readonly userId: string | null;
  readonly ip: string | null;
}

/** A platform's saved key; `key` is `null` when no listed encryption key opens it any more. */
export interface StoredSalesFeedKey {
  readonly platform: Platform;
  readonly key: string | null;
  readonly state: 'connected' | 'needs_reconnect';
  readonly capabilities: readonly SalesFeedCapability[];
  readonly lastErrorKind: SalesFeedErrorKind | null;
  readonly verifiedAt: Date;
}

/** `sales_feed_credentials`, sealed, through the admin role only (ADR 0050 § 4). */
export interface SalesFeedKeyStore {
  find(platform: Platform): Promise<StoredSalesFeedKey | null>;
  list(): Promise<StoredSalesFeedKey[]>;
  /** Connects or replaces, with its `audit_log` line (a fingerprint, never the key). */
  save(
    platform: Platform,
    key: string,
    capabilities: readonly SalesFeedCapability[],
    at: Date,
    by: KeyActor,
  ): Promise<void>;
  /** The state and last error after a read; the previous ones, to signal a change once, or `null` without a key. */
  markState(
    platform: Platform,
    state: StoredSalesFeedKey['state'],
    lastErrorKind: SalesFeedErrorKind | null,
  ): Promise<Pick<StoredSalesFeedKey, 'state' | 'lastErrorKind'> | null>;
  remove(platform: Platform, by: KeyActor): Promise<boolean>;
}

interface SalesCursor {
  readonly position: string | null;
  readonly readAt: Date | null;
  readonly pausedUntil: Date | null;
}

/** What recording a page did. `stale`: another run moved the cursor first, nothing was written. */
export interface RecordedPage {
  readonly stale: boolean;
  readonly recorded: number;
  readonly quarantined: number;
  readonly duplicates: number;
  /** Lines already recorded that came again saying something else: the first one stays. */
  readonly changed: readonly { readonly platformSaleId: string; readonly event: PlatformSale['event'] }[];
  /** Models of the page linked to no creator account. */
  readonly unlinkedModels: readonly string[];
}

export interface LinkedAccount {
  readonly platformAccountId: string;
  readonly creatorId: string;
}

/** A link as stored: `linkedBy` null when it was posed by the handle at connection. */
interface ModelLink extends LinkedAccount {
  readonly linkedBy: string | null;
}

interface FeedAccount extends LinkedAccount {
  readonly handle: string;
  readonly creatorDisplayName: string;
}

/** A check's report as kept (`sales_feed_checks`). */
interface StoredCheck {
  readonly report: SalesFeedCheckReport;
  readonly clean: boolean;
  readonly checkedBy: string | null;
}

export type ChatterLink = { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'agent' };

/**
 * The register, its cursor, the quarantine and the owner's links. A page and the cursor move in one transaction;
 * each line of a linked model is written inside its creator's tenant (RLS).
 */
export interface SalesLedger {
  cursorOf(platform: Platform): Promise<SalesCursor>;
  /**
   * Records a page and moves the cursor, in one transaction. A sale recorded for the first time, less than
   * `SALE_RING_WINDOW_MS` after it happened, publishes `sale_detected` in that transaction (CRM-04), with
   * `correlationId`: a line read again inserts nothing, so it publishes nothing.
   */
  recordPage(
    platform: Platform,
    from: string | null,
    page: PlatformSalesPage,
    at: Date,
    correlationId: string,
  ): Promise<RecordedPage>;
  /** A 429: no read before `until`. */
  pause(platform: Platform, until: Date): Promise<void>;
  quarantined(platform: Platform): Promise<ReadonlyMap<string, number>>;
  modelLinks(platform: Platform): Promise<ReadonlyMap<string, ModelLink>>;
  /** The platform's accounts in Impera, every creator's: what a model can be linked to. */
  accounts(platform: Platform): Promise<readonly FeedAccount[]>;
  /**
   * Links a model and moves its quarantined lines to the register, in one transaction. `conflict`: the model already
   * has lines recorded for another account, or the account is linked to another model.
   */
  linkModel(
    platform: Platform,
    platformModelId: string,
    account: LinkedAccount,
    by: string | null,
  ): Promise<'linked' | 'conflict'>;
  /** Further lines of the model wait in quarantine; those recorded stay. */
  unlinkModel(platform: Platform, platformModelId: string, by: string | null): Promise<void>;
  /** Every creator, for the import's name match (CRM-07). */
  creators(): Promise<readonly ImportableCreator[]>;
  /** The models set aside from the import, with when (`sales_feed_model_dismissals`). */
  dismissals(platform: Platform): Promise<ReadonlyMap<string, Date>>;
  /** What the model list showed last of each model (CRM-07 a2), by its id. */
  sightings(platform: Platform): Promise<ReadonlyMap<string, ModelSighting>>;
  /**
   * Records one reading of the model list, in one transaction: each listed model's status and `now` as its last
   * sighting, and the marks of `changes` (a gone model never listed before gets a row of its own, so that it is
   * signalled once).
   */
  recordSightings(
    platform: Platform,
    listed: readonly ListedModel[],
    changes: SightingChanges,
    now: Date,
  ): Promise<void>;
  /**
   * The models each platform listed at its last reading that have no link and were not set aside (the badge of ADR 0069
   * § 5); platforms with none left out.
   */
  newModels(): Promise<readonly { readonly platform: Platform; readonly count: number }[]>;
  /** Sets a model aside from the import, or takes it back; each with its `audit_log` line, none when nothing changes. */
  dismissModel(platform: Platform, platformModelId: string, by: string | null): Promise<void>;
  restoreModel(platform: Platform, platformModelId: string, by: string | null): Promise<void>;
  /**
   * Imports one live model (ADR 0069 § 3), in one transaction: the creator created (or the one chosen), her account of
   * the platform (created, or hers with that handle), the link (`linkedBy` the owner), its quarantined lines released,
   * its dismissal gone, and the audit lines. A model already linked writes nothing (`already_linked`): a double click
   * or a replay creates no second creator. A refusal writes nothing either, and the other lines go on.
   */
  importModel(
    platform: Platform,
    model: PlatformModel,
    action: SalesFeedImportAction,
    by: string | null,
  ): Promise<SalesFeedImportLineResult>;
  chatterLinks(platform: Platform): Promise<ReadonlyMap<string, ChatterLink>>;
  /**
   * For the reliability check (CRM-02): the sales recorded or quarantined between `from` (included) and `to`
   * (excluded), and every refund read since `from`, whatever its sale. No fan data.
   */
  checkLines(platform: Platform, from: Date, to: Date): Promise<readonly CheckLine[]>;
  /** Keeps a check's report, never rewritten (CRM-02); `clean` by `isCleanMatch`, `by` the user who ran it. */
  recordCheck(report: SalesFeedCheckReport, clean: boolean, by: string | null): Promise<void>;
  /** The platform's latest report, by when it was made; `null` before any check. */
  lastCheck(platform: Platform): Promise<StoredCheck | null>;
  /** The register's oldest line (recorded or quarantined), `null` when it has none: how far back the reading went. */
  firstLineAt(platform: Platform): Promise<Date | null>;
  memberExists(memberId: string): Promise<boolean>;
  linkChatter(
    platform: Platform,
    platformChatterId: string,
    link: ChatterLink | null,
    by: string | null,
  ): Promise<void>;
  /**
   * Publishes a signal for the owner, with no creator. `once`: not when the same signal was already published
   * (an unknown value, an unlinked model).
   */
  signal(platform: Platform, signal: SalesFeedSignal, once: boolean, correlationId: string): Promise<boolean>;
  /**
   * Publishes `sales_feed_mismatch` (CRM-04 b3), with no creator, once per platform and fortnight: `false` when it was
   * already published (the unique index of migration 0092). Nothing goes to `sales_feed_checks`.
   */
  publishMismatch(mismatch: EventPayload<'sales_feed_mismatch'>, correlationId: string): Promise<boolean>;
}

/** The platform's webhook for Impera; `secret` is `null` when no listed encryption key opens it any more. */
export interface StoredWebhook {
  readonly platform: Platform;
  readonly platformWebhookId: string;
  readonly secret: string | null;
  readonly createdAt: Date;
  readonly lastDeliveryAt: Date | null;
  readonly lastRejectedAt: Date | null;
}

/** `sales_feed_webhooks` and its inbox `sales_feed_deliveries`, through the admin role only. */
export interface SalesFeedWebhookStore {
  find(platform: Platform): Promise<StoredWebhook | null>;
  /** Saves the webhook, its secret sealed, with its `audit_log` line. */
  save(platform: Platform, created: CreatedWebhook, url: string, at: Date, by: KeyActor): Promise<void>;
  /** The webhook removed, `null` when there was none, with its `audit_log` line. */
  remove(platform: Platform, by: KeyActor): Promise<StoredWebhook | null>;
  /** Puts a checked delivery in the inbox: `duplicate` when its id came already (a delivery may come twice). */
  receive(
    platform: Platform,
    delivery: { readonly deliveryId: string; readonly event: string; readonly position: string },
    at: Date,
  ): Promise<'new' | 'duplicate'>;
  /** A delivery refused: its hour only, for the Réglages line. */
  reject(platform: Platform, at: Date): Promise<void>;
  /** Forgets the deliveries received before `before`: the cursor, not the inbox, says what was read. */
  prune(before: Date): Promise<number>;
}

/** Wakes the reading of the register now, beside its minute (`connector.read_sales`). */
export interface SalesFeedJobs {
  readNow(correlationId: string): Promise<void>;
  /**
   * The automatic check's second look (CRM-04 b3): `connector.check_sales` for the platform and fortnight at `runAt`.
   * One waiting job per platform and fortnight (`job_key`): a run replayed enqueues it once.
   */
  recheckLater(platform: Platform, from: PayPeriod, runAt: Date): Promise<void>;
}
