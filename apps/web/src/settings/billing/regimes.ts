import {
  CONTEST_DELAY_MAX_DAYS,
  CreateBillingRegimeBodySchema,
  CreateContractTextBodySchema,
  DEFAULT_CONTEST_DELAY_DAYS,
  INVOICE_MENTIONS_MAX,
  type BillingRegime,
  type ContractText,
  type ContractTextKind,
  type ContractorDocumentKind,
  type CreateBillingRegimeBody,
  type CreateContractTextBody,
  type RegimeVat,
  type Withholding,
} from '@impera/contracts';

import { countryName } from '@/lib/country';

/**
 * The regimes and the texts as Réglages › Facturation writes them (EQ-06 lot 8c), the pure part: the forms as typed,
 * the body they send, and the words of the page. A regime and a text are never changed once written: a new one is
 * written. The contract checks each body (`CreateBillingRegimeBodySchema`, `CreateContractTextBodySchema`); this says
 * its reasons sooner, in French, field by field.
 */

export type VatTreatment = RegimeVat['treatment'];

/** A regime as typed: text where a number is read, a list of countries and of mentions in their order. */
export interface RegimeDraft {
  readonly name: string;
  readonly countries: readonly string[];
  readonly vat: VatTreatment;
  readonly rate: string;
  readonly withholding: Withholding;
  readonly documents: readonly ContractorDocumentKind[];
  readonly taxIdRequired: boolean;
  readonly mentions: readonly string[];
}

export const EMPTY_REGIME: RegimeDraft = {
  name: '',
  countries: [],
  vat: 'reverse_charge',
  rate: '20',
  withholding: 'none',
  documents: [],
  taxIdRequired: false,
  mentions: [''],
};

/**
 * A choice of withholding, with what the contract asks of it: a regime whose tax treaty sets the withholding aside asks
 * for the tax residence certificate (the accountant's answer of 01/11), so choosing it ticks the certificate, and the
 * box stays ticked while the treaty is chosen.
 */
export function withWithholding(draft: RegimeDraft, withholding: Withholding): RegimeDraft {
  if (withholding !== 'treaty_exempt' || draft.documents.includes('tax_residence'))
    return { ...draft, withholding };
  return { ...draft, withholding, documents: ['tax_residence', ...draft.documents] };
}

/** Ticks or unticks a document, in the contract's order; the certificate stays while the treaty is chosen. */
export function withDocument(draft: RegimeDraft, kind: ContractorDocumentKind, asked: boolean): RegimeDraft {
  if (!asked && kind === 'tax_residence' && draft.withholding === 'treaty_exempt') return draft;
  const documents = asked
    ? [...new Set([...draft.documents, kind])]
    : draft.documents.filter((one) => one !== kind);
  const order: readonly ContractorDocumentKind[] = ['tax_residence', 'urssaf_vigilance'];
  return { ...draft, documents: order.filter((one) => documents.includes(one)) };
}

/**
 * The amber sentence of a regime without a treaty that asks for the certificate (Équipe's choice (a), 8c): the API lets
 * it through, and what it does is said, not refused.
 */
export const residenceWithoutTreatyText =
  'Sans convention, l’attestation de résidence fiscale ne bloque aucun versement : une facture part avec un avertissement tant qu’elle manque ou qu’elle est échue.';

export const showsResidenceWithoutTreaty = (
  regime: Pick<RegimeDraft, 'withholding' | 'documents'>,
): boolean => regime.withholding === 'none' && regime.documents.includes('tax_residence');

/** « 20 », « 5,5 »: a rate in percent, in basis points; `null` when it is not one from 0 to 100. */
export function rateBpsOf(text: string): number | null {
  const compact = text.replace(/[\s%]/gu, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/u.test(compact)) return null;
  const bps = Math.round(Number(compact) * 100);
  return bps <= 10_000 ? bps : null;
}

/** The fields of the regime's form, as the problems are said under them. */
export type RegimeField = 'name' | 'countries' | 'rate' | 'documents' | 'mentions';

function vatOf(draft: RegimeDraft): RegimeVat | null {
  if (draft.vat === 'exempt') return { treatment: 'exempt' };
  const rateBps = rateBpsOf(draft.rate);
  return rateBps === null ? null : { treatment: draft.vat, rateBps };
}

/** The body the form sends with its key, or what is wrong with each field. */
export function regimeBodyOf(
  draft: RegimeDraft,
  id: string,
):
  | { readonly ok: true; readonly body: CreateBillingRegimeBody }
  | { readonly ok: false; readonly problems: Partial<Record<RegimeField, string>> } {
  const problems: Partial<Record<RegimeField, string>> = {};
  const vat = vatOf(draft);
  if (vat === null) problems.rate = 'Un taux en pour cent, de 0 à 100, par exemple 20 ou 5,5.';
  const mentions = draft.mentions.map((one) => one.trim()).filter((one) => one !== '');
  const parsed = CreateBillingRegimeBodySchema.safeParse({
    id,
    name: draft.name,
    countries: draft.countries,
    vat: vat ?? { treatment: 'exempt' },
    withholding: draft.withholding,
    mentions,
    documents: draft.documents,
    taxIdRequired: draft.taxIdRequired,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name' && problems.name === undefined)
        problems.name = 'Un nom de 80 caractères au plus, celui que le comptable lui donne.';
      if (field === 'countries' && problems.countries === undefined)
        problems.countries = draft.countries.length === 0 ? 'Au moins un pays.' : issue.message;
      if (field === 'documents' && problems.documents === undefined) problems.documents = issue.message;
      if (field === 'mentions' && problems.mentions === undefined)
        problems.mentions = `Au plus ${String(INVOICE_MENTIONS_MAX)} mentions de 400 caractères chacune.`;
    }
  }
  if (!parsed.success || vat === null) return { ok: false, problems };
  return { ok: true, body: parsed.data };
}

const PERCENT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const percentText = (bps: number): string => `${PERCENT.format(bps / 100)}\u00a0%`;

/** How VAT goes on the regime's invoices, in a line. */
export function vatText(vat: RegimeVat): string {
  switch (vat.treatment) {
    case 'reverse_charge':
      return `Autoliquidée par l’agence, ${percentText(vat.rateBps)}`;
    case 'exempt':
      return 'Franchise en base : pas de TVA facturée';
    case 'charged':
      return `Facturée par le prestataire, ${percentText(vat.rateBps)}`;
  }
}

export const VAT_CHOICES: readonly {
  readonly value: VatTreatment;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'reverse_charge',
    label: 'Autoliquidée par l’agence',
    hint: 'Aucune TVA sur la facture : l’agence déclare et déduit la même TVA (art. 283-2 du CGI).',
  },
  {
    value: 'exempt',
    label: 'Franchise en base',
    hint: 'Le prestataire ne facture pas de TVA (art. 293 B du CGI).',
  },
  {
    value: 'charged',
    label: 'Facturée par le prestataire',
    hint: 'Le prestataire facture la TVA au taux du régime.',
  },
];

export const WITHHOLDING_TEXTS: Readonly<Record<Withholding, string>> = {
  treaty_exempt: 'Écartée par la convention fiscale',
  none: 'Pas due',
};

/** « Bénin, Madagascar »: a regime's countries by their French name. */
export const countriesText = (countries: readonly string[]): string =>
  countries.map((code) => countryName(code)).join(', ');

/** The regimes newest first, as the server gives them; the ones still to validate first among them. */
export const regimesToShow = (regimes: readonly BillingRegime[]): BillingRegime[] =>
  regimes.toSorted((a, b) => Number(a.validatedOn !== null) - Number(b.validatedOn !== null));

/** A text as typed: its body as pasted, never trimmed (its SHA-256 is the proof), and the mandate's delay. */
export interface TextDraft {
  readonly body: string;
  readonly contestDelayDays: string;
}

/** The latest version of a kind, `null` while there is none: the list comes newest first. */
export const latestOf = (texts: readonly ContractText[], kind: ContractTextKind): ContractText | null =>
  texts.find((one) => one.kind === kind) ?? null;

/** A new version starts empty, the mandate's delay that of the version it replaces (7 days without one). */
export const textDraftOf = (latest: ContractText | null): TextDraft => ({
  body: '',
  contestDelayDays: String(latest?.contestDelayDays ?? DEFAULT_CONTEST_DELAY_DAYS),
});

/** The body a new version sends with its key, or what is wrong with it. */
export function textBodyOf(
  kind: ContractTextKind,
  draft: TextDraft,
  id: string,
):
  | { readonly ok: true; readonly body: CreateContractTextBody }
  | { readonly ok: false; readonly problems: Partial<Record<keyof TextDraft, string>> } {
  const delay = Number(draft.contestDelayDays.trim());
  const parsed = CreateContractTextBodySchema.safeParse(
    kind === 'billing_mandate'
      ? { id, kind, body: draft.body, contestDelayDays: draft.contestDelayDays.trim() === '' ? null : delay }
      : { id, kind, body: draft.body },
  );
  if (parsed.success) return { ok: true, body: parsed.data };
  const problems: Partial<Record<keyof TextDraft, string>> = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === 'body' && problems.body === undefined)
      problems.body =
        draft.body.trim() === ''
          ? 'Colle le texte validé par ton comptable.'
          : 'Un texte de 100 000 caractères au plus.';
    if (issue.path[0] === 'contestDelayDays' && problems.contestDelayDays === undefined)
      problems.contestDelayDays = `Un nombre entier de jours, de 1 à ${String(CONTEST_DELAY_MAX_DAYS)}.`;
  }
  return { ok: false, problems };
}

/** The texts' names as Réglages says them: what each is for. */
export const TEXT_LEADS: Readonly<Record<ContractTextKind, string>> = {
  service_contract:
    'Ce que l’agence et chaque prestataire s’engagent à faire. Il l’accepte dans Moi › Dossier.',
  billing_mandate:
    'Le mandat qui permet à l’agence d’émettre les factures au nom de chaque prestataire, et son délai de contestation. Sans mandat accepté, aucune facture ne part.',
};
