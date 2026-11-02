import { describe, expect, it } from 'vitest';

import { accountOf, accountsBodyOf, accountsDraftOf, givenCount } from './accounts';
import {
  EMPTY_REGIME,
  rateBpsOf,
  regimeBodyOf,
  showsResidenceWithoutTreaty,
  textBodyOf,
  textDraftOf,
  vatText,
  withDocument,
  withWithholding,
} from './regimes';

import { MANDATE_V1 } from '@/test/contractors';

const KEY = '0199f2a0-0000-7000-8000-000000000999';

describe('Réglages › Facturation : régimes, textes et comptes', () => {
  it('reads a rate in percent, and says it back with its unit unbroken', () => {
    expect(rateBpsOf('20')).toBe(2000);
    expect(rateBpsOf('5,5')).toBe(550);
    expect(rateBpsOf('0')).toBe(0);
    expect(rateBpsOf('100')).toBe(10_000);
    expect(rateBpsOf('101')).toBeNull();
    expect(rateBpsOf('vingt')).toBeNull();
    expect(vatText({ treatment: 'charged', rateBps: 550 })).toBe('Facturée par le prestataire, 5,5 %');
    expect(vatText({ treatment: 'exempt' })).toBe('Franchise en base : pas de TVA facturée');
  });

  it('keeps the certificate a treaty asks for, and says the one asked without a treaty', () => {
    const treaty = withWithholding(EMPTY_REGIME, 'treaty_exempt');
    expect(treaty.documents).toEqual(['tax_residence']);
    expect(withDocument(treaty, 'tax_residence', false).documents).toEqual(['tax_residence']);
    expect(withDocument(treaty, 'urssaf_vigilance', true).documents).toEqual([
      'tax_residence',
      'urssaf_vigilance',
    ]);
    expect(showsResidenceWithoutTreaty(treaty)).toBe(false);
    const without = withWithholding(treaty, 'none');
    expect(without.documents).toEqual(['tax_residence']);
    expect(showsResidenceWithoutTreaty(without)).toBe(true);
    expect(withDocument(without, 'tax_residence', false).documents).toEqual([]);
  });

  it('sends a regime with its key, its empty mentions left out, or says what is wrong', () => {
    const draft = {
      ...EMPTY_REGIME,
      name: ' Micro France ',
      countries: ['FR'],
      vat: 'exempt' as const,
      mentions: ['TVA non applicable, art. 293 B du CGI', ' '],
    };
    expect(regimeBodyOf(draft, KEY)).toEqual({
      ok: true,
      body: {
        id: KEY,
        name: 'Micro France',
        countries: ['FR'],
        vat: { treatment: 'exempt' },
        withholding: 'none',
        mentions: ['TVA non applicable, art. 293 B du CGI'],
        documents: [],
        taxIdRequired: false,
      },
    });
    expect(regimeBodyOf({ ...draft, vat: 'charged', rate: '' }, KEY)).toEqual({
      ok: false,
      problems: { rate: 'Un taux en pour cent, de 0 à 100, par exemple 20 ou 5,5.' },
    });
    expect(regimeBodyOf({ ...draft, name: '', countries: [] }, KEY)).toEqual({
      ok: false,
      problems: {
        name: 'Un nom de 80 caractères au plus, celui que le comptable lui donne.',
        countries: 'Au moins un pays.',
      },
    });
  });

  it('sends a text as pasted, the mandate with its delay, the previous one offered', () => {
    expect(textDraftOf(MANDATE_V1).contestDelayDays).toBe('7');
    expect(textDraftOf(null).contestDelayDays).toBe('7');
    expect(textBodyOf('service_contract', { body: ' Contrat.\n', contestDelayDays: '7' }, KEY)).toEqual({
      ok: true,
      body: { id: KEY, kind: 'service_contract', body: ' Contrat.\n' },
    });
    expect(textBodyOf('billing_mandate', { body: 'Mandat.', contestDelayDays: '14' }, KEY)).toEqual({
      ok: true,
      body: { id: KEY, kind: 'billing_mandate', body: 'Mandat.', contestDelayDays: 14 },
    });
    expect(textBodyOf('billing_mandate', { body: '   ', contestDelayDays: '0' }, KEY)).toEqual({
      ok: false,
      problems: {
        body: 'Colle le texte validé par ton comptable.',
        contestDelayDays: 'Un nombre entier de jours, de 1 à 60.',
      },
    });
  });

  it('writes an account as the export does, an empty one as none', () => {
    expect(accountOf(' 401 nora ')).toBe('401NORA');
    expect(accountOf('  ')).toBeNull();
    expect(accountsDraftOf(null).bank).toBe('');
    expect(givenCount(null)).toBe(0);
    const checked = accountsBodyOf({ ...accountsDraftOf(null), bank: '512-1' });
    expect(checked).toEqual({ ok: false, problems: { bank: 'Un compte : chiffres et majuscules.' } });
  });
});
