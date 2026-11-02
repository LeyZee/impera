import {
  INVOICE_RETENTION_YEARS,
  type InvoiceAcceptanceState,
  type InvoiceEvent,
  type InvoiceEventKind,
  type InvoiceListItem,
} from '@nirvana/contracts';

import type { InvoiceRefusal } from './api';

import { dayMonthText, momentAt, type PayChip } from '@/payroll/model';
import { periodTitle } from '@/reports/model';
import { addDays, fullDay } from '@/scheduling/time';

/**
 * The words of the invoices' screens (EQ-06 lot 8): what a document is, where its acceptance, its due date and its
 * settlement stand, as the server computed them. Nothing here recomputes a rule: the screen says what it reads.
 */

/** The days a list of one's documents reads at a time: a year, both ends included (`INVOICE_LIST_MAX_DAYS`). */
const YEAR_DAYS = 366;

/** A range of days of issue, `from` and `to` included. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The year a list reads: `0` the year up to `today`, `1` the one before, and so on, without a day left out nor read
 * twice between two.
 */
export function yearRange(today: string, back: number): DayRange {
  const to = addDays(today, -YEAR_DAYS * back);
  return { from: addDays(to, -(YEAR_DAYS - 1)), to };
}

/**
 * The year « Plus anciennes » reads next, or `undefined` past the ten years an invoice is kept (ADR 0037): a year
 * without a document does not end the list, a member may have left, or paused, more than a year.
 */
export const olderYear = (back: number): number | undefined =>
  back + 1 < INVOICE_RETENTION_YEARS ? back + 1 : undefined;

/** What a list read a year at a time shows: documents, or the span of days without one (years in a row, joined). */
export type YearSlice =
  | { readonly kind: 'documents'; readonly items: readonly InvoiceListItem[] }
  | { readonly kind: 'gap'; readonly range: DayRange };

/** The years read, the latest first (`backs[i]` the year of `pages[i]`), as documents and spans without one. */
export function yearSlices(
  today: string,
  pages: readonly { readonly documents: readonly InvoiceListItem[] }[],
  backs: readonly number[],
): YearSlice[] {
  const slices: YearSlice[] = [];
  pages.forEach((page, index) => {
    const range = yearRange(today, backs[index] ?? index);
    const last = slices.at(-1);
    if (page.documents.length > 0) slices.push({ kind: 'documents', items: page.documents });
    else if (last?.kind === 'gap')
      slices[slices.length - 1] = { kind: 'gap', range: { from: range.from, to: last.range.to } };
    else slices.push({ kind: 'gap', range });
  });
  return slices;
}

/** « Aucun document entre le 5 novembre 2025 et le 5 novembre 2026. » */
export const gapText = (range: DayRange): string =>
  `Aucun document entre le ${fullDay(range.from)} et le ${fullDay(range.to)}.`;

/** « Facture », « Facture rectificative », « Avoir »: what a document is, as the glossary names it. */
export function kindLabel(item: Pick<InvoiceListItem, 'kind' | 'corrective'>): string {
  if (item.kind === 'credit_note') return 'Avoir';
  return item.corrective ? 'Facture rectificative' : 'Facture';
}

/** An invoice is said in the feminine, a credit note in the masculine: « acceptée », « accepté ». */
const agreed = (kind: InvoiceListItem['kind'], word: string): string =>
  kind === 'invoice' ? `${word}e` : word;

/**
 * Where a document's acceptance stands, in a word (glossary « Acceptation d'une facture »). The contractor reads what
 * is his to do (« À accepter »), the agency what it waits for.
 */
export function acceptanceChip(
  item: Pick<InvoiceListItem, 'kind'> & { readonly acceptance: { readonly state: InvoiceAcceptanceState } },
  contractor: boolean,
): PayChip {
  switch (item.acceptance.state) {
    case 'pending':
      return { label: contractor ? 'À accepter' : 'En attente de réponse', tone: 'wait' };
    case 'accepted':
      return { label: agreed(item.kind, 'Accepté'), tone: 'ok' };
    case 'tacitly_accepted':
      return { label: `${agreed(item.kind, 'Accepté')} tacitement`, tone: 'ok' };
    case 'contested':
      return { label: agreed(item.kind, 'Contesté'), tone: 'warn' };
    case 'contest_upheld':
      return { label: 'Contestation fondée', tone: 'neutral' };
    case 'contest_refused':
      return { label: 'Contestation refusée', tone: 'neutral' };
  }
}

/** The tone of a due date that is past: red, the one urgency of the screen (the design's rule: red = urgency). */
export type InvoiceTone = PayChip['tone'] | 'danger';
export interface InvoiceChip {
  readonly label: string;
  readonly tone: InvoiceTone;
}

/**
 * Where an invoice stands with its due date, for the agency alone (the contractor reads no due date in colour): amber
 * from seven days before it, red once past, as `due` says; nothing while it is far, nor once settled (the settlement
 * says it).
 */
export function dueChip(item: Pick<InvoiceListItem, 'due' | 'kind'>): InvoiceChip | null {
  switch (item.due) {
    case 'soon':
      // Only an invoice is ever `soon`: a credit note waits for no due date.
      return { label: 'Bientôt due', tone: 'warn' };
    case 'overdue':
      return { label: 'En retard', tone: 'danger' };
    case 'open':
    case 'settled':
      return null;
  }
}

/**
 * How a document's debt ended (glossary « Rapprochement »): « payée le lun. 2 nov. » for an invoice the transfer paid,
 * « imputé le … » for a credit note it took off, « compensée le … » where nothing was sent; `null` while it waits.
 */
export function settlementText(item: Pick<InvoiceListItem, 'kind' | 'settlement'>): string | null {
  if (item.settlement === null) return null;
  const on = dayMonthText(item.settlement.on);
  switch (item.settlement.kind) {
    case 'paid':
      return `${agreed(item.kind, 'payé')} le ${on}`;
    case 'imputed':
      return `${agreed(item.kind, 'imputé')} le ${on}`;
    case 'compensated':
      return `${agreed(item.kind, 'compensé')} le ${on}`;
  }
}

/** « échéance le mar. 1er déc. », for an invoice not settled; a credit note has none, it is taken off a transfer. */
export function dueText(item: Pick<InvoiceListItem, 'kind' | 'settlement' | 'dueOn'>): string | null {
  if (item.settlement !== null || item.kind === 'credit_note') return null;
  return `échéance le ${dayMonthText(item.dueOn)}`;
}

/**
 * The quinzaine a document bills, or the one it corrects: a credit note and a corrective invoice print the period they
 * correct (`period`), which a list by quinzaine shows under the statement that owed them (Bilan on #368).
 */
export function periodText(item: Pick<InvoiceListItem, 'kind' | 'corrective' | 'period'>): string {
  const corrects = item.kind === 'credit_note' || item.corrective;
  return `${corrects ? 'corrige la quinzaine du' : 'quinzaine du'} ${periodTitle(item.period)}`;
}

/** The answer still open to the contractor, with the moment its delay ends; `null` once answered. */
export function deadlineText(
  acceptance: { readonly state: InvoiceAcceptanceState; readonly deadline: string },
  timeZone: string,
): string | null {
  return acceptance.state === 'pending'
    ? `réponse avant le ${momentAt(acceptance.deadline, timeZone)}`
    : null;
}

/** Whether the contractor may still answer: the server's state, never a clock of the screen (the job ends the delay). */
export const answerable = (item: Pick<InvoiceListItem, 'acceptance'>): boolean =>
  item.acceptance.state === 'pending';

/** The contests the owner has to settle first, then the rest, each group in the server's order. */
export function contestsFirst<T extends Pick<InvoiceListItem, 'acceptance'>>(items: readonly T[]): T[] {
  return [
    ...items.filter((item) => item.acceptance.state === 'contested'),
    ...items.filter((item) => item.acceptance.state !== 'contested'),
  ];
}

const EVENT_WORDS: Readonly<Record<InvoiceEventKind, (kind: InvoiceListItem['kind']) => string>> = {
  issued: (kind) => agreed(kind, 'Émis'),
  accepted: (kind) => agreed(kind, 'Accepté'),
  contested: (kind) => agreed(kind, 'Contesté'),
  lapsed: (kind) => `${agreed(kind, 'Accepté')} tacitement`,
  contest_upheld: () => 'Contestation fondée',
  contest_refused: () => 'Contestation refusée',
  paid: (kind) => agreed(kind, 'Payé'),
  imputed: (kind) => agreed(kind, 'Imputé'),
  compensated: (kind) => agreed(kind, 'Compensé'),
};

/** A step of a document's life, dated in the agency's zone: « Contestée le lundi 2 novembre à 10 h 41 ». */
export function eventLine(
  event: Pick<InvoiceEvent, 'kind' | 'at'>,
  kind: InvoiceListItem['kind'],
  timeZone: string,
): string {
  return `${EVENT_WORDS[event.kind](kind)} le ${momentAt(event.at, timeZone)}`;
}

/** Why a correction is refused (`details.reason` of `invoice_correction_unprocessable`, ADR 0039 § 3). */
const CORRECTION_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['reissue_credit_note', 'Seule une facture s’annule et se refacture, pas un avoir.'],
  ['nothing_left', 'Ses avoirs ont déjà annulé cette facture en entier : il n’y a plus rien à refaire.'],
  ['above_pay_amount_max', 'Ce qui reste de cette facture dépasse ce qu’un ajustement de paie peut porter.'],
]);

/**
 * Every refusal of the invoices' routes, in French (EQ-06 lot 8: never a raw code). The codes of the file and of
 * Réglages › Facturation are worded here too, for the screens of 8b and 8c; one switch, exhaustive, so a new code
 * cannot reach a screen without its sentence.
 */
export function invoiceRefusalText(refusal: InvoiceRefusal): string {
  if (refusal.kind === 'failed') return 'Le serveur ne répond pas : rien n’a été enregistré. Réessaie.';
  switch (refusal.code) {
    case 'invoice_not_found':
      return 'Ce document n’existe plus, ou il n’est pas à toi.';
    case 'invoice_answer_forbidden':
      return 'Seul le prestataire répond à sa facture.';
    case 'payroll_forbidden':
      return 'Seul le propriétaire peut faire ce geste.';
    case 'invoice_acceptance_conflict':
      return 'Ce document a déjà sa réponse, ou son délai est passé : la liste se met à jour.';
    case 'credit_note_amount_unprocessable':
      return 'Ce montant dépasse ce qui reste de la facture : un avoir ne peut pas aller plus loin.';
    case 'invoice_correction_unprocessable':
      return (
        CORRECTION_REFUSALS.get(refusal.details.reason ?? '') ?? 'Ce document ne permet pas cette correction.'
      );
    case 'invoice_pdf_not_found':
      return 'Le PDF est en préparation : il sera là dans un instant.';
    case 'invoice_pdf_unavailable':
      return 'Le PDF n’a pas pu être relu intact : réessaie plus tard, jamais un fichier altéré n’est servi.';
    case 'agency_logo_invalid':
      return 'Ce logo n’a pas été gardé : un PNG transparent de 512 Ko au plus.';
    case 'agency_logo_not_found':
      return 'Ce logo n’est plus là : dépose-le à nouveau.';
    case 'billing_settings_missing_conflict':
      return 'Enregistre d’abord l’identité de l’agence dans Réglages › Facturation.';
    case 'billing_regime_backdated_unprocessable':
      return 'Un régime s’attribue à partir d’aujourd’hui au plus tôt.';
    case 'billing_regime_country_unprocessable':
      return 'Ce régime n’est pas celui du pays du prestataire.';
    case 'billing_regime_id_conflict':
    case 'contractor_regime_id_conflict':
    case 'contractor_document_id_conflict':
    case 'contract_text_id_conflict':
      return 'Cet envoi existe déjà avec d’autres valeurs : recharge la page.';
    case 'billing_regime_not_found':
      return 'Ce régime n’existe plus.';
    case 'billing_regime_validated_conflict':
      return 'La validation du comptable est déjà notée, à un autre jour : elle ne se note qu’une fois.';
    case 'billing_regime_validation_future_unprocessable':
      return 'La validation du comptable se note au plus tard aujourd’hui.';
    case 'contractor_document_invalid':
      return 'Ce fichier n’a pas été gardé : un PDF, un JPEG ou un PNG de 10 Mo au plus.';
    case 'contractor_document_issued_future_unprocessable':
      return 'La date de la pièce est à venir : celle écrite sur le document, au plus tard aujourd’hui.';
    case 'contractor_document_not_found':
      return 'Cette pièce n’existe plus.';
    case 'contractor_document_reviewed_conflict':
      return 'Cette pièce est déjà examinée : elle ne s’examine qu’une fois.';
    case 'contractor_document_unavailable':
      return 'Le fichier n’a pas pu être relu intact : réessaie plus tard.';
    case 'contractor_document_file_gone':
      return 'Le fichier de cette pièce refusée a été effacé ; son motif reste.';
    case 'journal_accounts_missing_unprocessable':
      return 'Il manque des comptes du journal : le comptable les donne dans Réglages › Facturation.';
    case 'contract_acceptance_forbidden':
      return 'Seul le prestataire accepte son contrat et son mandat.';
    case 'contract_text_changed_conflict':
      return 'Le texte a changé depuis l’ouverture de la page : relis la nouvelle version.';
    case 'contract_text_not_found':
      return 'Ce texte n’existe plus.';
    case 'contract_text_superseded_conflict':
      return 'Une version plus récente remplace celle-ci : c’est elle qui s’accepte.';
    case 'contractor_profile_changed_conflict':
      return 'Le dossier a changé depuis sa lecture : vérifie ce qui s’affiche maintenant.';
    case 'contractor_profile_forbidden':
      return 'Seuls le prestataire et le propriétaire écrivent ce dossier.';
    case 'contractor_profile_not_found':
      return 'Le prestataire n’a pas encore rempli son dossier.';
    case 'invoice_prefix_frozen_conflict':
      return 'La première facture a figé ce préfixe : il ne change plus.';
    case 'invoice_prefix_taken_conflict':
      return 'Un autre prestataire a déjà ce préfixe.';
    case 'role_forbidden':
      return 'Ton rôle ne permet pas ce geste.';
    case 'request_invalid':
      return 'Ces valeurs ne conviennent pas : vérifie le formulaire.';
    case 'team_member_not_found':
      return 'Ce membre n’existe plus, ou son dossier n’est pas à toi.';
  }
}

/** The refusals after which the list is read again: what the screen showed is no longer true. */
export const readsAgain = (refusal: InvoiceRefusal): boolean =>
  refusal.kind === 'refused' &&
  (refusal.code === 'invoice_acceptance_conflict' || refusal.code === 'invoice_not_found');
