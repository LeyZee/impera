import { z } from 'zod';

import { refusalBodySchema } from './errors';
import { pastedSecret } from './pasted-secret';

/**
 * What the link connector reads of a redirect link (ADR 0120 § 3): where the link is placed, and hourly totals. Read
 * only, and totals only: nothing of a visitor is kept, neither an address, a city nor a device.
 */

/** Where a redirect link is placed: the place attributes a click, never the visit's origin (ADR 0120 § 3). */
export const LINK_PLACEMENTS = [
  'story_highlight',
  'story_daily',
  'telegram_channel',
  'other_network',
] as const;
export const LinkPlacementSchema = z.enum(LINK_PLACEMENTS);
export type LinkPlacement = z.infer<typeof LinkPlacementSchema>;

/** A placement that is a story of hers: the ones the red alert of ADR 0120 § 6 watches. */
export function isStoryPlacement(placement: LinkPlacement): boolean {
  return placement === 'story_highlight' || placement === 'story_daily';
}

/** How the redirect service names one of its links: opaque to us, never shown, never an address. */
export const LinkRefSchema = z.string().min(1).max(128).brand<'LinkRef'>();
export type LinkRef = z.infer<typeof LinkRefSchema>;

/** The start of an hour, UTC: `2026-11-16T13:00:00.000Z`. */
export const HourStartSchema = z.iso
  .datetime()
  .refine((text) => /T\d{2}:00:00(\.000)?Z$/u.test(text), 'Le début d’une heure, en UTC');

/** One hour of one link as the service counts it, robots included. */
export const LinkHourReadingSchema = z.object({
  hour: HourStartSchema,
  pageviews: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
});
export type LinkHourReading = z.infer<typeof LinkHourReadingSchema>;

/** One hour of one link as we keep it: robots removed by the code, their number beside (ADR 0120 § 3). */
export const LinkHourTotalSchema = LinkHourReadingSchema.extend({
  robots: z.number().int().nonnegative(),
});
export type LinkHourTotal = z.infer<typeof LinkHourTotalSchema>;

/**
 * Where the agency's key of the redirect service stands (ADR 0120 § 3). `off`: this server has no address for the
 * service, so nothing can be connected. `needs_reconnect`: a key is kept that no longer opens, to be pasted again.
 */
export const LinkServiceStateSchema = z.enum(['off', 'not_connected', 'connected', 'needs_reconnect']);
export type LinkServiceState = z.infer<typeof LinkServiceStateSchema>;

/** What the settings show of the key: whether one is kept and since when. Never the key, even masked. */
export const LinkServiceStatusSchema = z.strictObject({
  state: LinkServiceStateSchema,
  connectedAt: z.iso.datetime().nullable(),
});
export type LinkServiceStatus = z.infer<typeof LinkServiceStatusSchema>;

export const SaveLinkServiceKeyBodySchema = z.object({ key: pastedSecret(512) });
export type SaveLinkServiceKeyBody = z.infer<typeof SaveLinkServiceKeyBodySchema>;

/** Why the redirect service did not answer what was asked: the kind, and never a word of its answer. */
export const LinkServiceFailureSchema = z.enum([
  'unauthorized',
  'forbidden',
  'rate_limited',
  'unavailable',
  'unexpected',
]);
export type LinkServiceFailure = z.infer<typeof LinkServiceFailureSchema>;

/** The key was not kept (422): the service refused it, did not answer, or this server has no address for it. */
export const LINK_SERVICE_UNPROCESSABLE = 'link_service_unprocessable';
export const LinkServiceRefusalBodySchema = refusalBodySchema(
  z.enum([...LinkServiceFailureSchema.options, 'off']),
);
