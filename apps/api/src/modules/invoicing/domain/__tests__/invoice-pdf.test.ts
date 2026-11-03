import type { InvoiceContractor } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { invoicePdfRetainUntil } from '../../../contractors/domain/retention';
import {
  invoicePdfContent,
  invoicePdfKey,
  type InvoicePdfContent,
  type PdfDocumentSource,
} from '../invoice-pdf';
import { paymentTermsMention } from '../invoices';

import {
  AGENCY,
  CONTRACTOR,
  REGIME_MENTIONS,
  SERVICE,
  TERMS,
  frenchCharged,
  frenchFranchise,
  sampleCorrectiveInvoice,
  sampleCreditNote,
  sampleInvoice,
  worstCase,
} from './invoice-pdf-fixtures';

/** The spaces French sets that never break, as plain spaces, to read a text in a test. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/gu, ' ');
/** Every word a content prints, as one plain text. */
const allText = (content: InvoicePdfContent): string => plain(JSON.stringify(content));

/** A French contractor charging VAT at 20 %, without annex: one line of 100 €. */
const charged = (patch: Partial<PdfDocumentSource> = {}): PdfDocumentSource =>
  sampleInvoice({
    contractor: {
      legalName: 'Basile Exemple',
      address: '2 rue Inventée\n69001 Lyon',
      country: 'FR',
      taxId: null,
      businessId: '12345678900011',
      vatNumber: 'FR98123456789',
      individualEntrepreneur: true,
    },
    vat: { treatment: 'charged', rateBps: 2_000 },
    regimeMentions: [],
    mentions: [paymentTermsMention('2027-01-16', TERMS)],
    lines: [
      {
        kind: 'commission',
        label: 'Commission, compte @basile.demo sur Reveal',
        detail: null,
        amountMinor: 10_000,
      },
    ],
    totals: { exclVatMinor: 10_000, vatMinor: 2_000, inclVatMinor: 12_000 },
    annex: null,
    ...patch,
  });

describe('Équipe › Factures : où le PDF est rangé et combien de temps il est verrouillé (ADR 0037 § 4)', () => {
  it('ranges a PDF by year of issue and document id, never by name or number', () => {
    expect(invoicePdfKey('0190f1a2-0000-7000-8000-000000000001', '2026-11-17')).toBe(
      'invoices/2026/0190f1a2-0000-7000-8000-000000000001.pdf',
    );
    expect(() => invoicePdfKey('id', '17/11/2026')).toThrow(RangeError);
  });

  it('locks a PDF ten years after the close of the fiscal year of its issue', () => {
    // Calendar year: an invoice of March 2027 closes on 31 December 2027, locked through 31 December 2037.
    expect(invoicePdfRetainUntil('2027-03-15', 12).toISOString()).toBe('2038-01-01T00:00:00.000Z');
    expect(invoicePdfRetainUntil('2027-12-31', 12).toISOString()).toBe('2038-01-01T00:00:00.000Z');
    // A year closing on 30 June: June belongs to the year that closes then, July to the next.
    expect(invoicePdfRetainUntil('2027-06-30', 6).toISOString()).toBe('2037-07-01T00:00:00.000Z');
    expect(invoicePdfRetainUntil('2027-07-01', 6).toISOString()).toBe('2038-07-01T00:00:00.000Z');
  });

  it('refuses a month or a day that does not exist', () => {
    expect(() => invoicePdfRetainUntil('2027-03-15', 0)).toThrow(RangeError);
    expect(() => invoicePdfRetainUntil('2027-03-15', 13)).toThrow(RangeError);
    expect(() => invoicePdfRetainUntil('2027-03-15', 6.5)).toThrow(RangeError);
    expect(() => invoicePdfRetainUntil('2027-13-01', 12)).toThrow(RangeError);
    expect(() => invoicePdfRetainUntil('mars 2027', 12)).toThrow(RangeError);
  });
});

describe('Équipe › Factures : ce que la facture imprime (EQ-06 lot 4, audit du 01/11)', () => {
  const content = invoicePdfContent(sampleInvoice());

  it('says it is a self-billed invoice, drafted by the agency in the contractor’s name under the mandate', () => {
    expect(content).toMatchObject({
      title: 'Facture AEX-2026-0021',
      number: 'AEX-2026-0021',
      heading: 'Facture',
      badge: 'Autofacturation',
      agencyName: 'Agence Exemple SAS',
      continued: 'Facture AEX-2026-0021 (suite)',
    });
    expect(content.brandNote).toBe(
      'Facture établie par Agence Exemple SAS au nom et pour le compte d’Awa Exemple, en vertu du mandat de facturation accepté le 3 octobre 2026.',
    );
  });

  it('prints its number, issue, period and due date, the number and due date stressed', () => {
    expect(content.meta.map((one) => [one.label, plain(one.value), one.strong])).toEqual([
      ['Numéro', 'AEX-2026-0021', true],
      ['Date d’émission', '17 novembre 2026', false],
      ['Période de la prestation', 'du 1er au 15 novembre 2026', false],
      ['Échéance', '16 janvier 2027', true],
    ]);
  });

  it('prints the contractor as the seller and the agency as the buyer, with their identifiers', () => {
    const [contractor, agency] = content.parties;
    expect(contractor).toEqual({
      label: 'Prestataire (fournisseur)',
      name: 'Awa Exemple',
      lines: ['Lot 00, quartier Exemple', 'Cotonou', 'Bénin'],
      ids: [{ label: 'IFU', value: '0000000000000' }],
    });
    expect(agency).toEqual({
      label: 'Client (preneur)',
      name: 'Agence Exemple SAS',
      lines: ['1 place Inventée', '69000 Lyon', 'France'],
      ids: [
        { label: 'SIREN', value: '123\u00a0456\u00a0789' },
        { label: 'TVA intracommunautaire', value: 'FR12123456789' },
      ],
    });
  });

  it('prints the object, the category of the operation and the annex it joins', () => {
    expect(content.object.map((one) => [one.lead, plain(one.text)])).toEqual([
      ['Objet', ` : ${SERVICE}`],
      [null, 'Catégorie de l’opération : prestation de services. Relevé de commissions joint en annexe.'],
    ]);
  });

  it('prints each line excluding VAT, then the totals under reverse charge, without any VAT amount', () => {
    expect(content.lines.header).toEqual(['Désignation', 'Montant HT']);
    expect(content.lines.rows.map((row) => [row.label, plain(row.amount)])).toEqual([
      ['Commission, compte @awa.demo sur Reveal', '740,96 €'],
      ['Commission, compte @awa.second sur Reveal', '165,00 €'],
      ['Prime de palier', '50,00 €'],
      ['Réfaction prévue au contrat', '-25,00 €'],
    ]);
    expect(content.vatNote).toEqual({
      lead: 'Autoliquidation',
      text: 'TVA due par le preneur (art. 283-2 du CGI). Aucune TVA n’est facturée.',
      currency: 'Montants exprimés en euros (EUR).',
    });
    expect(content.totals.map((one) => [one.label, plain(one.value), one.muted, one.grand])).toEqual([
      ['Total HT', '930,96 €', false, false],
      ['TVA', 'Autoliquidation', true, false],
      ['Net à payer', '930,96 €', false, true],
    ]);
    // The VAT the agency self-assesses is its own debt, never printed as owed to the contractor.
    expect(allText(content)).not.toMatch(/20 %|186,19/u);
  });

  it('prints the due date on its own line, then the agency’s conditions word for word, then the acceptance', () => {
    expect(content.blocks).toEqual([
      { heading: 'Conditions de paiement', paragraphs: ['Échéance\u00a0: 16 janvier 2027.', TERMS] },
      {
        heading: 'Acceptation',
        paragraphs: [
          'Le prestataire peut contester cette facture jusqu’au 24 novembre 2026, 10\u00a0h\u00a030 (heure de Paris). Sans contestation à cette date, elle est réputée acceptée, conformément au mandat de facturation.',
        ],
      },
    ]);
  });

  it('prints the regime’s mentions as frozen, under their own heading', () => {
    expect(content.mentions).toEqual({ heading: 'Mentions du régime', items: REGIME_MENTIONS });
  });

  it('prints the agency’s legal identity in the foot of each page (art. R123-237 C. com.)', () => {
    expect(plain(content.footer)).toBe(
      'Document établi par Agence Exemple SAS, 1 place Inventée, 69000 Lyon · SAS au capital de 1 000 € · RCS Lyon 123 456 789, mandataire de facturation du prestataire.',
    );
  });

  it('joins the statement by account, then the invoice’s elements, which add up to the amount invoiced', () => {
    const annex = content.annex;
    if (annex === null) throw new Error('no annex');
    expect(annex.ref).toEqual(['Annexe de la facture', 'AEX-2026-0021', 'du 17 novembre 2026']);
    expect(annex.heading).toBe('Relevé de commissions');
    expect(plain(annex.subheading)).toBe(
      'Awa Exemple · période du 1er au 15 novembre 2026 · relevé validé le 17 novembre 2026',
    );
    // Sales without VAT: no VAT column.
    expect(annex.accounts.header.map((cell) => cell.text)).toEqual([
      'Compte',
      'Ventes brutes',
      'Commission plateforme',
      'Net',
      'Taux',
      'Commission',
    ]);
    expect(annex.accounts.rows.map((row) => [row.cells.map((cell) => plain(cell.text)), row.detail])).toEqual(
      [
        [['@awa.demo · Reveal', '2 315,50 €', '-463,10 €', '1 852,40 €', '40 %', '740,96 €'], null],
        [['@awa.second · Reveal', '515,63 €', '-103,13 €', '412,50 €', '40 %', '165,00 €'], null],
      ],
    );
    expect(annex.accounts.total.map((cell) => plain(cell.text))).toEqual([
      'Total des comptes',
      '2 831,13 €',
      '-566,23 €',
      '2 264,90 €',
      '',
      '905,96 €',
    ]);
    expect(annex.elements.rows.map((row) => row.map((cell) => plain(cell.text)))).toEqual([
      ['Commissions', '905,96 €'],
      ['Prime de palier', '50,00 €'],
      ['Réfactions prévues au contrat', '-25,00 €'],
    ]);
    expect(annex.elements.total.map((cell) => plain(cell.text))).toEqual([
      'Montant facturé (facture AEX-2026-0021)',
      '930,96 €',
    ]);
    expect(annex.note).toMatch(/il n’en change aucun montant/u);
  });

  it('prints an account in another currency in euros, with its amount and the ECB rate under it', () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    const content = invoicePdfContent({
      ...source,
      annex: {
        ...annex,
        accounts: [
          { ...first, currency: 'USD', grossMinor: 250_746, rateMicros: 923_456, rateOn: '2026-11-13' },
          second,
        ],
      },
    });
    expect(content.annex?.accounts.rows.map((row) => row.detail && plain(row.detail))).toEqual([
      '2 507,46 $US convertis à 1 $US = 0,923456 € (cours BCE du 13 novembre 2026)',
      null,
    ]);
  });

  it('adds a VAT column when an account’s sales carry VAT', () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    const content = invoicePdfContent({
      ...source,
      annex: { ...annex, accounts: [{ ...first, exclVatMinor: 192_958 }, second] },
    });
    expect(content.annex?.accounts.header.map((cell) => cell.text)).toContain('TVA');
    expect(content.annex?.accounts.rows[0]?.cells.map((cell) => plain(cell.text))).toEqual([
      '@awa.demo · Reveal',
      '2 315,50 €',
      '-385,92 €',
      '-77,18 €',
      '1 852,40 €',
      '40 %',
      '740,96 €',
    ]);
  });

  it('prints a row on the platform’s net with its net only, the chain’s columns empty (CRM-03)', () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    const onNet = { ...second, base: 'platform_net' as const, grossMinor: 41_250, grossEurMinor: 41_250 };
    const content = invoicePdfContent({
      ...source,
      annex: {
        ...annex,
        accounts: [
          { ...first, exclVatMinor: 192_958 },
          { ...onNet, exclVatMinor: 41_250 },
        ],
      },
    });
    expect(content.annex?.accounts.header.map((cell) => cell.text)).toEqual([
      'Compte',
      'Ventes brutes',
      'TVA',
      'Commission plateforme',
      'Net',
      'Taux',
      'Commission',
    ]);
    expect(
      content.annex?.accounts.rows.map((row) => [row.cells.map((cell) => plain(cell.text)), row.detail]),
    ).toEqual([
      [['@awa.demo · Reveal', '2 315,50 €', '-385,92 €', '-77,18 €', '1 852,40 €', '40 %', '740,96 €'], null],
      [
        ['@awa.second · Reveal', '—', '—', '—', '412,50 €', '40 %', '165,00 €'],
        'Net de Reveal des ventes lues, la TVA et sa commission déjà retenues',
      ],
    ]);
    // The chain's totals are those of its rows; the net and the commissions, every row's.
    expect(content.annex?.accounts.total.map((cell) => plain(cell.text))).toEqual([
      'Total des comptes',
      '2 315,50 €',
      '-385,92 €',
      '-77,18 €',
      '2 264,90 €',
      '',
      '905,96 €',
    ]);
  });

  it('prints a statement on the platform’s net alone without the chain’s columns, a foreign net with its rate', () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    // 2 005,93 $US of net at 0,923456 € make 1 852,40 €.
    const content = invoicePdfContent({
      ...source,
      annex: {
        ...annex,
        accounts: [
          {
            ...first,
            base: 'platform_net',
            currency: 'USD',
            rateMicros: 923_456,
            rateOn: '2026-11-13',
            grossMinor: 200_593,
            grossEurMinor: 185_240,
            exclVatMinor: 185_240,
          },
          {
            ...second,
            base: 'platform_net',
            grossMinor: 41_250,
            grossEurMinor: 41_250,
            exclVatMinor: 41_250,
          },
        ],
      },
    });
    expect(content.annex?.accounts.header.map((cell) => cell.text)).toEqual([
      'Compte',
      'Net de la plateforme',
      'Taux',
      'Commission',
    ]);
    expect(
      content.annex?.accounts.rows.map((row) => [
        row.cells.map((cell) => plain(cell.text)),
        row.detail && plain(row.detail),
      ]),
    ).toEqual([
      [
        ['@awa.demo · Reveal', '1 852,40 €', '40 %', '740,96 €'],
        'Net de Reveal des ventes lues, la TVA et sa commission déjà retenues : 2 005,93 $US convertis à 1 $US = 0,923456 € (cours BCE du 13 novembre 2026)',
      ],
      [
        ['@awa.second · Reveal', '412,50 €', '40 %', '165,00 €'],
        'Net de Reveal des ventes lues, la TVA et sa commission déjà retenues',
      ],
    ]);
    expect(content.annex?.accounts.total.map((cell) => plain(cell.text))).toEqual([
      'Total des comptes',
      '2 264,90 €',
      '',
      '905,96 €',
    ]);
  });

  it('refuses an annex whose elements do not add up to the amount invoiced', () => {
    expect(() =>
      invoicePdfContent(
        sampleInvoice({ totals: { exclVatMinor: 93_000, vatMinor: 0, inclVatMinor: 93_000 } }),
      ),
    ).toThrow(/do not add up/u);
  });

  it('refuses a statement whose commissions are not the invoice’s, or a foreign rate without its day', () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    expect(() =>
      invoicePdfContent({
        ...source,
        annex: { ...annex, accounts: [{ ...first, commissionMinor: 74_000 }, second] },
      }),
    ).toThrow(/does not give its commissions/u);
    expect(() =>
      invoicePdfContent({
        ...source,
        annex: {
          ...annex,
          accounts: [{ ...first, currency: 'USD', rateMicros: 923_456, rateOn: null }, second],
        },
      }),
    ).toThrow(/has no day/u);
  });

  it('keeps the worst case consistent: its statement gives the commissions it invoices', () => {
    const content = invoicePdfContent(worstCase());
    const annex = content.annex;
    if (annex === null) throw new Error('no annex');
    const [commissions] = annex.elements.rows;
    expect(plain(commissions?.[1]?.text ?? '')).toBe(plain(annex.accounts.total.at(-1)?.text ?? ''));
  });

  it('refuses mentions that are not the regime’s then the payment terms, never printing half of them', () => {
    expect(() =>
      invoicePdfContent(sampleInvoice({ mentions: [paymentTermsMention('2027-01-16', TERMS)] })),
    ).toThrow(/mentions/u);
    expect(() =>
      invoicePdfContent(
        sampleInvoice({ mentions: [paymentTermsMention('2027-01-16', TERMS), ...REGIME_MENTIONS] }),
      ),
    ).toThrow(/mentions/u);
    expect(() => invoicePdfContent(sampleInvoice({ mentions: [] }))).toThrow(/mentions/u);
  });

  it('prints the deadline at the agency’s hour, wherever it is', () => {
    const content = invoicePdfContent(sampleInvoice({ timeZone: 'America/New_York' }));
    expect(plain(content.blocks[1]?.paragraphs[0] ?? '')).toMatch(
      /jusqu’au 24 novembre 2026, 4 h 30 \(heure de New York\)\./u,
    );
  });

  it('names the service « prestation de services » when the copy has no designation', () => {
    const content = invoicePdfContent(sampleInvoice({ serviceDescription: null }));
    expect(plain(content.object[0]?.text ?? '')).toBe(' : prestation de services');
  });

  it('prints no country line when the address already ends with it', () => {
    const content = invoicePdfContent(
      sampleInvoice({ contractor: { ...CONTRACTOR, address: 'Lot 00, quartier Exemple\nCotonou, Bénin' } }),
    );
    expect(content.parties[0].lines).toEqual(['Lot 00, quartier Exemple', 'Cotonou, Bénin']);
  });

  it('names the tax identifier « Identifiant fiscal » outside Benin and Madagascar, « NIF » in Madagascar', () => {
    const elsewhere = invoicePdfContent(sampleInvoice({ contractor: { ...CONTRACTOR, country: 'SN' } }));
    expect(elsewhere.parties[0].ids).toEqual([{ label: 'Identifiant fiscal', value: '0000000000000' }]);
    const madagascar = invoicePdfContent(sampleInvoice({ contractor: { ...CONTRACTOR, country: 'MG' } }));
    expect(madagascar.parties[0].ids).toEqual([{ label: 'NIF', value: '0000000000000' }]);
  });
});

describe('Équipe › Factures : un prestataire français qui facture la TVA', () => {
  it('prints « EI », the SIRET in groups, the VAT number, and the VAT the contractor charges', () => {
    const content = invoicePdfContent(charged());
    expect(content.parties[0]).toEqual({
      label: 'Prestataire (fournisseur)',
      name: 'Basile Exemple EI',
      lines: ['2 rue Inventée', '69001 Lyon', 'France'],
      ids: [
        { label: 'SIRET', value: '123\u00a0456\u00a0789\u00a000011' },
        { label: 'TVA intracommunautaire', value: 'FR98123456789' },
      ],
    });
    expect(content.brandNote).toMatch(/au nom et pour le compte de Basile Exemple EI,/u);
    expect(plain(content.vatNote.lead)).toBe('TVA à 20 %');
    expect(content.vatNote.text).toBe('facturée par le prestataire sur le total HT.');
    expect(content.totals.map((one) => [plain(one.label), plain(one.value), one.grand])).toEqual([
      ['Total HT', '100,00 €', false],
      ['TVA à 20 %', '20,00 €', false],
      ['Net à payer TTC', '120,00 €', true],
    ]);
    // A regime without mentions of its own prints no empty heading; no annex, no word of one.
    expect(content.mentions).toBeNull();
    expect(content.annex).toBeNull();
    expect(plain(content.object[1]?.text ?? '')).toBe('Catégorie de l’opération : prestation de services.');
  });

  it('never prints « EI » twice, nor before a name that already ends with it', () => {
    const source = charged();
    const content = invoicePdfContent({
      ...source,
      contractor: { ...source.contractor, legalName: 'Basile Exemple EI' },
    });
    expect(content.parties[0].name).toBe('Basile Exemple EI');
  });

  it('prints a SIREN kept in the tax id by a copy made before lot 4', () => {
    const content = invoicePdfContent(
      charged({
        contractor: {
          legalName: 'Basile Exemple',
          address: '2 rue Inventée\n69001 Lyon',
          country: 'FR',
          taxId: '123456789',
        },
      }),
    );
    expect(content.parties[0]).toMatchObject({
      name: 'Basile Exemple',
      ids: [{ label: 'SIREN', value: '123\u00a0456\u00a0789' }],
    });
  });

  it('elides « de » before a vowel or a Y read as one, and keeps it before a consonant or an H', () => {
    const named = (legalName: string): string =>
      invoicePdfContent(
        charged({ contractor: { ...charged().contractor, legalName, individualEntrepreneur: false } }),
      ).brandNote;
    expect(named('Élodie Exemple')).toMatch(/pour le compte d’Élodie Exemple,/u);
    expect(named('Yves Exemple')).toMatch(/pour le compte d’Yves Exemple,/u);
    expect(named('Yao Exemple')).toMatch(/pour le compte de Yao Exemple,/u);
    expect(named('Hugo Exemple')).toMatch(/pour le compte de Hugo Exemple,/u);
    expect(named('Basile Exemple')).toMatch(/pour le compte de Basile Exemple,/u);
  });

  it('prints a VAT exemption under art. 293 B, without any VAT amount', () => {
    const content = invoicePdfContent(
      charged({
        vat: { treatment: 'exempt' },
        totals: { exclVatMinor: 10_000, vatMinor: 0, inclVatMinor: 10_000 },
      }),
    );
    expect(content.vatNote).toMatchObject({
      lead: 'TVA non applicable, art. 293 B du CGI',
      text: 'Aucune TVA n’est facturée.',
    });
    expect(content.totals.map((one) => [one.label, plain(one.value), one.muted])).toEqual([
      ['Total HT', '100,00 €', false],
      ['TVA', 'Non applicable', true],
      ['Net à payer', '100,00 €', false],
    ]);
  });
});

describe('Équipe › Factures : les deux spécimens France (constats A4 et A8 de l’audit)', () => {
  it('prints the franchise: « EI », the SIRET, no VAT number, « TVA non applicable, art. 293 B du CGI »', () => {
    const content = invoicePdfContent(frenchFranchise());
    // A person: no form, capital or register; no mention of an exemption from registration (struck on 01/11).
    expect(content.parties[0]).toMatchObject({
      name: 'Basile Exemple EI',
      lines: ['2 rue Inventée', '69001 Lyon', 'France'],
      ids: [{ label: 'SIRET', value: '123\u00a0456\u00a0789\u00a000011' }],
    });
    expect(content.mentions).toBeNull();
    expect(content.vatNote.lead).toBe('TVA non applicable, art. 293 B du CGI');
    expect(content.totals.map((one) => [one.label, plain(one.value)])).toEqual([
      ['Total HT', '400,00 €'],
      ['TVA', 'Non applicable'],
      ['Net à payer', '400,00 €'],
    ]);
  });

  it('prints the VAT a company charges: its form, capital, register, SIREN and VAT number, the VAT and the total', () => {
    const content = invoicePdfContent(frenchCharged());
    expect(content.parties[0]).toEqual({
      label: 'Prestataire (fournisseur)',
      name: 'Chloé Exemple SARL',
      lines: [
        '5 avenue Inventée',
        '13001 Marseille',
        'France',
        // Art. R123-237 of the Code de commerce: the register and its number never break apart.
        'SARL au capital de 7\u202f500\u00a0€',
        'RCS\u00a0Marseille\u00a0987\u00a0654\u00a0321',
      ],
      ids: [
        { label: 'SIREN', value: '987\u00a0654\u00a0321' },
        { label: 'TVA intracommunautaire', value: 'FR45987654321' },
      ],
    });
    expect(content.totals.map((one) => [plain(one.label), plain(one.value)])).toEqual([
      ['Total HT', '450,00 €'],
      ['TVA à 20 %', '90,00 €'],
      ['Net à payer TTC', '540,00 €'],
    ]);
    expect(content.mentions).toBeNull();
  });
});

describe('Équipe › Factures : la société prestataire (réponses du comptable, 01/11)', () => {
  // What follows the address (three lines) of the French company, its copy changed by `patch`.
  const companyLines = (patch: Partial<InvoiceContractor>): readonly string[] =>
    invoicePdfContent({
      ...frenchCharged(),
      contractor: { ...frenchCharged().contractor, ...patch },
    }).parties[0].lines.slice(3);

  it('prints the form alone without a capital, and the register only with a SIREN', () => {
    expect(companyLines({ shareCapitalMinor: null })).toEqual([
      'SARL',
      'RCS\u00a0Marseille\u00a0987\u00a0654\u00a0321',
    ]);
    expect(companyLines({ businessId: null })).toEqual(['SARL au capital de 7\u202f500\u00a0€']);
    expect(companyLines({ legalForm: null, shareCapitalMinor: null })).toEqual([
      'RCS\u00a0Marseille\u00a0987\u00a0654\u00a0321',
    ]);
  });

  it('prints a frozen copy as it was written: no line from a copy made before these mentions', () => {
    const { legalName, address, country, taxId, businessId, vatNumber, individualEntrepreneur } =
      frenchCharged().contractor;
    const before = { legalName, address, country, taxId, businessId, vatNumber, individualEntrepreneur };
    expect(invoicePdfContent({ ...frenchCharged(), contractor: before }).parties[0].lines).toEqual([
      '5 avenue Inventée',
      '13001 Marseille',
      'France',
    ]);
  });
});

describe('Équipe › Factures : ce que l’avoir imprime (ADR 0036)', () => {
  const content = invoicePdfContent(sampleCreditNote());

  it('cites its invoice and the period it corrects, and never a due date', () => {
    expect(content.heading).toBe('Avoir');
    expect(content.meta.map((one) => [one.label, plain(one.value), one.strong])).toEqual([
      ['Numéro', 'AEX-2026-0023', true],
      ['Date d’émission', '2 décembre 2026', false],
      ['Facture d’origine', 'AEX-2026-0021 du 17 novembre 2026', true],
      ['Période corrigée', 'du 1er au 15 novembre 2026', false],
    ]);
    // A credit note is set off: no due date, whatever the copy keeps.
    expect(allText(content)).not.toMatch(/Échéance|31 janvier 2027/u);
  });

  it('says it is drafted under the mandate, keeps its invoice’s regime and is set off', () => {
    expect(content.brandNote).toBe(
      'Avoir établi par Agence Exemple SAS au nom et pour le compte d’Awa Exemple, en vertu du mandat de facturation accepté le 3 octobre 2026.',
    );
    expect(content.object.map((one) => plain(one.text))).toEqual([
      ' : Avoir sur la facture AEX-2026-0021 du 17 novembre 2026. Il en reprend le régime de TVA et les mentions.',
      'Catégorie de l’opération : prestation de services.',
    ]);
    expect(content.blocks.map((block) => block.heading)).toEqual(['Imputation', 'Acceptation']);
    expect(plain(content.blocks[0]?.paragraphs[0] ?? '')).toBe(
      'Cet avoir ne donne lieu à aucun paiement : il s’impute sur un prochain versement au prestataire. Il n’a pas d’échéance.',
    );
    expect(plain(content.blocks[1]?.paragraphs[0] ?? '')).toBe(
      'Le prestataire peut contester cet avoir jusqu’au 9 décembre 2026, 10 h 30 (heure de Paris). Sans contestation à cette date, il est réputé accepté, conformément au mandat de facturation.',
    );
    expect(content.mentions).toEqual({
      heading: 'Mentions du régime (reprises de la facture d’origine)',
      items: REGIME_MENTIONS,
    });
  });

  it('totals a negative amount as the credit note’s, with no annex', () => {
    expect(content.totals.map((one) => [one.label, plain(one.value), one.grand])).toEqual([
      ['Total HT', '-45,00 €', false],
      ['TVA', 'Autoliquidation', false],
      ['Montant de l’avoir', '-45,00 €', true],
    ]);
    expect(content.annex).toBeNull();
  });

  it('refuses a credit note that cites no invoice, or whose own mention is not first', () => {
    expect(() => invoicePdfContent(sampleCreditNote({ credited: null }))).toThrow(/cites no invoice/u);
    expect(() =>
      invoicePdfContent(
        sampleCreditNote({
          mentions: [...REGIME_MENTIONS, 'Avoir sur la facture AEX-2026-0021 du 17 novembre 2026'],
        }),
      ),
    ).toThrow(/mentions/u);
  });
});

describe('Équipe › Factures : ce que la facture rectificative imprime (ADR 0040)', () => {
  const content = invoicePdfContent(sampleCorrectiveInvoice());

  it('says it corrects an invoice, which it names with its day, for that invoice’s period, and falls due', () => {
    expect([content.heading, content.title]).toEqual([
      'Facture rectificative',
      'Facture rectificative AEX-2026-0025',
    ]);
    expect(content.meta.map((one) => [one.label, plain(one.value), one.strong])).toEqual([
      ['Numéro', 'AEX-2026-0025', true],
      ['Date d’émission', '2 décembre 2026', false],
      ['Facture rectifiée', 'AEX-2026-0021 du 17 novembre 2026', true],
      ['Période de la prestation', 'du 1er au 15 novembre 2026', false],
      ['Échéance', '31 janvier 2027', true],
    ]);
  });

  it('prints its frozen first mention in its object, keeps the regime of the invoice it replaces, and joins no annex', () => {
    expect(content.object.map((one) => plain(one.text))).toEqual([
      ` : ${SERVICE}`,
      'Facture rectificative de la facture AEX-2026-0021 du 17 novembre 2026, annulée par avoir. Elle en reprend la période, le régime de TVA et les mentions.',
      'Catégorie de l’opération : prestation de services.',
    ]);
    expect(content.mentions).toEqual({
      heading: 'Mentions du régime (reprises de la facture d’origine)',
      items: REGIME_MENTIONS,
    });
    expect(content.blocks.map((block) => block.heading)).toEqual(['Conditions de paiement', 'Acceptation']);
    expect(plain(content.blocks[0]?.paragraphs[0] ?? '')).toBe('Échéance : 31 janvier 2027.');
    expect(content.totals.map((one) => [one.label, plain(one.value), one.grand])).toEqual([
      ['Total HT', '930,96 €', false],
      ['TVA', 'Autoliquidation', false],
      ['Net à payer', '930,96 €', true],
    ]);
    expect(content.annex).toBeNull();
    expect(content.parties[0].lines.join(' ')).toContain('Lot 12, quartier Exemple');
  });

  it('refuses a corrective invoice whose first mention does not name the invoice it replaces, never printing half', () => {
    const terms = paymentTermsMention('2027-01-31', TERMS);
    for (const mentions of [
      [...REGIME_MENTIONS, terms],
      ['Facture rectificative de la facture AEX-2026-0020 du 17 novembre 2026', ...REGIME_MENTIONS, terms],
      [...REGIME_MENTIONS, 'Facture rectificative de la facture AEX-2026-0021 du 17 novembre 2026', terms],
    ]) {
      expect(() => invoicePdfContent(sampleCorrectiveInvoice({ mentions }))).toThrow(/mentions/u);
    }
  });
});

describe('Équipe › Factures : le pied d’une copie faite avant le lot 4', () => {
  it('prints the agency without legal form, capital nor register when its copy has none', () => {
    const content = invoicePdfContent(
      sampleInvoice({
        agency: {
          legalName: AGENCY.legalName,
          address: AGENCY.address,
          siren: AGENCY.siren,
          vatNumber: AGENCY.vatNumber,
        },
      }),
    );
    expect(content.footer).toBe(
      'Document établi par Agence Exemple SAS, 1 place Inventée, 69000 Lyon, mandataire de facturation du prestataire.',
    );
  });

  it('prints a capital to the cent when it is not whole euros, and a form without capital alone', () => {
    const cents = invoicePdfContent(sampleInvoice({ agency: { ...AGENCY, shareCapitalMinor: 100_050 } }));
    expect(plain(cents.footer)).toMatch(/· SAS au capital de 1 000,50 € ·/u);
    const formOnly = invoicePdfContent(
      sampleInvoice({ agency: { ...AGENCY, shareCapitalMinor: null, rcsCity: null } }),
    );
    expect(formOnly.footer).toBe(
      'Document établi par Agence Exemple SAS, 1 place Inventée, 69000 Lyon · SAS, mandataire de facturation du prestataire.',
    );
  });
});
