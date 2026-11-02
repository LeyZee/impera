import { createHash } from 'node:crypto';

import type {
  Platform,
  PlatformChatter,
  PlatformChatterDailyStat,
  PlatformDailyStat,
  PlatformModel,
  PlatformSale,
  PlatformSalesPage,
  SalesFeedCapability,
  SalesFeedErrorKind,
  SalesFeedSignal,
} from '@nirvana/contracts';

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
  /** The answer does not have the shape Nirvana reads, or breaks an invariant (net ≠ agency + creator). */
  | { readonly kind: 'unexpected_answer'; readonly detail: string };

/** A value the adapter met and does not know: kept as `other` (type, status) or skipped (event), and signalled. */
export interface UnknownValue {
  readonly field: 'event' | 'type' | 'status';
  readonly value: string;
}

export type SalesFeedResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: SalesFeedFailure };

export interface SalesPageRead extends PlatformSalesPage {
  readonly unknown: readonly UnknownValue[];
}

export interface DateRange {
  /** `YYYY-MM-DD`, included, in the platform's own day. */
  readonly from: string;
  readonly to: string;
}

export interface PlatformSalesFeed {
  readonly platform: Platform;
  /** What this adapter can do at all; a key may open less (`verify`). */
  readonly capabilities: readonly SalesFeedCapability[];
  /** The calls the platform asks for before a key is trusted; the capabilities this key opens. */
  verify(): Promise<SalesFeedResult<readonly SalesFeedCapability[]>>;
  /** The register after `position` (`null`: from its start), in the register's order. */
  readSales(position: string | null): Promise<SalesFeedResult<SalesPageRead>>;
  listModels(): Promise<SalesFeedResult<readonly PlatformModel[]>>;
  listChatters(): Promise<SalesFeedResult<readonly PlatformChatter[]>>;
  dailyStats(range: DateRange): Promise<SalesFeedResult<readonly PlatformDailyStat[]>>;
  chatterDailyStats(range: DateRange): Promise<SalesFeedResult<readonly PlatformChatterDailyStat[]>>;
}

/** Builds a platform's feed from its decrypted key, and tells a paste that cannot be one of its keys. */
export interface SalesFeedFactory {
  create(key: string): PlatformSalesFeed;
  isPlausibleKey(key: string): boolean;
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

export interface SalesCursor {
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

export interface FeedAccount extends LinkedAccount {
  readonly handle: string;
}

export type ChatterLink = { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'agent' };

/**
 * The register, its cursor, the quarantine and the owner's links. A page and the cursor move in one transaction;
 * each line of a linked model is written inside its creator's tenant (RLS).
 */
export interface SalesLedger {
  cursorOf(platform: Platform): Promise<SalesCursor>;
  recordPage(
    platform: Platform,
    from: string | null,
    page: PlatformSalesPage,
    at: Date,
  ): Promise<RecordedPage>;
  /** A 429: no read before `until`. */
  pause(platform: Platform, until: Date): Promise<void>;
  quarantined(platform: Platform): Promise<ReadonlyMap<string, number>>;
  modelLinks(platform: Platform): Promise<ReadonlyMap<string, LinkedAccount>>;
  /** The platform's accounts in Nirvana, every creator's: what a model can be linked to. */
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
  unlinkModel(platform: Platform, platformModelId: string): Promise<void>;
  chatterLinks(platform: Platform): Promise<ReadonlyMap<string, ChatterLink>>;
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
}
