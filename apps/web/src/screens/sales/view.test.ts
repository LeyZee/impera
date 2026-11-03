import { MessageIdSchema, type CreatorMessage } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { amountOf, fanName, seenOf, threadOf, unlockedOf } from './view';

/* Invented fans and messages (ADR 0010). Paris is UTC+1 after 25/10: 12:00Z is 13 h. */
const NOW = new Date('2026-11-03T12:00:00Z');
const ZONE = 'Europe/Paris';

/** Text as the screen writes it, a number and its unit held together. */
const nb = (text: string): string =>
  text.replace(/(\d) (h|min|€|\$)/gu, '$1\u00a0$2').replace(/h (\d)/gu, 'h\u00a0$1');

/** `m1` → a message id of its own. */
const idOf = (name: string): CreatorMessage['id'] =>
  MessageIdSchema.parse(`0192f3a0-0000-7000-8000-0000000000${name.slice(1).padStart(2, '0')}`);

const message = (name: string, at: string, over: Partial<CreatorMessage> = {}): CreatorMessage => ({
  id: idOf(name),
  direction: 'inbound',
  text: `message ${name}`,
  media: [],
  priceMinor: null,
  currency: null,
  isPaid: false,
  platformCreatedAt: at,
  ...over,
});

describe('her Ventes in words (CR-02 c3)', () => {
  it('says what a fan unlocked per currency, the cents only when there are some', () => {
    expect(amountOf(6400, 'EUR')).toBe(nb('64 €'));
    expect(amountOf(4990, 'EUR')).toBe(nb('49,90 €'));
    expect(unlockedOf({ eurMinor: 6400, usdMinor: 1200 })).toBe(nb('64 € et 12 $'));
    expect(unlockedOf({ eurMinor: 0, usdMinor: 1250 })).toBe(nb('12,50 $'));
    expect(unlockedOf({ eurMinor: 0, usdMinor: 0 })).toBeNull();
  });

  it('names a fan without a pseudo', () => {
    expect(fanName('  ')).toBe('Fan sans nom');
    expect(fanName('loup_bleu')).toBe('loup_bleu');
  });

  it('says when he was last seen, in her time', () => {
    expect(seenOf('2026-11-03T11:59:40Z', NOW, ZONE)).toBe('vu à l’instant');
    expect(seenOf('2026-11-03T11:48:00Z', NOW, ZONE)).toBe(nb('vu il y a 12 min'));
    expect(seenOf('2026-11-03T09:00:00Z', NOW, ZONE)).toBe(nb('vu il y a 3 h'));
    expect(seenOf('2026-11-02T20:00:00Z', NOW, ZONE)).toBe('vu hier');
    expect(seenOf('2026-10-30T20:00:00Z', NOW, ZONE)).toBe('vu vendredi 30 octobre');
  });

  it('reads the thread oldest first, by day, with no author and each message once', () => {
    const newest = [
      message('m3', '2026-11-03T10:04:00Z', {
        direction: 'outbound',
        text: '',
        media: [{ kind: 'image', isLocked: true, description: 'Tenue rouge' }],
        priceMinor: 1500,
        currency: 'EUR',
        isPaid: true,
      }),
      message('m2', '2026-11-02T21:00:00Z', { direction: 'outbound', text: 'coucou toi' }),
    ];
    const older = [
      message('m2', '2026-11-02T21:00:00Z', { direction: 'outbound', text: 'coucou toi' }),
      message('m1', '2026-11-02T20:59:00Z'),
    ];
    const days = threadOf([newest, older], NOW, ZONE);
    expect(days.map((day) => day.label)).toEqual(['Hier', 'Aujourd’hui']);
    expect(days[0]?.bubbles.map((bubble) => [bubble.id, bubble.from])).toEqual([
      [idOf('m1'), 'fan'],
      [idOf('m2'), 'creator'],
    ]);
    const paid = days[1]?.bubbles[0];
    expect(paid?.media).toEqual([{ label: 'Photo', description: 'Tenue rouge' }]);
    expect(paid?.paid).toBe(nb('Média payant · 15 € · débloqué'));
    expect(paid?.time).toBe(nb('11 h 04'));
    expect(Object.keys(paid ?? {})).not.toContain('author');
  });

  it('says a paid message not unlocked yet', () => {
    const days = threadOf(
      [[message('m1', '2026-11-03T08:00:00Z', { direction: 'outbound', priceMinor: 2000, currency: 'USD' })]],
      NOW,
      ZONE,
    );
    expect(days[0]?.bubbles[0]?.paid).toBe(nb('Média payant · 20 $ · pas encore débloqué'));
  });
});
