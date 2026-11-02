import { BillingRegimeIdSchema, type CreateBillingRegimeBody } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { assertRegimeOfCountry, dayStartsAt, sameRegime } from '../regimes';

/** An invented regime (ADR 0010): its words are the test's, never an accountant's. */
const BENIN: CreateBillingRegimeBody = {
  id: BillingRegimeIdSchema.parse('0195f4a0-0000-7000-8000-000000000001'),
  name: 'Bénin et Madagascar',
  countries: ['BJ', 'MG'],
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: true,
};

describe('Équipe › Régimes de facturation : écrire, attribuer, entrer en vigueur (EQ-06 lot 5b)', () => {
  it('knows the regime recorded under its id, word for word', () => {
    expect(sameRegime(BENIN, { ...BENIN, countries: ['BJ', 'MG'] })).toBe(true);
    expect(sameRegime(BENIN, { ...BENIN, name: 'Bénin' })).toBe(false);
    expect(sameRegime(BENIN, { ...BENIN, countries: ['MG', 'BJ'] })).toBe(false);
    expect(sameRegime(BENIN, { ...BENIN, vat: { treatment: 'reverse_charge', rateBps: 1_800 } })).toBe(false);
    expect(sameRegime(BENIN, { ...BENIN, mentions: ['Autofacturation'] })).toBe(false);
    expect(sameRegime(BENIN, { ...BENIN, taxIdRequired: false })).toBe(false);
  });

  it('gives a contractor a regime of his own country only', () => {
    expect(() => {
      assertRegimeOfCountry(BENIN.countries, 'MG');
    }).not.toThrow();
    expect(() => {
      assertRegimeOfCountry(BENIN.countries, 'FR');
    }).toThrow(expect.objectContaining({ code: 'billing_regime_country_unprocessable' }));
  });

  it('starts a day at its first minute in the agency’s zone, summer, winter and the change of time', () => {
    expect(dayStartsAt('2026-11-16', 'Europe/Paris').toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(dayStartsAt('2026-07-16', 'Europe/Paris').toISOString()).toBe('2026-07-15T22:00:00.000Z');
    // The last Sunday of March: the night before is still in winter time.
    expect(dayStartsAt('2026-03-29', 'Europe/Paris').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(dayStartsAt('2026-10-25', 'Europe/Paris').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(dayStartsAt('2026-11-16', 'UTC').toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(dayStartsAt('2026-11-16', 'Africa/Porto-Novo').toISOString()).toBe('2026-11-15T23:00:00.000Z');
  });

  it('starts a day in the farthest zones too, fourteen hours ahead and eleven behind', () => {
    expect(dayStartsAt('2026-11-16', 'Pacific/Kiritimati').toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(dayStartsAt('2026-11-16', 'Pacific/Pago_Pago').toISOString()).toBe('2026-11-16T11:00:00.000Z');
    expect(dayStartsAt('2026-11-16', 'Asia/Kolkata').toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });
});
