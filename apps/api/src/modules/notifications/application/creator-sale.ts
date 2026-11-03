import type { NotificationOutcome, NotificationRequest } from '@nirvana/contracts';

import { creatorSaleMessage } from '../domain/creator-sale';
import type { CreatorSaleSource } from '../domain/ports';

export interface CreatorSaleDeps {
  readonly sales: CreatorSaleSource;
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
}

/**
 * `notifications.creator_sale` (CRM-04 lot d2): each of her own accounts is told of the sale once, under its quiet
 * hours and the burst rule of a sale (CR-01), in her creator's time zone. An event that is not a sale of hers (gone,
 * another type) tells nobody. What became of each account's notification, in the order of the accounts.
 */
export async function notifyCreatorSale(
  deps: CreatorSaleDeps,
  eventId: string,
  at: Date,
): Promise<readonly NotificationOutcome[]> {
  const sale = await deps.sales.saleOf(eventId);
  if (sale === null) return [];
  const message = creatorSaleMessage(sale.creatorMinor, sale.currency);
  const outcomes: NotificationOutcome[] = [];
  for (const userId of sale.accounts) {
    outcomes.push(
      await deps.notify(
        { userId, reason: 'sale', objectKey: sale.saleId, timeZone: sale.timeZone, message },
        at,
      ),
    );
  }
  return outcomes;
}
