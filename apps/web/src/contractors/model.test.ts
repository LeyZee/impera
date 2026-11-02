import { describe, expect, it } from 'vitest';

import {
  askedText,
  documentDatesText,
  documentStanding,
  documentStateText,
  earliestRegimeDay,
  fileReminders,
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

  it('starts a new regime today at the earliest, and after the last one given', () => {
    expect(earliestRegimeDay({ today: '2026-11-05', regimes: [] })).toBe('2026-11-05');
    const inForce = contractorRegimeOf(1, BENIN_REGIME, '2026-11-01');
    expect(earliestRegimeDay({ today: '2026-11-05', regimes: [inForce] })).toBe('2026-11-05');
    // Given today: the next starts tomorrow, as the server's `assertRegimeChange` wants.
    expect(earliestRegimeDay({ today: '2026-11-01', regimes: [inForce] })).toBe('2026-11-02');
    const ahead = contractorRegimeOf(2, BENIN_DRAFT, '2026-12-01');
    expect(earliestRegimeDay({ today: '2026-11-05', regimes: [ahead, inForce] })).toBe('2026-12-02');
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
    const standing = documentStanding('tax_residence', documents, '2026-11-05');
    expect(standing).toEqual({ kind: 'pending', document: pending });
    expect(olderDocuments('tax_residence', documents, standing)).toEqual([refused, accepted]);
    expect(documentStanding('tax_residence', [refused], '2026-11-05')).toEqual({
      kind: 'refused',
      document: refused,
    });
    expect(documentStanding('urssaf_vigilance', documents, '2026-11-05')).toEqual({ kind: 'missing' });
  });

  it('follows the newest issued, as the server does, though an older year was filed after it', () => {
    const year2027 = documentOf(1, {
      issuedOn: '2027-01-08',
      lastDay: '2027-12-31',
      remindFrom: '2027-12-01',
    });
    // The certificate of 2026 filed again, late: it does not take the place of the one of 2027.
    const lateFiled = documentOf(2, { remindFrom: null });
    expect(documentStanding('tax_residence', [lateFiled, year2027], '2027-01-10')).toEqual({
      kind: 'accepted',
      document: year2027,
    });
    // The same day of issue: the latest filed stays.
    const again = documentOf(3, { review: null, remindFrom: '2026-12-01' });
    expect(documentStanding('tax_residence', [again, lateFiled], '2026-11-05').kind).toBe('pending');
  });

  it('says an accepted document past its last day expired, on the file’s day', () => {
    const certificate = documentOf(1);
    expect(documentStanding('tax_residence', [certificate], '2026-12-31').kind).toBe('accepted');
    expect(documentStanding('tax_residence', [certificate], '2027-01-01')).toEqual({
      kind: 'expired',
      document: certificate,
    });
    expect(documentStateText(certificate, '2027-01-01')).toBe('Acceptée, échue le 31 décembre 2026');
  });

  it('says a document’s check and its dates', () => {
    expect(documentStateText(documentOf(1), '2026-11-05')).toBe('Acceptée jusqu’au 31 décembre 2026');
    expect(documentStateText(documentOf(2, { review: null }), '2027-01-05')).toBe(
      'En attente de vérification',
    );
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
    expect(reminderText(certificate, '2026-11-30', true, true)).toBeNull();
    expect(reminderText(certificate, '2026-12-01', true, true)).toBe(
      'Ton attestation se termine le 31 décembre. Sans celle de 2027, tes versements à partir du 1er janvier 2027 seront bloqués : demande-la dès janvier.',
    );
    expect(reminderText(certificate, '2026-12-01', false, true)).toBe(
      'Son attestation se termine le 31 décembre. Sans celle de 2027, ses versements à partir du 1er janvier 2027 seront bloqués.',
    );
    expect(reminderText(documentOf(2, { remindFrom: null }), '2026-12-15', true, true)).toBeNull();
    const vigilance = documentOf(3, {
      kind: 'urssaf_vigilance',
      lastDay: '2027-03-31',
      remindFrom: '2027-03-01',
    });
    expect(reminderText(vigilance, '2027-03-02', true, true)).toBe(
      'Ton attestation de vigilance se termine le 31 mars 2027 : dépose la nouvelle avant.',
    );
  });

  it('says what holds once the last day passed: the payouts blocked, the invoices with a warning', () => {
    const certificate = documentOf(1);
    expect(reminderText(certificate, '2027-01-02', true, true)).toBe(
      'Ton attestation de 2026 s’est terminée le 31 décembre 2026. Tes versements sont bloqués jusqu’à ce que celle de 2027 soit acceptée : demande-la à la DGI et dépose-la ici.',
    );
    expect(reminderText(certificate, '2027-01-02', false, true)).toBe(
      'Son attestation de 2026 s’est terminée le 31 décembre 2026 : ses versements sont bloqués jusqu’à ce que celle de 2027 soit acceptée.',
    );
    const vigilance = documentOf(3, {
      kind: 'urssaf_vigilance',
      lastDay: '2027-03-31',
      remindFrom: '2027-03-01',
    });
    expect(reminderText(vigilance, '2027-04-01', true, true)).toBe(
      'Ton attestation de vigilance s’est terminée le 31 mars 2027 : dépose la nouvelle. Tes factures partent avec un avertissement en attendant.',
    );
    expect(reminderText(vigilance, '2027-04-01', false, true)).toBe(
      'Son attestation de vigilance s’est terminée le 31 mars 2027 : ses factures partent avec un avertissement.',
    );
  });

  it('says only a warning on the invoices for a certificate a regime without a treaty asks for', () => {
    const certificate = documentOf(1);
    expect(reminderText(certificate, '2026-12-01', true, false)).toBe(
      'Ton attestation se termine le 31 décembre 2026. Sans celle de 2027, tes factures à partir du 1er janvier 2027 partiront avec un avertissement : demande-la dès janvier.',
    );
    expect(reminderText(certificate, '2026-12-01', false, false)).toBe(
      'Son attestation se termine le 31 décembre 2026. Sans celle de 2027, ses factures à partir du 1er janvier 2027 partiront avec un avertissement.',
    );
    expect(reminderText(certificate, '2027-01-02', true, false)).toBe(
      'Ton attestation de 2026 s’est terminée le 31 décembre 2026 : dépose celle de 2027. Tes factures partent avec un avertissement en attendant.',
    );
    expect(reminderText(certificate, '2027-01-02', false, false)).toBe(
      'Son attestation de 2026 s’est terminée le 31 décembre 2026 : ses factures partent avec un avertissement.',
    );
    expect(reminderText(certificate, '2026-11-30', true, false)).toBeNull();
  });

  it('says the last day the API set when a certificate states another than the 31st of December', () => {
    const certificate = documentOf(1, {
      validUntil: '2026-11-30',
      lastDay: '2026-11-30',
      remindFrom: '2026-11-01',
    });
    expect(reminderText(certificate, '2026-11-02', true, true)).toMatch(
      /^Ton attestation se termine le 30 novembre 2026\. Sans celle de 2027/u,
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

describe('the reminders of one’s own file on Aujourd’hui', () => {
  it('names each document of the regime whose reminder has come, worded as the file words it', () => {
    const documents = [documentOf(1)];
    expect(fileReminders({ documents, today: '2026-11-30' }, BENIN_REGIME)).toEqual([]);
    expect(fileReminders({ documents, today: '2026-12-01' }, BENIN_REGIME)).toEqual([
      {
        kind: 'tax_residence',
        text: 'Ton attestation se termine le 31 décembre. Sans celle de 2027, tes versements à partir du 1er janvier 2027 seront bloqués : demande-la dès janvier.',
      },
    ]);
    // Outside a treaty, the certificate only puts a warning on the invoices (Équipe's choice (a)).
    expect(
      fileReminders(
        { documents, today: '2026-12-01' },
        { documents: ['tax_residence'], withholding: 'none' },
      )[0]?.text,
    ).toMatch(/partiront avec un avertissement/u);
    // A document the regime does not ask for, a missing one, or no regime: nothing to remind.
    expect(fileReminders({ documents, today: '2026-12-01' }, FRANCE_REGIME)).toEqual([]);
    expect(fileReminders({ documents: [], today: '2026-12-01' }, BENIN_REGIME)).toEqual([]);
    expect(fileReminders({ documents, today: '2026-12-01' }, null)).toEqual([]);
  });
});
