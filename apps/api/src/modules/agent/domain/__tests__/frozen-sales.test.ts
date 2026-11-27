import { describe, expect, it } from 'vitest';

import { checkDeferredSale, salesHeld } from '../frozen-sales';

// Fan and messages made up (ADR 0010).
const blocked = (bubbles: string[], fan?: string) =>
  checkDeferredSale(bubbles, fan).some((v) => v.code === 'deferred_sale' && v.severity === 'blocking');

describe('salesHeld (eval pass of 27/11)', () => {
  it('holds a freeze set by a person or by the care mode, never his own money trouble', () => {
    const since = '2026-10-10T10:00:00.000Z';
    expect(salesHeld({ salesFrozen: { reason: 'operator', since } })).toBe(true);
    expect(salesHeld({ salesFrozen: { reason: 'distress', since } })).toBe(true);
    expect(salesHeld({ salesFrozen: { reason: 'money_trouble', since } })).toBe(false);
    expect(salesHeld({})).toBe(false);
    expect(salesHeld(undefined)).toBe(false);
  });
});

describe('checkDeferredSale: no sale promised for later while his sales are frozen', () => {
  it.each([
    'tu vas devoir patienter un peu avant que je te montre ça',
    'plus tard je t’envoie une vidéo',
    'bientôt tu verras',
    'later i’ll show you',
    'te lo muestro mañana',
    'domani ti mando una foto',
  ])('refuses « %s »', (text) => {
    expect(blocked(['oui j’en ai', text])).toBe(true);
  });

  it('reads « patiente » alone as a promise only when he just asked for her content', () => {
    const wait = ['j’en ai, et pas qu’un peu', 'mais tu vas devoir patienter encore un peu'];
    expect(blocked(wait, 'Allez montre moi une vidéo, je paie')).toBe(true);
    expect(blocked(wait, 'je rentre du boulot')).toBe(false);
  });

  it('reads « what would you like to see » as a sale opened when he just asked for her content', () => {
    expect(blocked(['dis moi ce que t’as envie de voir'], 'Allez montre moi une vidéo, je paie')).toBe(true);
    expect(blocked(['dis moi ce que t’as envie de voir'], 'je visite Lyon ce week-end')).toBe(false);
  });

  it.each([
    'j’aime bien quand t’es direct comme ça',
    'demain je bosse tôt',
    'à plus tard alors',
    'see you later',
    'j’ai pris une photo du coucher de soleil',
    'attends je reviens',
  ])('lets « %s » through', (text) => {
    expect(blocked([text], 'Allez montre moi une vidéo')).toBe(false);
  });

  it('reads a promise within one sentence, never across two', () => {
    expect(blocked(['je te montre mon chat. on se reparle demain'])).toBe(false);
  });
});
