import {
  AGENCY_LEGAL_FORM_MAX,
  AGENCY_LOGO_MAX_BYTES,
  AGENCY_LOGO_MAX_SIDE,
  AGENCY_LOGO_MIN_SIDE,
  AGENCY_LOGO_SHARP_HEIGHT,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  DEFAULT_INVOICE_DUE_DAYS,
  INVOICE_DUE_MAX_DAYS,
  INVOICE_DUE_MIN_DAYS,
  LEGAL_NAME_MAX,
  PAYMENT_TERMS_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  SERVICE_DESCRIPTION_MAX,
  UpdateBillingSettingsBodySchema,
  VAT_NUMBER_PATTERN,
  frenchVatNumberOf,
  sirenChecksOut,
  type AgencyLogo,
  type AgencyLogoRefusal,
  type BillingSettings,
  type UpdateBillingSettingsBody,
} from '@nirvana/contracts';

/**
 * Réglages › Facturation, the pure part: the form as the owner types it, what is wrong with it, the body it sends, and
 * the words of the page. The server checks everything again (`UpdateBillingSettingsBodySchema`); this only says it
 * sooner, in French, field by field.
 */

/** The steps of the form, in order: the first filling walks them all, a card's « Changer » only its own. */
export type StepKey = 'agency' | 'registration' | 'service' | 'payment' | 'logo';

export const STEP_TITLES: Readonly<Record<StepKey, string>> = {
  agency: 'L’agence',
  registration: 'Immatriculation',
  service: 'Prestation',
  payment: 'Paiement',
  logo: 'Logo',
};

export const ALL_STEPS: readonly StepKey[] = ['agency', 'registration', 'service', 'payment', 'logo'];

/** The form as typed: text everywhere, read into numbers only when sent. */
export interface BillingDraft {
  readonly legalName: string;
  readonly legalForm: string;
  readonly shareCapital: string;
  readonly address: string;
  readonly siren: string;
  readonly rcsCity: string;
  readonly vatNumber: string;
  readonly fiscalYearEndMonth: string;
  readonly serviceDescription: string;
  readonly paymentTerms: string;
  readonly dueDays: string;
  readonly logoSha256: string | null;
}

export type DraftField = Exclude<keyof BillingDraft, 'logoSha256'>;

/** The fields each step shows; the logo step has none (it sends the file itself, at once). */
export const FIELDS_OF: Readonly<Record<StepKey, readonly DraftField[]>> = {
  agency: ['legalName', 'legalForm', 'shareCapital', 'address'],
  registration: ['siren', 'rcsCity', 'vatNumber', 'fiscalYearEndMonth'],
  service: ['serviceDescription'],
  payment: ['dueDays', 'paymentTerms'],
  logo: [],
};

/** « 10000 », « 10000,50 »: an amount in euros as its field shows it back. */
export function eurosInput(minor: number): string {
  const cents = minor % 100;
  const euros = String(Math.trunc(minor / 100));
  return cents === 0 ? euros : `${euros},${String(cents).padStart(2, '0')}`;
}

/** The form from the settings saved, or empty with the defaults (60 days, a fiscal year closed in December). */
export function draftOf(settings: BillingSettings | null): BillingDraft {
  const agency = settings?.agency;
  const capital = agency?.shareCapitalMinor ?? null;
  return {
    legalName: agency?.legalName ?? '',
    legalForm: agency?.legalForm ?? '',
    shareCapital: capital === null ? '' : eurosInput(capital),
    address: agency?.address ?? '',
    siren: agency?.siren ?? '',
    rcsCity: agency?.rcsCity ?? '',
    vatNumber: agency?.vatNumber ?? '',
    fiscalYearEndMonth: String(settings?.fiscalYearEndMonth ?? DEFAULT_FISCAL_YEAR_END_MONTH),
    serviceDescription: settings?.serviceDescription ?? '',
    paymentTerms: settings?.paymentTerms ?? '',
    dueDays: String(settings?.dueDays ?? DEFAULT_INVOICE_DUE_DAYS),
    logoSha256: settings?.logoSha256 ?? null,
  };
}

/** « 10 000 », « 10000,50 », « 1 000 € »: an amount in euros, in cents; `null` when it is not one, or not above 0. */
export function parseEuros(text: string): number | null {
  const compact = text.replace(/[\s€]/gu, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/u.test(compact)) return null;
  const [euros = '0', cents = ''] = compact.split('.');
  const minor = Number(euros) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** « 123 456 789 », « 123.456.789 »: the digits alone. */
const digitsOf = (text: string): string => text.replace(/[\s.]/gu, '');

/**
 * Whether a text is a SIREN, as the owner types it: nine digits carrying their check key (`sirenChecksOut`, the
 * server's rule). A typo is said here, before an accountant finds it on an invoice.
 */
export const isSiren = (text: string): boolean => sirenChecksOut(digitsOf(text));

/** The French VAT number of a SIREN as the owner types it (`frenchVatNumberOf`, the server's rule). */
export const vatOfSiren = (siren: string): string => frenchVatNumberOf(digitsOf(siren));

/** « fr 12 123 456 789 » → « FR12123456789 ». */
const vatOf = (text: string): string => text.replace(/[\s.-]/gu, '').toUpperCase();
const VAT_NUMBER = new RegExp(VAT_NUMBER_PATTERN, 'u');

/**
 * The VAT number the SIREN gives, offered while the field holds another one or none: a company with a SIREN has
 * that French number and no other, which the server checks too; `null` once it is there, or without a SIREN.
 */
export function suggestedVat(draft: BillingDraft): string | null {
  if (!isSiren(draft.siren)) return null;
  const computed = vatOfSiren(draft.siren);
  return vatOf(draft.vatNumber) === computed ? null : computed;
}

/** Whole days within the bounds of the due date, or `null`. */
function dueDaysOf(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' &&
    Number.isInteger(value) &&
    value >= INVOICE_DUE_MIN_DAYS &&
    value <= INVOICE_DUE_MAX_DAYS
    ? value
    : null;
}

const filled = (text: string, max: number): boolean => text.trim() !== '' && text.trim().length <= max;

/** What is wrong with each field among `fields`, in the words the field says under it. */
export function problemsOf(
  draft: BillingDraft,
  fields: readonly DraftField[],
): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  const check = (field: DraftField, ok: boolean, message: string): void => {
    if (fields.includes(field) && !ok && problems[field] === undefined) problems[field] = message;
  };
  check('legalName', filled(draft.legalName, LEGAL_NAME_MAX), 'La raison sociale, telle que sur le Kbis.');
  check(
    'legalForm',
    filled(draft.legalForm, AGENCY_LEGAL_FORM_MAX),
    'La forme juridique, par exemple SAS ou SARL.',
  );
  check(
    'shareCapital',
    parseEuros(draft.shareCapital) !== null,
    'Le capital social en euros, par exemple 1\u00a0000.',
  );
  check(
    'address',
    filled(draft.address, POSTAL_ADDRESS_MAX),
    'L’adresse du siège, sur une ou plusieurs lignes.',
  );
  check('siren', isSiren(draft.siren), 'Neuf chiffres, ceux du Kbis : ceux-ci ne forment pas un SIREN.');
  check('rcsCity', filled(draft.rcsCity, RCS_CITY_MAX), 'La ville du greffe, comme sur le Kbis.');
  const vat = vatOf(draft.vatNumber);
  check('vatNumber', VAT_NUMBER.test(vat), 'FR, deux chiffres puis le SIREN, comme sur les avis de TVA.');
  check(
    'vatNumber',
    !isSiren(draft.siren) || vat === vatOfSiren(draft.siren),
    `Le numéro de TVA de ce SIREN est ${vatOfSiren(draft.siren)} : vérifie l’un ou l’autre.`,
  );
  check(
    'serviceDescription',
    filled(draft.serviceDescription, SERVICE_DESCRIPTION_MAX),
    'Ce que chaque facture dit avoir été fourni, validé par ton comptable.',
  );
  check(
    'paymentTerms',
    filled(draft.paymentTerms, PAYMENT_TERMS_MAX),
    'Les conditions de paiement que ton comptable a validées.',
  );
  check(
    'dueDays',
    dueDaysOf(draft.dueDays) !== null,
    `Un nombre entier de jours, de ${String(INVOICE_DUE_MIN_DAYS)} à ${String(INVOICE_DUE_MAX_DAYS)}.`,
  );
  return problems;
}

/** The steps whose fields are wrong, in their order: a card opens them too, so that nothing blocks its save. */
export const wrongSteps = (draft: BillingDraft): readonly StepKey[] =>
  ALL_STEPS.filter((step) => Object.keys(problemsOf(draft, FIELDS_OF[step])).length > 0);

/** The body the form sends, or `null` while a field is wrong. */
export function bodyOf(draft: BillingDraft): UpdateBillingSettingsBody | null {
  if (wrongSteps(draft).length > 0) return null;
  const parsed = UpdateBillingSettingsBodySchema.safeParse({
    agency: {
      legalName: draft.legalName,
      address: draft.address,
      siren: digitsOf(draft.siren),
      vatNumber: vatOf(draft.vatNumber),
      legalForm: draft.legalForm,
      shareCapitalMinor: parseEuros(draft.shareCapital),
      rcsCity: draft.rcsCity,
    },
    serviceDescription: draft.serviceDescription,
    paymentTerms: draft.paymentTerms,
    dueDays: dueDaysOf(draft.dueDays),
    fiscalYearEndMonth: Number(draft.fiscalYearEndMonth),
    logoSha256: draft.logoSha256,
  });
  return parsed.success ? parsed.data : null;
}

export const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const LAST_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** « 31 décembre », « Fin février »: a month the fiscal year may close on, as its choice reads. */
export function closeChoiceText(month: number): string {
  const name = MONTHS[month - 1] ?? MONTHS[11];
  return month === 2 ? `Fin ${name}` : `${String(LAST_DAYS[month - 1] ?? 31)} ${name}`;
}

/** « 433 Ko », « 1,2 Mo »: a file's weight, the number and its unit never broken apart. */
export function weightText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))}\u00a0Ko`;
  return `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u00a0Mo`;
}

const SIDE = new Intl.NumberFormat('fr-FR');

/** What the logo step asks for, its weight from the limit the server keeps (`AGENCY_LOGO_MAX_BYTES`). */
export const LOGO_HINT = `Un PNG à fond transparent, ${weightText(AGENCY_LOGO_MAX_BYTES)} au plus : 1\u00a0000 à 2\u00a0000 pixels de large suffisent. Ni SVG ni JPEG, qui ne passent pas dans une facture PDF/A.`;

/** « 1 843 × 522 px · 433 Ko »: a kept logo in one line. */
export const logoLine = (logo: AgencyLogo): string =>
  `${SIDE.format(logo.width)} × ${SIDE.format(logo.height)} px · ${weightText(logo.byteLength)}`;

/** An amber line under a logo printed under 300 dpi, `null` for a sharp one: a warning, never a refusal. */
export const logoWarning = (logo: AgencyLogo): string | null =>
  logo.height < AGENCY_LOGO_SHARP_HEIGHT
    ? `Moins de ${String(AGENCY_LOGO_SHARP_HEIGHT)} pixels de haut : il risque d’être flou à l’impression. Un export plus grand sera plus net.`
    : null;

/** Why a logo was refused, and what to do about it. */
export const LOGO_REFUSALS: Readonly<Record<AgencyLogoRefusal, string>> = {
  too_heavy: `Ce fichier pèse plus de ${weightText(AGENCY_LOGO_MAX_BYTES)}. Réexporte-le plus petit : 1\u00a0000 à 2\u00a0000 pixels de large suffisent.`,
  not_png:
    'Ce fichier n’est pas un PNG. Exporte le logo en PNG à fond transparent : un SVG ou un JPEG ne passent pas dans une facture PDF/A.',
  damaged: 'Ce PNG est abîmé ou incomplet. Réexporte-le depuis ton logiciel.',
  opaque:
    'Ce PNG n’a aucun pixel transparent : son fond s’imprimerait en cadre sur la facture. Exporte-le avec un fond transparent.',
  dimensions: `Le logo doit mesurer de ${String(AGENCY_LOGO_MIN_SIDE)} à ${SIDE.format(AGENCY_LOGO_MAX_SIDE)} pixels de côté, 4 millions de pixels au plus.`,
};

/** Whether invoices can leave: the settings saved, with the designation of the service (`agency_missing`). */
export const isReady = (settings: BillingSettings | null): settings is BillingSettings =>
  settings !== null && settings.serviceDescription !== null;

/** « 60 jours après l’émission »: the due date each invoice prints. */
export const dueText = (days: number): string => `${String(days)} jours après l’émission`;
