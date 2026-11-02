import {
  AGENCY_LEGAL_FORM_MAX,
  BILLING_EMAIL_MAX,
  BUSINESS_ID_PATTERN,
  ContractorProfileBodySchema,
  INVOICE_PREFIX_PATTERN,
  LEGAL_NAME_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  TAX_ID_MAX,
  VAT_NUMBER_PATTERN,
  addressLines,
  legalFormWords,
  rcsWords,
  type BillingRegime,
  type ContractAcceptance,
  type ContractorDocumentKind,
  type ContractorFile,
  type ContractorFileDocument,
  type ContractorProfile,
  type ContractorProfileBody,
  type ContractorRegime,
  type ContractText,
  type ContractTextKind,
} from '@nirvana/contracts';
import { z } from 'zod';

import { dayOf, fullDay } from '@/scheduling/time';
import { eurosInput, isSiren, parseEuros, vatOfSiren } from '@/settings/billing/model';

/**
 * The words of the contractor's file (EQ-06 lot 8b): what each part of it stands at, as `GET …/file` gives it. Nothing
 * here decides whether an invoice leaves: the server's guard does; the screen says what it reads.
 */

/** The glossary's names of a document (« Pièce du prestataire »). */
export const DOCUMENT_NAMES: Readonly<Record<ContractorDocumentKind, string>> = {
  tax_residence: 'Attestation de résidence fiscale',
  urssaf_vigilance: 'Attestation de vigilance',
};

/** The glossary's names of a text. */
export const TEXT_NAMES: Readonly<Record<ContractTextKind, string>> = {
  service_contract: 'Contrat de prestation',
  billing_mandate: 'Mandat de facturation',
};

/** The texts in the order the file shows them: the contract, then the mandate that lets the invoices leave. */
export const TEXT_KINDS: readonly ContractTextKind[] = ['service_contract', 'billing_mandate'];

/** The regime in force on the file's day: the latest begun (the list comes the latest first). */
export const regimeInForce = (file: Pick<ContractorFile, 'regimes' | 'today'>): ContractorRegime | null =>
  file.regimes.find((regime) => regime.from <= file.today) ?? null;

/** A regime set to start after the file's day, the nearest: the one in force stays until then. */
export function regimeAhead(file: Pick<ContractorFile, 'regimes' | 'today'>): ContractorRegime | null {
  const ahead = file.regimes.filter((regime) => regime.from > file.today);
  return ahead.at(-1) ?? null;
}

/** Where a text stands for the contractor: none published yet, its newest version accepted, or one to accept. */
export type TextStanding =
  | { readonly kind: 'none' }
  | { readonly kind: 'accepted'; readonly text: ContractText; readonly at: string }
  | {
      readonly kind: 'to_accept';
      readonly text: ContractText;
      /** The older version he accepted, when there is one: a new version asks for a new acceptance. */
      readonly before: { readonly version: number; readonly at: string } | null;
    };

export function textStanding(
  kind: ContractTextKind,
  texts: readonly ContractText[],
  acceptances: readonly ContractAcceptance[],
): TextStanding {
  const versions = texts.filter((text) => text.kind === kind);
  const newest = versions[0];
  if (newest === undefined) return { kind: 'none' };
  const accepted = acceptances.find((acceptance) => acceptance.textId === newest.id);
  if (accepted !== undefined) return { kind: 'accepted', text: newest, at: accepted.acceptedAt };
  for (const older of versions.slice(1)) {
    const before = acceptances.find((acceptance) => acceptance.textId === older.id);
    if (before !== undefined)
      return { kind: 'to_accept', text: newest, before: { version: older.version, at: before.acceptedAt } };
  }
  return { kind: 'to_accept', text: newest, before: null };
}

/** Where a document of a kind stands: never filed, or its newest one not refused, else its newest refused. */
export type DocumentStanding =
  | { readonly kind: 'missing' }
  | { readonly kind: 'pending' | 'accepted' | 'refused'; readonly document: ContractorFileDocument };

export function documentStanding(
  kind: ContractorDocumentKind,
  documents: readonly ContractorFileDocument[],
): DocumentStanding {
  const ofKind = documents.filter((document) => document.kind === kind);
  const kept = ofKind.find((document) => document.review?.decision !== 'refused');
  const shown = kept ?? ofKind[0];
  if (shown === undefined) return { kind: 'missing' };
  if (shown.review === null) return { kind: 'pending', document: shown };
  return { kind: shown.review.decision, document: shown };
}

/** The documents of a kind besides the one its standing shows, the latest filed first: kept, never replaced. */
export const olderDocuments = (
  kind: ContractorDocumentKind,
  documents: readonly ContractorFileDocument[],
  standing: DocumentStanding,
): ContractorFileDocument[] =>
  documents.filter(
    (document) =>
      document.kind === kind && (standing.kind === 'missing' || document.id !== standing.document.id),
  );

/** A document's check in words (glossary « Vérification d'une pièce »). */
export function documentStateText(document: ContractorFileDocument): string {
  if (document.review === null) return 'En attente de vérification';
  if (document.review.decision === 'refused') return 'Refusée';
  return `Acceptée jusqu’au ${fullDay(document.lastDay)}`;
}

/**
 * The reminder of a document whose renewal is due, from `remindFrom` on (compared with the file's day, never the
 * device's): `null` before, or on a document the reminder does not follow. The tax residence certificate's is the
 * guide's (`docs/reference/residence-certificate-benin.md`), its years filled in.
 */
export function reminderText(document: ContractorFileDocument, today: string, self: boolean): string | null {
  if (document.remindFrom === null || document.remindFrom > today) return null;
  if (document.kind === 'tax_residence') {
    const next = String(Number(document.lastDay.slice(0, 4)) + 1);
    return self
      ? `Ton attestation se termine le 31 décembre. Sans celle de ${next}, tes versements à partir du 1er janvier ${next} seront bloqués : demande-la dès janvier.`
      : `Son attestation se termine le 31 décembre. Sans celle de ${next}, ses versements à partir du 1er janvier ${next} seront bloqués.`;
  }
  return self
    ? `Ton attestation de vigilance se termine le ${fullDay(document.lastDay)} : dépose la nouvelle avant.`
    : `Son attestation de vigilance se termine le ${fullDay(document.lastDay)}.`;
}

/** A document's dates, as the file shows them: its issue, and the end it states. */
export function documentDatesText(document: ContractorFileDocument): string {
  const issued = `délivrée le ${fullDay(document.issuedOn)}`;
  return document.validUntil === null
    ? issued
    : `${issued}, valable jusqu’au ${fullDay(document.validUntil)}`;
}

/** The name an invoice prints: « EI » after it for an individual entrepreneur (art. R526-27 of the Code de commerce). */
export const printedName = (
  profile: Pick<ContractorProfile, 'legalName' | 'individualEntrepreneur'>,
): string => (profile.individualEntrepreneur ? `${profile.legalName} EI` : profile.legalName);

/** The lines of the file's identity, as its invoices print them: each a label and its value. */
export function identityLines(profile: ContractorProfile): (readonly [string, string])[] {
  const lines: (readonly [string, string])[] = [
    ['Nom', printedName(profile)],
    ['Adresse', addressLines(profile.address).join(', ')],
  ];
  if (profile.businessId !== null) lines.push(['SIREN ou SIRET', profile.businessId]);
  if (profile.taxId !== null) lines.push(['Identifiant fiscal', profile.taxId]);
  if (profile.vatNumber !== null) lines.push(['N° de TVA', profile.vatNumber]);
  const form = legalFormWords(profile);
  if (form !== null) lines.push(['Société', form]);
  if (profile.rcsCity !== null && profile.businessId !== null)
    lines.push(['Registre', rcsWords(profile.rcsCity, profile.businessId)]);
  lines.push(['E-mail des factures', profile.email]);
  return lines;
}

/** What the contractor is, as his invoices print him: in France an individual entrepreneur or a company. */
export type ContractorStatus = 'person' | 'individual' | 'company';

/** The form of the file, as its fields hold it: text as typed, parsed only at the save. */
export interface ProfileDraft {
  readonly legalName: string;
  readonly address: string;
  readonly taxId: string;
  readonly businessId: string;
  readonly vatNumber: string;
  readonly status: ContractorStatus;
  readonly legalForm: string;
  readonly shareCapital: string;
  readonly rcsCity: string;
  readonly email: string;
}

export type ProfileField = Exclude<keyof ProfileDraft, 'status'>;

/** Established in France: his SIREN or SIRET, and « EI » or a company's mentions (EQ-06 lot 4). */
export const isFrench = (country: string): boolean => country === 'FR';

export function profileDraftOf(profile: ContractorProfile | null, country: string): ProfileDraft {
  const capital = profile?.shareCapitalMinor ?? null;
  const status: ContractorStatus =
    profile === null
      ? isFrench(country)
        ? 'individual'
        : 'person'
      : profile.legalForm !== null
        ? 'company'
        : profile.individualEntrepreneur
          ? 'individual'
          : 'person';
  return {
    legalName: profile?.legalName ?? '',
    address: profile?.address ?? '',
    taxId: profile?.taxId ?? '',
    businessId: profile?.businessId ?? '',
    vatNumber: profile?.vatNumber ?? '',
    status,
    legalForm: profile?.legalForm ?? '',
    shareCapital: capital === null ? '' : eurosInput(capital),
    rcsCity: profile?.rcsCity ?? '',
    email: profile?.email ?? '',
  };
}

/** The fields the form shows: a French contractor's registration, another's tax identifier. */
export function profileFields(draft: ProfileDraft, country: string): readonly ProfileField[] {
  if (!isFrench(country)) return ['legalName', 'address', 'taxId', 'email'];
  const company: ProfileField[] = draft.status === 'company' ? ['legalForm', 'shareCapital', 'rcsCity'] : [];
  return ['legalName', 'address', 'businessId', 'vatNumber', ...company, 'email'];
}

const digits = (text: string): string => text.replace(/[\s.]/gu, '');
const compactVat = (text: string): string => text.replace(/[\s.-]/gu, '').toUpperCase();
const filled = (text: string, max: number): boolean => text.trim() !== '' && text.trim().length <= max;
const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());
const BUSINESS_ID = new RegExp(BUSINESS_ID_PATTERN, 'u');
const VAT_NUMBER = new RegExp(VAT_NUMBER_PATTERN, 'u');
const EMAIL = z.email().max(BILLING_EMAIL_MAX);

/** What is wrong with each field the form shows, in the words the field says under it. */
export function profileProblems(
  draft: ProfileDraft,
  country: string,
  taxIdRequired: boolean,
): Partial<Record<ProfileField, string>> {
  const fields = profileFields(draft, country);
  const problems: Partial<Record<ProfileField, string>> = {};
  const check = (field: ProfileField, ok: boolean, message: string): void => {
    if (fields.includes(field) && !ok && problems[field] === undefined) problems[field] = message;
  };
  check(
    'legalName',
    filled(draft.legalName, LEGAL_NAME_MAX),
    draft.status === 'company'
      ? 'La raison sociale, telle que sur le Kbis.'
      : 'Ton nom et ton prénom, tels que sur ta pièce d’identité.',
  );
  check(
    'address',
    filled(draft.address, POSTAL_ADDRESS_MAX),
    'Ton adresse complète, sur une ou plusieurs lignes.',
  );
  check(
    'taxId',
    draft.taxId.trim().length <= TAX_ID_MAX && (!taxIdRequired || draft.taxId.trim() !== ''),
    'Ton identifiant fiscal, celui que les impôts de ton pays t’ont donné.',
  );
  check(
    'businessId',
    BUSINESS_ID.test(digits(draft.businessId)) && isSiren(digits(draft.businessId).slice(0, 9)),
    'Ton SIREN (9 chiffres) ou ton SIRET (14 chiffres) : ce numéro n’en est pas un.',
  );
  const vat = compactVat(draft.vatNumber);
  check(
    'vatNumber',
    vat === '' || VAT_NUMBER.test(vat),
    'Deux lettres puis le numéro, comme sur tes avis de TVA : FR12123456789.',
  );
  const siren = digits(draft.businessId).slice(0, 9);
  check(
    'vatNumber',
    vat === '' || !vat.startsWith('FR') || !isSiren(siren) || vat === vatOfSiren(siren),
    `Le numéro de TVA de ce SIREN est ${vatOfSiren(siren)} : vérifie l’un ou l’autre.`,
  );
  check(
    'legalForm',
    filled(draft.legalForm, AGENCY_LEGAL_FORM_MAX),
    'La forme de la société, par exemple SASU ou EURL.',
  );
  check(
    'shareCapital',
    parseEuros(draft.shareCapital) !== null,
    'Le capital social en euros, par exemple 1 000.',
  );
  check('rcsCity', filled(draft.rcsCity, RCS_CITY_MAX), 'La ville du greffe, comme sur le Kbis.');
  check(
    'email',
    EMAIL.safeParse(draft.email.trim()).success,
    'L’adresse où tu reçois tes factures, par exemple nom@exemple.fr.',
  );
  return problems;
}

/** The body of `PUT …/profile`, or `null` while a field the form shows is wrong. */
export function profileBodyOf(
  draft: ProfileDraft,
  country: string,
  taxIdRequired: boolean,
): ContractorProfileBody | null {
  if (Object.keys(profileProblems(draft, country, taxIdRequired)).length > 0) return null;
  const french = isFrench(country);
  const company = french && draft.status === 'company';
  const parsed = ContractorProfileBodySchema.safeParse({
    legalName: draft.legalName.trim(),
    address: draft.address.trim(),
    taxId: orNull(draft.taxId),
    businessId: french ? digits(draft.businessId) : null,
    vatNumber: french ? orNull(compactVat(draft.vatNumber)) : null,
    individualEntrepreneur: french && draft.status === 'individual',
    legalForm: company ? draft.legalForm.trim() : null,
    shareCapitalMinor: company ? parseEuros(draft.shareCapital) : null,
    rcsCity: company ? draft.rcsCity.trim() : null,
    email: draft.email.trim(),
  });
  return parsed.success ? parsed.data : null;
}

/** The VAT number the SIREN gives, offered while the field holds another French one or none. */
export function suggestedVat(draft: ProfileDraft): string | null {
  const siren = digits(draft.businessId).slice(0, 9);
  if (!isSiren(siren)) return null;
  const vat = compactVat(draft.vatNumber);
  return vat === '' || vat === vatOfSiren(siren) ? null : vat.startsWith('FR') ? vatOfSiren(siren) : null;
}

const PREFIX = new RegExp(INVOICE_PREFIX_PATTERN, 'u');

/** « nora » → « NORA »: a prefix as the owner types it, or `null` when it is not 2 to 8 capitals or digits. */
export function prefixOf(text: string): string | null {
  const prefix = text.trim().toUpperCase();
  return PREFIX.test(prefix) ? prefix : null;
}

/** The regimes the owner may give a member: those written for his country, the newest first. */
export const regimesFor = (country: string, regimes: readonly BillingRegime[]): BillingRegime[] =>
  regimes.filter((regime) => regime.countries.includes(country));

/** « validé par le comptable le 2 novembre 2026 », or why no invoice leaves under it yet. */
export const validationText = (regime: Pick<BillingRegime, 'validatedOn'>): string =>
  regime.validatedOn === null
    ? 'pas encore validé par le comptable : aucune facture ne part sous ce régime avant'
    : `validé par le comptable le ${fullDay(regime.validatedOn)}`;

/** The documents a regime asks for, in words; `null` when it asks for none. */
export function askedText(regime: Pick<BillingRegime, 'documents'>): string | null {
  if (regime.documents.length === 0) return null;
  return regime.documents.map((kind) => DOCUMENT_NAMES[kind].toLowerCase()).join(' et ');
}

/** « 12 octobre 2026 »: the agency's day of an instant of the file (an acceptance, a check). */
export const dayText = (instant: string, timeZone: string): string => fullDay(dayOf(instant, timeZone));
