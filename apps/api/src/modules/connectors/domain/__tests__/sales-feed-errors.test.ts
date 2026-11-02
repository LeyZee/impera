import { SALES_FEED_ERROR_CODES } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  SalesFeedAccountUnprocessable,
  SalesFeedDeliveryRefused,
  SalesFeedMemberUnprocessable,
  SalesFeedModelConflict,
  SalesFeedNotConnected,
  SalesFeedNotFound,
  SalesFeedVaultMissing,
  SalesFeedWebhookNotFound,
  SalesFeedWebhookUrlUnprocessable,
} from '../errors';

/** The screen reads the refusal by its code: each one the routes throw is in the shared catalogue, and only those. */
describe('sales feed refusals', () => {
  it('have their code in SALES_FEED_ERROR_CODES', () => {
    const thrown = [
      new SalesFeedNotFound(),
      new SalesFeedVaultMissing(),
      new SalesFeedAccountUnprocessable(),
      new SalesFeedModelConflict(),
      new SalesFeedMemberUnprocessable(),
      new SalesFeedNotConnected(),
      new SalesFeedWebhookUrlUnprocessable(),
      new SalesFeedDeliveryRefused(),
      new SalesFeedWebhookNotFound(),
    ].map((error) => error.code);
    expect([...thrown].sort()).toEqual([...SALES_FEED_ERROR_CODES].sort());
  });
});
