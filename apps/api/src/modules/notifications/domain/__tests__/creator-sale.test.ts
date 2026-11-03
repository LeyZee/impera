import type { NotificationRequest } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { notifyCreatorSale } from '../../application/creator-sale';
import { creatorSaleMessage } from '../creator-sale';
import type { CreatorSale } from '../ports';

const AT = new Date('2026-11-03T12:00:00Z');

describe('creatorSaleMessage (CRM-04 lot d2)', () => {
  it('says her part with its cents and its currency, opens her Ventes screen, and carries no tag', () => {
    expect(creatorSaleMessage(1240, 'EUR')).toEqual({
      title: 'Nouvelle vente',
      body: '12,40 € pour toi',
      url: '/ventes',
    });
    expect(creatorSaleMessage(500, 'USD').body).toBe('5,00 $US pour toi');
  });
});

describe('notifyCreatorSale (CRM-04 lot d2)', () => {
  const sale: CreatorSale = {
    saleId: 'sale-1',
    creatorMinor: 1240,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
    accounts: ['user-a', 'user-b'],
  };

  function run(found: CreatorSale | null) {
    const asked: NotificationRequest[] = [];
    const outcomes = notifyCreatorSale(
      {
        sales: { saleOf: (eventId) => Promise.resolve(eventId === 'event-1' ? found : null) },
        notify: (request) => {
          asked.push(request);
          return Promise.resolve('rang');
        },
      },
      'event-1',
      AT,
    );
    return { asked, outcomes };
  }

  it('tells each of her accounts once, as a sale keyed by its line, in her creator’s zone', async () => {
    const { asked, outcomes } = run(sale);
    expect(await outcomes).toEqual(['rang', 'rang']);
    expect(asked).toEqual(
      ['user-a', 'user-b'].map((userId) => ({
        userId,
        reason: 'sale',
        objectKey: 'sale-1',
        timeZone: 'Europe/Paris',
        message: creatorSaleMessage(1240, 'EUR'),
      })),
    );
  });

  it('tells nobody when the event is no sale of hers, or she has no account yet', async () => {
    const gone = run(null);
    expect(await gone.outcomes).toEqual([]);
    expect(gone.asked).toEqual([]);
    const alone = run({ ...sale, accounts: [] });
    expect(await alone.outcomes).toEqual([]);
    expect(alone.asked).toEqual([]);
  });
});
