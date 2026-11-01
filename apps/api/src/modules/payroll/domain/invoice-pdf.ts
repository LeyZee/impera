import {
  addressLines,
  INVOICE_RETENTION_YEARS,
  invoiceFooterOf,
  PLATFORM_NAMES,
  type Currency,
  type InvoiceAgency,
  type InvoiceContractor,
  type InvoiceKind,
  type InvoiceLineKind,
  type PayPeriod,
  type Platform,
  type RegimeVat,
} from '@nirvana/contracts';

import { longDay, periodWords } from './invoices';

/**
 * The PDF of an invoice or a credit note (EQ-06 lot 4, ADR 0037), the pure part: where it lies, how long its lock
 * holds, and every word it prints, as a sober French invoice an accountant files without a second look. The layout,
 * the font and the bytes are the renderer's (infra); the text is decided here, from the document's frozen copy only,
 * so that the same document always prints the same text.
 *
 * It is a self-billed document (art. 289 I-2 of the CGI): the contractor is the seller, the agency the buyer, which
 * drafts it in their name under their billing mandate. The code composes what says so (the badge, the sentence « établie
 * par … au nom et pour le compte de … », the two parties' labels), the VAT line and the payment, set-off and
 * acceptance blocks; the regime's mentions print as frozen, in their order, under their own heading. A regime's text
 * therefore never repeats any of those (a rule of the regime's help, lot 8).
 */

/** The key of a PDF in both buckets: the year of issue and the document's id, never a name nor a number. */
export function invoicePdfKey(invoiceId: string, issuedOn: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(issuedOn)) throw new RangeError(`Not a calendar day: ${issuedOn}`);
  return `invoices/${issuedOn.slice(0, 4)}/${invoiceId}.pdf`;
}

/**
 * Until when the compliance lock holds a PDF: ten years after the close of the fiscal year of its issue (art. L123-22
 * of the Code de commerce, ADR 0037 § 4). The fiscal year closes on the last day of `fiscalYearEndMonth`; the lock ends
 * at 00:00 UTC the day after that close, ten years on, which is after the close's end in Paris. An invoice of March
 * 2027 under a calendar year: 1 January 2038 at 00:00 UTC, that is through 31 December 2037.
 */
export function invoicePdfRetainUntil(issuedOn: string, fiscalYearEndMonth: number): Date {
  if (!Number.isInteger(fiscalYearEndMonth) || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12) {
    throw new RangeError(`Not a month: ${String(fiscalYearEndMonth)}`);
  }
  const year = Number(issuedOn.slice(0, 4));
  const month = Number(issuedOn.slice(5, 7));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(issuedOn) || month < 1 || month > 12) {
    throw new RangeError(`Not a calendar day: ${issuedOn}`);
  }
  const closeYear = month <= fiscalYearEndMonth ? year : year + 1;
  // Months count from 0 here: month `fiscalYearEndMonth` (from 0) is the one after the close.
  return new Date(Date.UTC(closeYear + INVOICE_RETENTION_YEARS, fiscalYearEndMonth, 1));
}

/** A document as its PDF prints it: its frozen copy, with what the base keeps beside it. */
export interface PdfDocumentSource {
  readonly kind: InvoiceKind;
  readonly number: string;
  readonly issuedOn: string;
  /** Printed on an invoice only: a credit note is set off, nothing falls due on it. */
  readonly dueOn: string;
  readonly period: PayPeriod;
  readonly contractor: InvoiceContractor;
  readonly agency: InvoiceAgency;
  readonly vat: RegimeVat;
  /** The mentions of the regime as the document's copy of it froze them. */
  readonly regimeMentions: readonly string[];
  /**
   * Every mention frozen on the document: an invoice's are its regime's then its payment terms; a credit note's are
   * the invoice it cites then that invoice's regime's (lot 3).
   */
  readonly mentions: readonly string[];
  /** An invoice's designation of the service, frozen at its issue; `null` on a credit note. */
  readonly serviceDescription: string | null;
  /** The day the contractor accepted the billing mandate in force at the issue, in the agency's time zone. */
  readonly mandateAcceptedOn: string;
  /** Until when the contractor may contest the document (lot 3), and the agency's time zone that prints it. */
  readonly acceptanceDeadline: Date;
  readonly timeZone: string;
  readonly lines: readonly {
    readonly kind: InvoiceLineKind;
    readonly label: string;
    readonly detail: string | null;
    readonly amountMinor: number;
  }[];
  /** Never the VAT the agency self-assesses under reverse charge: it is no amount of this document. */
  readonly totals: {
    readonly exclVatMinor: number;
    readonly vatMinor: number;
    readonly inclVatMinor: number;
  };
  /** The invoice a credit note cites, `null` for an invoice. */
  readonly credited: { readonly number: string; readonly issuedOn: string } | null;
  /** The statement an invoice bills, printed in an annex; `null` for a credit note. */
  readonly annex: StatementAnnexSource | null;
}

/**
 * What the annex prints of the validated statement an invoice bills: the base of each commission, one row per account
 * and rules (currency, VAT, platform fee) as the statement's revision holds them, never a fan.
 */
export interface StatementAnnexSource {
  /** The day the statement was validated, in the agency's time zone. */
  readonly validatedOn: string;
  readonly commissionRateBps: number;
  readonly accounts: readonly {
    readonly handle: string;
    readonly platform: Platform;
    readonly currency: Currency;
    /** The ECB rate the gross was converted at, in millionths of a euro per unit (ADR 0033); 1 000 000 for euros. */
    readonly rateMicros: number;
    /** The day of that rate, as the statement copied it; `null` for euros. */
    readonly rateOn: string | null;
    readonly grossMinor: number;
    readonly grossEurMinor: number;
    readonly exclVatMinor: number;
    readonly netMinor: number;
    readonly commissionMinor: number;
  }[];
}

/** One cell of a table, its text and how it aligns. */
export interface PdfCell {
  readonly text: string;
  readonly align: 'left' | 'right';
}

/** A party's box: its label above, its name, its address lines, then its identifiers. */
export interface PdfParty {
  readonly label: string;
  readonly name: string;
  readonly lines: readonly string[];
  readonly ids: readonly { readonly label: string; readonly value: string }[];
}

/** A paragraph that may open on a word set in bold (« Objet »). */
interface PdfParagraph {
  readonly lead: string | null;
  readonly text: string;
}

/** What a PDF prints, in order: the renderer lays it out and adds the page numbers. */
export interface InvoicePdfContent {
  /** The PDF's title in its metadata: « Facture LEA-2026-0001 ». Only the number varies, never a name. */
  readonly title: string;
  readonly number: string;
  /** « Facture » or « Avoir », the page's title. */
  readonly heading: string;
  /** Under the title: « Autofacturation ». */
  readonly badge: string;
  /** Printed in place of the logo when the agency set none. */
  readonly agencyName: string;
  /** Under the logo: who drafts the document, in whose name, under which mandate. */
  readonly brandNote: string;
  readonly meta: readonly { readonly label: string; readonly value: string; readonly strong: boolean }[];
  readonly parties: readonly [PdfParty, PdfParty];
  readonly object: readonly PdfParagraph[];
  readonly lines: {
    readonly header: readonly [string, string];
    readonly rows: readonly {
      readonly label: string;
      readonly detail: string | null;
      readonly amount: string;
    }[];
  };
  /** Beside the totals: the VAT treatment, in the code's words, then the currency. */
  readonly vatNote: { readonly lead: string; readonly text: string; readonly currency: string };
  readonly totals: readonly {
    readonly label: string;
    readonly value: string;
    readonly muted: boolean;
    readonly grand: boolean;
  }[];
  readonly blocks: readonly { readonly heading: string; readonly paragraphs: readonly string[] }[];
  /** The regime's mentions, as frozen; `null` for a regime without any. */
  readonly mentions: { readonly heading: string; readonly items: readonly string[] } | null;
  /** At the foot of every page, before « N · Page x/y »: the agency, its legal form and register, its role. */
  readonly footer: string;
  /** At the head of a page the lines spill onto: « Facture AEX-2026-0021 (suite) ». */
  readonly continued: string;
  readonly annex: {
    readonly ref: readonly [string, string, string];
    readonly heading: string;
    readonly subheading: string;
    readonly accounts: {
      readonly header: readonly PdfCell[];
      readonly rows: readonly { readonly cells: readonly PdfCell[]; readonly detail: string | null }[];
      readonly total: readonly PdfCell[];
    };
    readonly elements: {
      readonly header: readonly PdfCell[];
      readonly rows: readonly (readonly PdfCell[])[];
      readonly total: readonly PdfCell[];
    };
    readonly note: string;
  } | null;
}

/** « : » as French sets it, after a space that never breaks. */
const COLON = '\u00a0: ';
const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });
const RATE = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const COUNTRIES = new Intl.DisplayNames(['fr'], { type: 'region' });

/** The tax identifier's name in the countries the team works from; elsewhere, « Identifiant fiscal ». */
const TAX_ID_NAMES: Readonly<Record<string, string>> = { BJ: 'IFU', MG: 'NIF' };

/** What the regime's VAT treatment prints beside the totals, in the code's words (never a regime's text). */
const VAT_WORDS = {
  reverse_charge: {
    lead: 'Autoliquidation',
    text: 'TVA due par le preneur (art. 283-2 du CGI). Aucune TVA n’est facturée.',
  },
  exempt: { lead: 'TVA non applicable, art. 293 B du CGI', text: 'Aucune TVA n’est facturée.' },
} as const;

/** The annex's name for each kind of line, in the order the invoice prints them. */
const ELEMENT_NAMES: Readonly<Record<InvoiceLineKind, string>> = {
  commission: 'Commissions',
  team_share: 'Part d’équipe',
  tier_bonus: 'Prime de palier',
  collective_bonus: 'Prime d’objectif collectif',
  bonus: 'Primes',
  penalty: 'Réfactions prévues au contrat',
  penalty_cap: 'Plafond des réfactions',
  adjustment: 'Régularisations',
  reduction: 'Réductions',
  negative_period: 'Solde négatif de la période',
};

/** An amount in euros, French style: « 1 234,56 € », a narrow no-break space between thousands. */
function pdfEuros(minor: number): string {
  return EUROS.format(minor / 100);
}

const percent = (bps: number): string => PERCENT.format(bps / 10_000);

function inCurrency(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(minor / 100);
}

/** « 1 $US = 0,923456 € (cours BCE du 14 novembre 2026) »: what one unit was worth, and on which day. */
function rateWords(currency: Currency, rateMicros: number, rateOn: string | null): string {
  if (rateOn === null) throw new Error(`The rate of ${currency} has no day`);
  const one = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(1);
  return `${one} = ${RATE.format(rateMicros / 1_000_000)}\u00a0€ (cours BCE du ${longDay(rateOn)})`;
}

const countryName = (code: string): string => COUNTRIES.of(code) ?? code;

/** The address, then the country, unless the address already ends with it. */
function placeLines(address: string, country: string): string[] {
  const lines = addressLines(address);
  const name = countryName(country);
  const last = lines.at(-1)?.toLocaleLowerCase('fr') ?? '';
  return last.endsWith(name.toLocaleLowerCase('fr')) ? lines : [...lines, name];
}

/** A SIREN « 912 345 678 », a SIRET « 912 345 678 00011 », in groups that never break apart. */
function businessIdWords(id: string): { readonly label: string; readonly value: string } {
  const groups = id.length === 14 ? [id.slice(0, 3), id.slice(3, 6), id.slice(6, 9), id.slice(9)] : null;
  return groups === null
    ? { label: 'SIREN', value: [id.slice(0, 3), id.slice(3, 6), id.slice(6)].join('\u00a0') }
    : { label: 'SIRET', value: groups.join('\u00a0') };
}

const isBusinessId = (value: string): boolean => /^(\d{9}|\d{14})$/u.test(value);

/** The contractor's name, with « EI » after it when they are an individual entrepreneur (art. R526-27 C. com.). */
function contractorName(contractor: InvoiceContractor): string {
  const name = contractor.legalName;
  return contractor.individualEntrepreneur === true && !/(^|\s)EI$/u.test(name) ? `${name} EI` : name;
}

/**
 * « de Basile », « d’Awa »: the elision French makes before a vowel, and before a Y read as one (« d’Yves », but « de
 * Yao »). Never before an H, which may be aspirated.
 */
function ofName(name: string): string {
  return /^([aeiouàâäéèêëîïôöùûüæœ]|y[^aeiouàâäéèêëîïôöùûü])/iu.test(name) ? `d’${name}` : `de ${name}`;
}

function contractorParty(contractor: InvoiceContractor): PdfParty {
  const ids: { label: string; value: string }[] = [];
  const businessId = contractor.businessId ?? null;
  if (businessId !== null) ids.push(businessIdWords(businessId));
  if (contractor.vatNumber !== undefined && contractor.vatNumber !== null) {
    ids.push({ label: 'TVA intracommunautaire', value: contractor.vatNumber });
  }
  const taxId = contractor.taxId;
  if (taxId !== null && taxId !== businessId) {
    // A copy made before lot 4 kept a French contractor's SIREN or SIRET here.
    ids.push(
      contractor.country === 'FR' && isBusinessId(taxId)
        ? businessIdWords(taxId)
        : { label: TAX_ID_NAMES[contractor.country] ?? 'Identifiant fiscal', value: taxId },
    );
  }
  return {
    label: 'Prestataire (fournisseur)',
    name: contractorName(contractor),
    lines: placeLines(contractor.address, contractor.country),
    ids,
  };
}

function agencyParty(agency: InvoiceAgency): PdfParty {
  return {
    label: 'Client (preneur)',
    name: agency.legalName,
    // A SIREN is French: the agency is established in France.
    lines: placeLines(agency.address, 'FR'),
    ids: [businessIdWords(agency.siren), { label: 'TVA intracommunautaire', value: agency.vatNumber }],
  };
}

/** « 24 novembre 2026, 10 h 30 (heure de Paris) »: a deadline is an instant, printed where the agency is. */
function momentWords(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const place = timeZone.includes('/')
    ? (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ')
    : timeZone;
  return `${longDay(day)}, ${String(Number(part('hour')))}\u00a0h\u00a0${part('minute')} (heure de ${place})`;
}

/**
 * The document's mentions, split as lot 3 froze them: the regime's, and its own (an invoice's payment terms, the
 * invoice a credit note cites). Any other shape is a fault, never printed half: the job fails and alerts.
 */
function ownMention(source: PdfDocumentSource): string {
  const regime = source.regimeMentions;
  const all = source.mentions;
  const own = source.kind === 'invoice' ? all.at(-1) : all[0];
  const rest = source.kind === 'invoice' ? all.slice(0, -1) : all.slice(1);
  if (
    own === undefined ||
    rest.length !== regime.length ||
    rest.some((mention, index) => mention !== regime[index])
  ) {
    throw new Error(`The mentions of ${source.number} are not its regime’s and its own`);
  }
  return own;
}

/**
 * The payment terms an invoice froze (`Échéance : <jour>. <conditions>`, lot 3), word for word: the due date on its
 * own line, then each line of the agency's conditions.
 */
function termsParagraphs(terms: string): string[] {
  const end = terms.indexOf('. ');
  const first = end === -1 ? terms : terms.slice(0, end + 1);
  const rest = end === -1 ? '' : terms.slice(end + 2);
  return [first, ...addressLines(rest)];
}

function vatOf(source: PdfDocumentSource): Pick<InvoicePdfContent, 'vatNote' | 'totals'> {
  const currency = 'Montants exprimés en euros (EUR).';
  const isInvoice = source.kind === 'invoice';
  const { vat, totals } = source;
  const exclVat = { label: 'Total HT', value: pdfEuros(totals.exclVatMinor), muted: false, grand: false };
  if (vat.treatment === 'charged') {
    const rate = percent(vat.rateBps);
    return {
      vatNote: { lead: `TVA à ${rate}`, text: 'facturée par le prestataire sur le total HT.', currency },
      totals: [
        exclVat,
        { label: `TVA à ${rate}`, value: pdfEuros(totals.vatMinor), muted: false, grand: false },
        {
          label: isInvoice ? 'Net à payer TTC' : 'Montant de l’avoir TTC',
          value: pdfEuros(totals.inclVatMinor),
          muted: false,
          grand: true,
        },
      ],
    };
  }
  const words = VAT_WORDS[vat.treatment];
  return {
    vatNote: { ...words, currency },
    totals: [
      exclVat,
      {
        label: 'TVA',
        value: vat.treatment === 'reverse_charge' ? 'Autoliquidation' : 'Non applicable',
        muted: true,
        grand: false,
      },
      {
        label: isInvoice ? 'Net à payer' : 'Montant de l’avoir',
        value: pdfEuros(totals.inclVatMinor),
        muted: false,
        grand: true,
      },
    ],
  };
}

/**
 * What the PDF of `source` prints. An invoice bills a period and falls due; a credit note cites its invoice, keeps
 * its regime and mentions (ADR 0036) and is set off, so it prints no due date. Every amount is excluding VAT on the
 * lines, then the totals; the VAT is the frozen one, and never the VAT the agency self-assesses (which would read as
 * owed to the contractor).
 */
export function invoicePdfContent(source: PdfDocumentSource): InvoicePdfContent {
  const isInvoice = source.kind === 'invoice';
  const heading = isInvoice ? 'Facture' : 'Avoir';
  const own = ownMention(source);
  const contractor = contractorParty(source.contractor);
  const deadline = momentWords(source.acceptanceDeadline, source.timeZone);

  const meta: { label: string; value: string; strong: boolean }[] = [
    { label: 'Numéro', value: source.number, strong: true },
    { label: 'Date d’émission', value: longDay(source.issuedOn), strong: false },
  ];
  if (isInvoice) {
    meta.push(
      { label: 'Période de la prestation', value: periodWords(source.period), strong: false },
      { label: 'Échéance', value: longDay(source.dueOn), strong: true },
    );
  } else {
    if (source.credited === null) throw new Error(`The credit note ${source.number} cites no invoice`);
    meta.push(
      {
        label: 'Facture d’origine',
        value: `${source.credited.number} du ${longDay(source.credited.issuedOn)}`,
        strong: true,
      },
      { label: 'Période corrigée', value: periodWords(source.period), strong: false },
    );
  }

  const category = `Catégorie de l’opération${COLON}prestation de services.`;
  const object: PdfParagraph[] = isInvoice
    ? [
        { lead: 'Objet', text: `${COLON}${source.serviceDescription ?? 'prestation de services'}` },
        {
          lead: null,
          text: source.annex === null ? category : `${category} Relevé de commissions joint en annexe.`,
        },
      ]
    : [
        { lead: 'Objet', text: `${COLON}${own}. Il en reprend le régime de TVA et les mentions.` },
        { lead: null, text: category },
      ];

  const acceptance = isInvoice
    ? `Le prestataire peut contester cette facture jusqu’au ${deadline}. Sans contestation à cette date, elle est réputée acceptée, conformément au mandat de facturation.`
    : `Le prestataire peut contester cet avoir jusqu’au ${deadline}. Sans contestation à cette date, il est réputé accepté, conformément au mandat de facturation.`;
  const blocks = [
    isInvoice
      ? { heading: 'Conditions de paiement', paragraphs: termsParagraphs(own) }
      : {
          heading: 'Imputation',
          paragraphs: [
            `Cet avoir ne donne lieu à aucun paiement${COLON}il s’impute sur un prochain versement au prestataire. Il n’a pas d’échéance.`,
          ],
        },
    { heading: 'Acceptation', paragraphs: [acceptance] },
  ];

  return {
    title: `${heading} ${source.number}`,
    number: source.number,
    heading,
    badge: 'Autofacturation',
    agencyName: source.agency.legalName,
    brandNote: `${isInvoice ? 'Facture établie' : 'Avoir établi'} par ${source.agency.legalName} au nom et pour le compte ${ofName(contractor.name)}, en vertu du mandat de facturation accepté le ${longDay(source.mandateAcceptedOn)}.`,
    meta,
    parties: [contractor, agencyParty(source.agency)],
    object,
    lines: {
      header: ['Désignation', 'Montant HT'],
      rows: source.lines.map((line) => ({
        label: line.label,
        detail: line.detail,
        amount: pdfEuros(line.amountMinor),
      })),
    },
    ...vatOf(source),
    blocks,
    mentions:
      source.regimeMentions.length === 0
        ? null
        : {
            heading: isInvoice
              ? 'Mentions du régime'
              : 'Mentions du régime (reprises de la facture d’origine)',
            items: source.regimeMentions,
          },
    footer: invoiceFooterOf(source.agency),
    continued: `${heading} ${source.number} (suite)`,
    annex: source.annex === null ? null : annexContent(source, source.annex, contractor.name),
  };
}

const left = (text: string): PdfCell => ({ text, align: 'left' });
const right = (text: string): PdfCell => ({ text, align: 'right' });
const sum = (amounts: readonly number[]): number => amounts.reduce((total, one) => total + one, 0);

/**
 * The annex: the validated statement by account (sales, VAT when any, the platform's fee, net, rate, commission), then
 * the invoice's lines by kind, which add up to the amount invoiced, and what a carry-over does and does not change.
 */
function annexContent(
  source: PdfDocumentSource,
  annex: StatementAnnexSource,
  contractorName: string,
): NonNullable<InvoicePdfContent['annex']> {
  const withVat = annex.accounts.some((account) => account.exclVatMinor !== account.grossEurMinor);
  const rate = percent(annex.commissionRateBps);
  const header = [
    left('Compte'),
    right('Ventes brutes'),
    ...(withVat ? [right('TVA')] : []),
    right('Commission plateforme'),
    right('Net'),
    right('Taux'),
    right('Commission'),
  ];
  const rows = annex.accounts.map((account) => ({
    cells: [
      left(`@${account.handle} · ${PLATFORM_NAMES[account.platform]}`),
      right(pdfEuros(account.grossEurMinor)),
      ...(withVat ? [right(pdfEuros(account.exclVatMinor - account.grossEurMinor))] : []),
      right(pdfEuros(account.netMinor - account.exclVatMinor)),
      right(pdfEuros(account.netMinor)),
      right(rate),
      right(pdfEuros(account.commissionMinor)),
    ],
    detail:
      account.currency === 'EUR'
        ? null
        : `${inCurrency(account.grossMinor, account.currency)} convertis à ${rateWords(account.currency, account.rateMicros, account.rateOn)}`,
  }));
  const total = (pick: (account: StatementAnnexSource['accounts'][number]) => number): string =>
    pdfEuros(sum(annex.accounts.map(pick)));
  const kinds: InvoiceLineKind[] = [];
  for (const line of source.lines) if (!kinds.includes(line.kind)) kinds.push(line.kind);
  const byKind = kinds.map((kind) => [
    left(ELEMENT_NAMES[kind]),
    right(pdfEuros(sum(source.lines.filter((line) => line.kind === kind).map((line) => line.amountMinor)))),
  ]);
  // The annex explains the invoice, never another one: its commissions are the invoice's, its lines its total.
  if (sum(source.lines.map((line) => line.amountMinor)) !== source.totals.exclVatMinor) {
    throw new Error(`The lines of ${source.number} do not add up to its total`);
  }
  const commissions = source.lines
    .filter((line) => line.kind === 'commission')
    .map((line) => line.amountMinor);
  if (sum(annex.accounts.map((account) => account.commissionMinor)) !== sum(commissions)) {
    throw new Error(`The statement of ${source.number} does not give its commissions`);
  }
  return {
    ref: ['Annexe de la facture', source.number, `du ${longDay(source.issuedOn)}`],
    heading: 'Relevé de commissions',
    subheading: `${contractorName} · période ${periodWords(source.period)} · relevé validé le ${longDay(annex.validatedOn)}`,
    accounts: {
      header,
      rows,
      total: [
        left('Total des comptes'),
        right(total((account) => account.grossEurMinor)),
        ...(withVat ? [right(total((account) => account.exclVatMinor - account.grossEurMinor))] : []),
        right(total((account) => account.netMinor - account.exclVatMinor)),
        right(total((account) => account.netMinor)),
        right(''),
        right(total((account) => account.commissionMinor)),
      ],
    },
    elements: {
      header: [left('Élément'), right('Montant')],
      rows: byKind,
      total: [
        left(`Montant facturé (facture ${source.number})`),
        right(pdfEuros(source.totals.exclVatMinor)),
      ],
    },
    note: `Le relevé détaille le calcul de la facture\u00a0; il n’en change aucun montant. Un report éventuel décale le versement, jamais la facturation${COLON}la somme facturée reste due à l’échéance. Ventes par compte de plateforme, jamais par client final.`,
  };
}
