import { describe, expect, it } from 'vitest';

import {
  askedText,
  documentDatesText,
  documentStanding,
  documentStateText,
  identityLines,
  olderDocuments,
  prefixOf,
  profileBodyOf,
  profileDraftOf,
  profileFields,
  profileProblems,
  regimeAhead,
  regimeInForce,
  regimesFor,
  reminderText,
  suggestedVat,
  textStanding,
  validationText,
  type ProfileDraft,
} from './model';

import {
  acceptanceOf,
  BENIN_DRAFT,
  BENIN_REGIME,
  CONTRACT_V1,
  contractorRegimeOf,
  documentOf,
  FRANCE_REGIME,
  MANDATE_V1,
  MANDATE_V2,
  profileOf,
} from '@/test/contractors';

describe('the regime of a file', () => {
  it('is the latest begun on the file’s day, and the nearest set ahead waits its day', () => {
    const regimes = [
      contractorRegimeOf(3, BENIN_DRAFT, '2026-12-01'),
      contractorRegimeOf(2, BENIN_DRAFT, '2026-11-20'),
      contractorRegimeOf(1, BENIN_REGIME, '2026-11-01'),
    ];
    const file = { today: '2026-11-05', regimes };
    expect(regimeInForce(file)?.from).toBe('2026-11-01');
    expect(regimeAhead(file)?.from).toBe('2026-11-20');
    expect(regimeInForce({ today: '2026-10-31', regimes })).toBeNull();
    expect(regimeAhead({ today: '2026-12-01', regimes })).toBeNull();
  });

  it('offers only the regimes of the member’s country, and says what each asks for', () => {
    expect(regimesFor('MG', [FRANCE_REGIME, BENIN_REGIME]).map((regime) => regime.name)).toEqual([
      BENIN_REGIME.name,
    ]);
    expect(validationText(BENIN_REGIME)).toBe('validé par le comptable le 30 octobre 2026');
    expect(validationText(BENIN_DRAFT)).toMatch(/^pas encore validé par le comptable/u);
    expect(askedText(BENIN_REGIME)).toBe('attestation de résidence fiscale');
    expect(askedText({ documents: ['tax_residence', 'urssaf_vigilance'] })).toBe(
      'attestation de résidence fiscale et attestation de vigilance',
    );
    expect(askedText({ documents: [] })).toBeNull();
  });
});

describe('the texts', () => {
  const texts = [MANDATE_V2, MANDATE_V1, CONTRACT_V1];

  it('asks a new acceptance for a new version, and says the one accepted before', () => {
    const acceptances = [acceptanceOf(1, MANDATE_V1, '2026-10-30T10:00:00.000Z')];
    expect(textStanding('billing_mandate', texts, acceptances)).toEqual({
      kind: 'to_accept',
      text: MANDATE_V2,
      before: { version: 1, at: '2026-10-30T10:00:00.000Z' },
    });
    expect(textStanding('service_contract', texts, acceptances)).toEqual({
      kind: 'to_accept',
      text: CONTRACT_V1,
      before: null,
    });
  });

  it('reads the newest accepted, and none while the agency has published none', () => {
    const acceptances = [acceptanceOf(2, CONTRACT_V1, '2026-10-30T10:00:00.000Z')];
    expect(textStanding('service_contract', texts, acceptances)).toEqual({
      kind: 'accepted',
      text: CONTRACT_V1,
      at: '2026-10-30T10:00:00.000Z',
    });
    expect(textStanding('billing_mandate', [], acceptances)).toEqual({ kind: 'none' });
  });
});

describe('the documents', () => {
  it('shows the newest not refused, else the newest refused, and keeps the others under it', () => {
    const refused = documentOf(3, {
      issuedOn: '2026-11-02',
      review: { decision: 'refused', reason: 'Illisible', reviewedAt: '2026-11-03T09:00:00.000Z' },
      remindFrom: null,
    });
    const pending = documentOf(2, { issuedOn: '2026-10-20', review: null });
    const accepted = documentOf(1, { remindFrom: null });
    const documents = [refused, pending, accepted];
    const standing = documentStanding('tax_residence', documents);
    expect(standing).toEqual({ kind: 'pending', document: pending });
    expect(olderDocuments('tax_residence', documents, standing)).toEqual([refused, accepted]);
    expect(documentStanding('tax_residence', [refused])).toEqual({ kind: 'refused', document: refused });
    expect(documentStanding('urssaf_vigilance', documents)).toEqual({ kind: 'missing' });
  });

  it('says a document’s check and its dates', () => {
    expect(documentStateText(documentOf(1))).toBe('Acceptée jusqu’au 31 décembre 2026');
    expect(documentStateText(documentOf(2, { review: null }))).toBe('En attente de vérification');
    const vigilance = documentOf(3, {
      kind: 'urssaf_vigilance',
      issuedOn: '2026-10-01',
      validUntil: '2027-03-31',
      lastDay: '2027-03-31',
    });
    expect(documentDatesText(vigilance)).toBe('délivrée le 1er octobre 2026, valable jusqu’au 31 mars 2027');
    expect(documentDatesText(documentOf(4))).toBe('délivrée le 10 février 2026');
  });

  it('reminds the renewal from remindFrom on the file’s day, with the next year of the guide', () => {
    const certificate = documentOf(1);
    expect(reminderText(certificate, '2026-11-30', true)).toBeNull();
    expect(reminderText(certificate, '2026-12-01', true)).toBe(
      'Ton attestation se termine le 31 décembre. Sans celle de 2027, tes versements à partir du 1er janvier 2027 seront bloqués : demande-la dès janvier.',
    );
    expect(reminderText(certificate, '2026-12-01', false)).toBe(
      'Son attestation se termine le 31 décembre. Sans celle de 2027, ses versements à partir du 1er janvier 2027 seront bloqués.',
    );
    expect(reminderText(documentOf(2, { remindFrom: null }), '2026-12-15', true)).toBeNull();
    const vigilance = documentOf(3, {
      kind: 'urssaf_vigilance',
      lastDay: '2027-03-31',
      remindFrom: '2027-03-01',
    });
    expect(reminderText(vigilance, '2027-03-02', true)).toBe(
      'Ton attestation de vigilance se termine le 31 mars 2027 : dépose la nouvelle avant.',
    );
  });
});

describe('the identity', () => {
  it('prints « EI » after an individual entrepreneur, and a company’s mentions', () => {
    const lines = identityLines(
      profileOf({
        legalName: 'Basile Exemple',
        address: '1 rue de l’Exemple\n69000 Lyon',
        taxId: null,
        businessId: '732829320',
        individualEntrepreneur: true,
      }),
    );
    expect(lines).toContainEqual(['Nom', 'Basile Exemple EI']);
    expect(lines).toContainEqual(['Adresse', '1 rue de l’Exemple, 69000 Lyon']);
    expect(lines).toContainEqual(['SIREN ou SIRET', '732829320']);
    expect(lines.map(([label]) => label)).not.toContain('Identifiant fiscal');
    const company = identityLines(
      profileOf({
        legalName: 'Exemple SAS',
        businessId: '732829320',
        legalForm: 'SAS',
        shareCapitalMinor: 100_000,
        rcsCity: 'Lyon',
      }),
    ).map(([label]) => label);
    expect(company).toEqual(
      expect.arrayContaining(['Société', 'Registre', 'Identifiant fiscal', 'E-mail des factures']),
    );
  });
});

describe('the form of the file', () => {
  const benin: ProfileDraft = { ...profileDraftOf(null, 'BJ'), legalName: 'Théo Exemple' };

  it('asks a French contractor his registration, another his tax identifier', () => {
    expect(profileDraftOf(null, 'FR').status).toBe('individual');
    expect(benin.status).toBe('person');
    expect(profileFields(benin, 'BJ')).toEqual(['legalName', 'address', 'taxId', 'email']);
    const company: ProfileDraft = { ...profileDraftOf(null, 'FR'), status: 'company' };
    expect(profileFields(company, 'FR')).toEqual([
      'legalName',
      'address',
      'businessId',
      'vatNumber',
      'legalForm',
      'shareCapital',
      'rcsCity',
      'email',
    ]);
  });

  it('says each wrong field, the tax identifier only when the regime asks for it', () => {
    const draft = { ...benin, address: 'Cotonou', email: 'pas-une-adresse' };
    expect(Object.keys(profileProblems(draft, 'BJ', false))).toEqual(['email']);
    expect(Object.keys(profileProblems(draft, 'BJ', true))).toEqual(['taxId', 'email']);
    expect(profileBodyOf(draft, 'BJ', true)).toBeNull();
    expect(profileBodyOf({ ...draft, taxId: ' 0000 ', email: 'theo@example.test' }, 'BJ', true)).toEqual({
      legalName: 'Théo Exemple',
      address: 'Cotonou',
      taxId: '0000',
      businessId: null,
      vatNumber: null,
      individualEntrepreneur: false,
      legalForm: null,
      shareCapitalMinor: null,
      rcsCity: null,
      email: 'theo@example.test',
    });
  });

  it('checks the SIREN and the VAT number it gives, and offers that one', () => {
    const french: ProfileDraft = {
      ...profileDraftOf(null, 'FR'),
      legalName: 'Basile Exemple',
      address: '1 rue de l’Exemple',
      email: 'basile@example.test',
      businessId: '732 829 321',
    };
    expect(profileProblems(french, 'FR', false).businessId).toMatch(/n’en est pas un/u);
    const valid = { ...french, businessId: '732 829 320', vatNumber: 'FR00732829320' };
    expect(profileProblems(valid, 'FR', false).vatNumber).toBe(
      'Le numéro de TVA de ce SIREN est FR44732829320 : vérifie l’un ou l’autre.',
    );
    expect(suggestedVat(valid)).toBe('FR44732829320');
    expect(suggestedVat({ ...valid, vatNumber: 'FR44 732 829 320' })).toBeNull();
    expect(profileBodyOf({ ...valid, vatNumber: 'fr44 732 829 320' }, 'FR', false)).toMatchObject({
      businessId: '732829320',
      vatNumber: 'FR44732829320',
      individualEntrepreneur: true,
    });
  });

  it('takes a company’s capital in euros', () => {
    const company: ProfileDraft = {
      ...profileDraftOf(null, 'FR'),
      status: 'company',
      legalName: 'Exemple SAS',
      address: '1 rue de l’Exemple',
      email: 'contact@example.test',
      businessId: '732829320',
      legalForm: 'SAS',
      shareCapital: '1 000',
      rcsCity: 'Lyon',
    };
    expect(profileBodyOf(company, 'FR', false)).toMatchObject({
      individualEntrepreneur: false,
      legalForm: 'SAS',
      shareCapitalMinor: 100_000,
      rcsCity: 'Lyon',
    });
  });

  it('reads back a saved file in its fields', () => {
    const draft = profileDraftOf(
      profileOf({ businessId: '732829320', legalForm: 'SAS', shareCapitalMinor: 100_000, rcsCity: 'Lyon' }),
      'FR',
    );
    expect(draft.status).toBe('company');
    expect(draft.shareCapital).toBe('1000');
  });
});

describe('the prefix', () => {
  it('takes 2 to 8 capitals or digits, as typed in lower case', () => {
    expect(prefixOf(' nora ')).toBe('NORA');
    expect(prefixOf('N')).toBeNull();
    expect(prefixOf('NORA-1')).toBeNull();
  });
});
