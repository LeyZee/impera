import { describe, expect, it } from 'vitest';

import {
  FREE_SEXTING_CHANCE,
  FREE_SEXTING_LAPSE_MS,
  FREE_SEXTING_MIN_SCRIPTS_BOUGHT,
  freeSextingDue,
  freeSextingStanding,
  freeSextingTurn,
  type FreeSextingInput,
} from '../free-sexting';

const NOW = new Date('2026-11-26T21:00:00Z');
const DAY = 24 * 60 * 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const lucky = () => 0;
const unlucky = () => 0.99;

const NEW_SESSION: FreeSextingInput = {
  record: null,
  sessionAt: NOW,
  scriptsBought: FREE_SEXTING_MIN_SCRIPTS_BOUGHT,
  lastSpentAt: ago(DAY),
  now: NOW,
  asksForMedia: false,
  allowed: true,
  random: lucky,
};

describe('the sexting without a sale (Charles 26/11)', () => {
  it('draws a new hot session without a sale, about one in four or five', () => {
    expect(FREE_SEXTING_CHANCE).toBeGreaterThan(1 / 5);
    expect(FREE_SEXTING_CHANCE).toBeLessThan(1 / 4);
    expect(freeSextingTurn(NEW_SESSION)).toEqual({
      noSale: true,
      backToSale: false,
      standing: 'eligible',
      record: { sessionAt: NOW, noSale: true, noSaleSessions: [NOW] },
    });
    expect(freeSextingTurn({ ...NEW_SESSION, random: unlucky })).toMatchObject({
      noSale: false,
      record: { sessionAt: NOW, noSale: false, noSaleSessions: [] },
    });
  });

  it('only for a faithful fan: two scripts bought, or a good payer, a very good one or a whale', () => {
    const one = { ...NEW_SESSION, scriptsBought: FREE_SEXTING_MIN_SCRIPTS_BOUGHT - 1 };
    expect(freeSextingTurn(one)).toMatchObject({ noSale: false, standing: 'not_faithful' });
    expect(freeSextingTurn({ ...one, fanTier: 'whale' }).noSale).toBe(true);
    expect(freeSextingTurn({ ...one, fanTier: 'good' }).noSale).toBe(true);
    expect(freeSextingTurn({ ...one, fanTier: 'payer' }).noSale).toBe(false);
  });

  it('never when he asks for a media, nor when nothing sexual is allowed, nor without a hot session', () => {
    expect(freeSextingTurn({ ...NEW_SESSION, asksForMedia: true }).noSale).toBe(false);
    expect(freeSextingTurn({ ...NEW_SESSION, allowed: false }).noSale).toBe(false);
    expect(freeSextingTurn({ ...NEW_SESSION, sessionAt: null })).toMatchObject({
      noSale: false,
      record: null,
    });
  });

  it('never two sessions in a row', () => {
    const last = { sessionAt: ago(DAY), noSale: true, noSaleSessions: [ago(DAY)] };
    expect(freeSextingDue({ ...NEW_SESSION, record: last })).toBe(false);
    expect(freeSextingTurn({ ...NEW_SESSION, record: last })).toMatchObject({
      noSale: false,
      record: { sessionAt: NOW, noSale: false, noSaleSessions: [ago(DAY)] },
    });
  });

  it('keeps the session’s draw for each of his messages in it', () => {
    const drawn = { sessionAt: NOW, noSale: true, noSaleSessions: [NOW] };
    expect(freeSextingTurn({ ...NEW_SESSION, record: drawn, random: unlucky }).noSale).toBe(true);
    const sold = { sessionAt: NOW, noSale: false, noSaleSessions: [] };
    expect(freeSextingTurn({ ...NEW_SESSION, record: sold }).noSale).toBe(false);
  });

  it('goes back to a sale when he asks for a media, and the session leaves the count', () => {
    const drawn = { sessionAt: NOW, noSale: true, noSaleSessions: [ago(40 * DAY), NOW] };
    expect(freeSextingTurn({ ...NEW_SESSION, record: drawn, asksForMedia: true })).toEqual({
      noSale: false,
      backToSale: true,
      standing: 'eligible',
      record: { sessionAt: NOW, noSale: false, noSaleSessions: [ago(40 * DAY)] },
    });
  });

  it('stops when he stops buying: waits after two sessions unpaid, lost past the span', () => {
    const two = { sessionAt: ago(3 * DAY), noSale: false, noSaleSessions: [ago(10 * DAY), ago(5 * DAY)] };
    const facts = { scriptsBought: 3, record: two, now: NOW };
    expect(freeSextingStanding({ ...facts, lastSpentAt: ago(20 * DAY) })).toBe('awaiting_purchase');
    expect(freeSextingStanding({ ...facts, lastSpentAt: null })).toBe('awaiting_purchase');
    // He bought again since the first of them: eligible.
    expect(freeSextingStanding({ ...facts, lastSpentAt: ago(7 * DAY) })).toBe('eligible');
    const old = {
      ...two,
      noSaleSessions: [ago(FREE_SEXTING_LAPSE_MS + 9 * DAY), ago(FREE_SEXTING_LAPSE_MS)],
    };
    expect(freeSextingStanding({ ...facts, record: old, lastSpentAt: null })).toBe('lapsed');
    expect(freeSextingTurn({ ...NEW_SESSION, record: old, lastSpentAt: null }).noSale).toBe(false);
  });
});
