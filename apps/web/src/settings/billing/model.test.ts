import type { BillingSettings } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  bodyOf,
  capitalText,
  closeChoiceText,
  draftOf,
  footText,
  formLine,
  isReady,
  isSiren,
  logoLine,
  logoWarning,
  parseEuros,
  problemsOf,
  suggestedVat,
  vatOfSiren,
  weightText,
  wrongSteps,
  type BillingDraft,
} from './model';

/* An invented agency (ADR 0010): 123 456 782 carries a right Luhn key, and FR11 is its VAT key. */
const SETTINGS: BillingSettings = {
  agency: {
    legalName: 'Atelier Lumen',
    address: '12 rue des Exemples\n69002 Lyon',
    siren: '123456782',
    vatNumber: 'FR11123456782',
    legalForm: 'SAS',
    shareCapitalMinor: 1_000_000,
    rcsCity: 'Lyon',
  },
  paymentTerms: 'Pas d’escompte pour paiement anticipé.',
  dueDays: 45,
  documentReminderDays: 30,
  fiscalYearEndMonth: 6,
  serviceDescription: 'Prestations de messagerie pour le compte de l’agence.',
  logoSha256: 'a'.repeat(64),
  accounts: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const filled = (patch: Partial<BillingDraft> = {}): BillingDraft => ({ ...draftOf(SETTINGS), ...patch });

describe('Réglages › Facturation : le formulaire', () => {
  it('starts empty with 60 days and a December close, or from the settings saved', () => {
    expect(draftOf(null)).toMatchObject({
      legalName: '',
      dueDays: '60',
      fiscalYearEndMonth: '12',
      logoSha256: null,
    });
    expect(draftOf(SETTINGS)).toMatchObject({
      shareCapital: '10000',
      dueDays: '45',
      fiscalYearEndMonth: '6',
      logoSha256: 'a'.repeat(64),
    });
    expect(
      draftOf({ ...SETTINGS, agency: { ...SETTINGS.agency, shareCapitalMinor: 100_050 } }).shareCapital,
    ).toBe('1000,50');
  });

  it('reads an amount in euros as the owner types it, never zero', () => {
    expect(parseEuros('10 000')).toBe(1_000_000);
    expect(parseEuros('1\u202f000,5 €')).toBe(100_050);
    expect(parseEuros('1000.25')).toBe(100_025);
    expect(parseEuros('0')).toBeNull();
    expect(parseEuros('10,123')).toBeNull();
    expect(parseEuros('dix mille')).toBeNull();
  });

  it('tells a SIREN by its key, La Poste’s included, and gives its VAT number', () => {
    expect(isSiren('123 456 782')).toBe(true);
    expect(isSiren('123456789')).toBe(false);
    expect(isSiren('12345678')).toBe(false);
    // La Poste's SIREN carries its key like any other.
    expect(isSiren('356000000')).toBe(true);
    expect(vatOfSiren('123 456 782')).toBe('FR11123456782');
    // Offered while the field holds another number or none, a foreign one included: a SIREN has its French number.
    expect(suggestedVat(filled({ vatNumber: '' }))).toBe('FR11123456782');
    expect(suggestedVat(filled({ vatNumber: 'FR12123456782' }))).toBe('FR11123456782');
    expect(suggestedVat(filled({ vatNumber: 'BE0123456789' }))).toBe('FR11123456782');
    expect(suggestedVat(filled({ vatNumber: 'fr 11 123 456 782' }))).toBeNull();
    expect(suggestedVat(filled({ siren: '123456789', vatNumber: '' }))).toBeNull();
  });

  it('says each wrong field of a step, in French', () => {
    const empty = draftOf(null);
    expect(Object.keys(problemsOf(empty, ['legalName', 'legalForm', 'shareCapital', 'address']))).toEqual([
      'legalName',
      'legalForm',
      'shareCapital',
      'address',
    ]);
    expect(problemsOf(filled({ siren: '123456789' }), ['siren']).siren).toMatch(/SIREN/u);
    expect(problemsOf(filled({ vatNumber: 'FR12123456782' }), ['vatNumber']).vatNumber).toBe(
      'Le numéro de TVA de ce SIREN est FR11123456782 : vérifie l’un ou l’autre.',
    );
    // A company with a SIREN has its French number and no other, as the server checks (#344).
    expect(problemsOf(filled({ vatNumber: 'BE0123456789' }), ['vatNumber']).vatNumber).toMatch(
      /FR11123456782/u,
    );
    expect(problemsOf(filled({ vatNumber: '11123456782' }), ['vatNumber']).vatNumber).toMatch(
      /^FR, deux chiffres/u,
    );
    expect(problemsOf(filled({ dueDays: '30' }), ['dueDays']).dueDays).toBe(
      'Un nombre entier de jours, de 45 à 60.',
    );
    expect(problemsOf(filled({ dueDays: '50,5' }), ['dueDays']).dueDays).toBeDefined();
    expect(problemsOf(filled(), ['legalName', 'siren', 'vatNumber', 'dueDays'])).toEqual({});
  });

  it('lists the steps a saved setting would be refused on: a copy made before the foot was asked', () => {
    expect(wrongSteps(filled())).toEqual([]);
    expect(wrongSteps(draftOf(null))).toEqual(['agency', 'registration', 'service', 'payment']);
    const old = draftOf({ ...SETTINGS, agency: { ...SETTINGS.agency, legalForm: null, rcsCity: null } });
    expect(wrongSteps(old)).toEqual(['agency', 'registration']);
  });

  it('sends the whole settings, trimmed and read, the logo by its fingerprint or none', () => {
    expect(
      bodyOf(
        filled({
          legalName: '  Atelier Lumen ',
          siren: '123 456 782',
          vatNumber: 'fr 11 123 456 782',
          shareCapital: '10 000',
          logoSha256: null,
        }),
      ),
    ).toEqual({
      agency: {
        legalName: 'Atelier Lumen',
        address: '12 rue des Exemples\n69002 Lyon',
        siren: '123456782',
        vatNumber: 'FR11123456782',
        legalForm: 'SAS',
        shareCapitalMinor: 1_000_000,
        rcsCity: 'Lyon',
      },
      serviceDescription: 'Prestations de messagerie pour le compte de l’agence.',
      paymentTerms: 'Pas d’escompte pour paiement anticipé.',
      dueDays: 45,
      fiscalYearEndMonth: 6,
      logoSha256: null,
    });
    expect(bodyOf(filled({ siren: '123456789' }))).toBeNull();
    expect(bodyOf(draftOf(null))).toBeNull();
  });
});

describe('Réglages › Facturation : ce que la page dit', () => {
  it('prints the foot as the invoice does: form, capital, register', () => {
    expect(capitalText(1_000_000)).toBe('10\u202f000\u00a0€');
    expect(capitalText(100_050)).toBe('1\u202f000,50\u00a0€');
    expect(formLine(SETTINGS.agency)).toBe('SAS au capital de 10\u202f000\u00a0€');
    expect(formLine({ ...SETTINGS.agency, legalForm: null })).toBeNull();
    expect(footText(SETTINGS.agency)).toBe(
      'Document établi par Atelier Lumen, 12 rue des Exemples, 69002 Lyon · SAS au capital de 10\u202f000\u00a0€ · ' +
        'RCS\u00a0Lyon\u00a0123\u00a0456\u00a0782, mandataire de facturation du prestataire.',
    );
  });

  it('names the close of the fiscal year, February’s last day included', () => {
    expect(closeChoiceText(12)).toBe('31 décembre');
    expect(closeChoiceText(6)).toBe('30 juin');
    expect(closeChoiceText(2)).toBe('Fin février');
    expect(closeChoiceText(9)).toBe('30 septembre');
  });

  it('says a logo’s size and weight, and warns a short one without refusing it', () => {
    const logo = {
      sha256: 'a'.repeat(64),
      mediaType: 'image/png' as const,
      width: 1_843,
      height: 522,
      byteLength: 443_392,
    };
    expect(logoLine(logo)).toBe('1\u202f843 × 522 px · 433\u00a0Ko');
    expect(logoWarning(logo)).toBeNull();
    expect(logoWarning({ ...logo, height: 120 })).toMatch(/flou/u);
    expect(weightText(512 * 1024)).toBe('512\u00a0Ko');
    expect(weightText(1_258_291)).toBe('1,2\u00a0Mo');
  });

  it('lets no invoice leave without the designation of the service', () => {
    expect(isReady(null)).toBe(false);
    expect(isReady({ ...SETTINGS, serviceDescription: null })).toBe(false);
    expect(isReady(SETTINGS)).toBe(true);
  });
});
