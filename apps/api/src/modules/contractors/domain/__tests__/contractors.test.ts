import type { ContractorProfileBody } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { profileChanges } from '../contractors';

/** An invented contractor of Cotonou (ADR 0010). */
const KOFI: ContractorProfileBody = {
  legalName: 'Kofi Exemple',
  address: '12 rue des Exemples\nCotonou',
  taxId: '0202012345678',
  businessId: null,
  vatNumber: null,
  individualEntrepreneur: false,
  legalForm: null,
  shareCapitalMinor: null,
  rcsCity: null,
  email: 'kofi@exemple.test',
};

describe('Équipe › Dossier prestataire : ce que change une écriture', () => {
  it('names the fields a first write fills, never the empty ones', () => {
    expect(profileChanges(null, KOFI)).toEqual(['legalName', 'address', 'taxId', 'email']);
    expect(profileChanges(null, { ...KOFI, individualEntrepreneur: true })).toContain(
      'individualEntrepreneur',
    );
  });

  it('names nothing when the same values come again', () => {
    expect(profileChanges(KOFI, { ...KOFI })).toEqual([]);
  });

  it('names each changed field in the order of the file, a cleared one too', () => {
    expect(
      profileChanges(KOFI, { ...KOFI, email: 'kofi2@exemple.test', taxId: null, legalName: 'Kofi E.' }),
    ).toEqual(['legalName', 'taxId', 'email']);
  });
});
