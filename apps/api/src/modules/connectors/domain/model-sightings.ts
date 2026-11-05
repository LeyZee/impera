import type { PlatformModelStatus, SalesFeedSignal } from '@impera/contracts';

import type { ListedModel } from './sales-feed';

/** What the model list showed last of one model (`sales_feed_model_sightings`, CRM-07 a2). */
export interface ModelSighting {
  readonly platformModelId: string;
  readonly status: PlatformModelStatus;
  readonly goneSignalledAt: Date | null;
  readonly bannedSignalledAt: Date | null;
}

/** What one reading of the list changes in the sightings, and the signals it raises. */
export interface SightingChanges {
  /** Linked models gone from the list, not signalled yet: signalled now, marked. */
  readonly gone: readonly string[];
  /** Linked models listed `banned`, not signalled yet: signalled now, marked. */
  readonly banned: readonly string[];
  /** Models listed again after a `gone` signal: the mark is cleared, a later departure is signalled again. */
  readonly back: readonly string[];
  /** Models no longer `banned` after a signal: the mark is cleared. */
  readonly unbanned: readonly string[];
  readonly signals: readonly SalesFeedSignal[];
}

/**
 * What a reading of the platform's model list changes (ADR 0069 § 5): a linked model gone from it or `banned` raises one
 * signal, until she comes back; nothing is ever deleted. An empty list says nothing of who left (a key that sees no
 * model, a platform answering half): no model counts as gone then. A status the adapter did not know is signalled once
 * with the platform's own word (ADR 0050 § 3).
 */
export function sightingChanges(
  previous: ReadonlyMap<string, ModelSighting>,
  listed: readonly ListedModel[],
  linked: ReadonlySet<string>,
): SightingChanges {
  const listedIds = new Set(listed.map((model) => model.platformModelId));
  const gone =
    listed.length === 0
      ? []
      : [...linked].filter((id) => !listedIds.has(id) && previous.get(id)?.goneSignalledAt == null).sort();
  const banned = listed
    .filter(
      (model) =>
        model.status === 'banned' &&
        linked.has(model.platformModelId) &&
        previous.get(model.platformModelId)?.bannedSignalledAt == null,
    )
    .map((model) => model.platformModelId);
  const back = listed
    .filter((model) => previous.get(model.platformModelId)?.goneSignalledAt != null)
    .map((model) => model.platformModelId);
  const unbanned = listed
    .filter(
      (model) => model.status !== 'banned' && previous.get(model.platformModelId)?.bannedSignalledAt != null,
    )
    .map((model) => model.platformModelId);
  const signals: SalesFeedSignal[] = [
    ...gone.map((platformModelId): SalesFeedSignal => ({ kind: 'model_gone', platformModelId })),
    ...banned.map((platformModelId): SalesFeedSignal => ({ kind: 'model_banned', platformModelId })),
  ];
  return { gone, banned, back, unbanned, signals };
}
