import type { PasteTrendLinkBody, PastedTrendLink } from '@impera/contracts';

import type { SignalStore, TrendActor } from '../domain/ports';
import { signalExpiresAt } from '../domain/signals';

/**
 * « Coller un lien » (ADR 0060 § 2, sources 4 and 5): the address was read by its form in the body's schema, never
 * opened. The signal lives its default lifetime from now; the same address pasted again for the same creator adds
 * nothing and says so.
 */
export async function pasteLink(
  signals: SignalStore,
  actor: TrendActor,
  body: PasteTrendLinkBody,
  now: Date,
): Promise<PastedTrendLink> {
  const expiresAt = signalExpiresAt(now);
  const created = await signals.pasteLink(actor, { ...body, observedAt: now, expiresAt });
  return { created, url: body.url, expiresAt: created ? expiresAt.toISOString() : null };
}
