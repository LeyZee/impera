import type { Platform } from '@impera/contracts';

import { SalesFeedRefused } from './api';

import { showError, type ShownError } from '@/settings/services/api';

/** A failed action, said under its block. */
export type Notice = ShownError & { tone: 'error' };

const NAMES: Record<Platform, string> = {
  reveal: 'Reveal',
  onlyfans: 'OnlyFans',
  instagram: 'Instagram',
  impera: 'Impera',
};
export const platformName = (platform: Platform): string => NAMES[platform];

const sentence = (text: string): string => (/[.!?…]$/u.test(text) ? text : `${text}.`);

/**
 * The French sentence for a failed call: the server's own words for a refusal it worded (`sales_feed_*`), the
 * Services page's sentence for everything else. `lead` says what did not happen, before the reason.
 */
export function shownOf(error: unknown, lead?: string): ShownError {
  if (!(error instanceof SalesFeedRefused)) return showError(error, lead);
  const reason = sentence(error.message);
  return { message: lead === undefined ? reason : `${lead} ${reason}`, isSessionExpired: false };
}
