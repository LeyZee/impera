import type { HeldSale, SaleDecisionOutcome, SaleHeldReason, TeamImportOverview } from '@impera/contracts';

import { momentAt } from './model';

import { signedAmountText } from '@/reports/model';
import { platformName } from '@/scheduling/model';
import { dayOf, longDay } from '@/scheduling/time';

/**
 * The validator's screen of the sales a period holds or a decision settles (CRM-03 lot b4b, ADR 0050 §§ 3, 5, 7),
 * without React: what a line is, why it waits, what was decided, and what each gesture does. The server decides what
 * may be decided (`outcomes`) and refuses the rest; the screen only says it.
 */

const NBSP = ' ';

/** Who a sale's chatter is linked to, as the screen names them, and whether it is the reader. */
export interface SaleMember {
  readonly name: string;
  readonly own: boolean;
}

/** Who made a line, as its line says it: `lead` then, in bold, `name` (« chatteur Théo », « chatteur non relié »). */
export interface LineChatter {
  readonly lead: string;
  readonly name: string;
}

/**
 * Who made a line (CRM-03 lot b4b): the member its chatter is linked to; else the platform's
 * account named from the platform's team as it lists it now (« chatteur non relié · Camille Durand »); else, when the
 * team cannot be read or does not list it, the account said as one (« compte Reveal non relié »). A line made by
 * nobody (a subscription) stays « chatteur non relié ».
 */
export function lineChatter(
  sale: Pick<HeldSale, 'platform' | 'platformChatterId'>,
  member: SaleMember | null,
  team: TeamImportOverview | undefined,
): LineChatter {
  if (member !== null) return { lead: 'chatteur', name: member.name };
  if (sale.platformChatterId === null) return { lead: 'chatteur', name: 'non relié' };
  const row = team?.rows.find((one) => one.chatter.platformChatterId === sale.platformChatterId);
  const person = row === undefined ? '' : `${row.chatter.firstName} ${row.chatter.lastName}`.trim();
  return person === ''
    ? { lead: `compte ${platformName(sale.platform)}`, name: 'non relié' }
    : { lead: 'chatteur', name: `non relié · ${person}` };
}

/** « Vente du lundi 2 novembre à 14 h 05 », « Remboursement du … (vente du …) ». */
export function saleWhen(sale: HeldSale, timeZone: string): string {
  if (sale.event === 'sale') return `Vente du ${momentAt(sale.occurredAt, timeZone)}`;
  const of =
    sale.saleOccurredAt === null
      ? ', vente d’avant le registre'
      : ` de la vente du ${momentAt(sale.saleOccurredAt, timeZone)}`;
  return `Remboursement du ${momentAt(sale.occurredAt, timeZone)}${of}`;
}

/**
 * The lines in the order the validator reads them: by their own instant, the oldest first, then by key. The server
 * gives them in key order, which reads as no order at all (recette paie, 11/11).
 */
export function heldInOrder<T extends Pick<HeldSale, 'occurredAt' | 'platformSaleId' | 'event'>>(
  sales: readonly T[],
): T[] {
  return [...sales].sort(
    (a, b) =>
      Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      a.platformSaleId.localeCompare(b.platformSaleId) ||
      a.event.localeCompare(b.event),
  );
}

/** The line's net, signed: a refund takes off. */
export const saleAmount = (sale: HeldSale): string => signedAmountText(sale.netMinor, sale.currency);

/**
 * A line off shift of a member who left (ADR 0072, Charles, 11/11/2026): the day he left, as the pay screens write a
 * day, and, for a sale made after it, that it waits for the validator and goes on his final statement once counted.
 */
function departedText(
  sale: Pick<HeldSale, 'event' | 'memberLeftOn' | 'saleOccurredAt'>,
  name: string,
  leftOn: string,
  timeZone: string,
): string {
  const left = `${name} a quitté l’équipe le ${longDay(leftOn)}`;
  const after = sale.saleOccurredAt !== null && dayOf(sale.saleOccurredAt, timeZone) > leftOn;
  if (!after) return `${name} n’était ni en poste ni dans sa marge d’accès à l’heure de la vente. ${left}.`;
  return sale.event === 'sale'
    ? `${left}, avant cette vente. Comptée, elle va sur son relevé final, sans minimum de versement.`
    : `${left}, avant la vente de ce remboursement. Compté, sa vente va sur son relevé final et il s’en déduit.`;
}

/**
 * Why a line waits for a decision, as the validator reads it; `null` for a line a member would be paid for. A line off
 * shift of a member who left says the day he left (`departedText`), read in the agency's zone.
 */
export function heldReasonText(
  sale: Pick<HeldSale, 'platform' | 'reason' | 'event' | 'memberLeftOn' | 'saleOccurredAt'>,
  member: SaleMember | null,
  timeZone: string,
): string | null {
  const reason: SaleHeldReason | null = sale.reason;
  const refund = sale.event === 'refund';
  switch (reason) {
    case null:
      return null;
    case 'chatter_unlinked': {
      const unlinked = `Son chatteur sur ${platformName(sale.platform)} n’est relié à aucun membre`;
      const otherwise = refund ? 'Sinon, écarte-le.' : 'Sinon, écarte-la.';
      // Only the owner and an active manager read this list, and both link in Équipe (ADR 0076).
      const where = `Équipe › ${platformName(sale.platform)}`;
      return refund
        ? `${unlinked}\u00a0: relie-le dans ${where} et le remboursement se déduit seul. ${otherwise}`
        : `${unlinked}\u00a0: relie-le dans ${where} et la vente compte seule. ${otherwise}`;
    }
    case 'off_shift':
      if (member !== null && sale.memberLeftOn !== null)
        return departedText(sale, member.name, sale.memberLeftOn, timeZone);
      return `${member?.name ?? 'Son chatteur'} n’était ni en poste ni dans sa marge d’accès à l’heure de la vente.`;
    case 'status_unknown':
      return `${platformName(sale.platform)} lui donne un statut qu’Impera ne connaît pas encore.`;
    case 'refund_before_register':
      return 'Remboursement d’une vente plus ancienne que le registre des ventes : il n’est retiré à personne.';
    case 'refund_before_base':
      return 'Remboursement d’une vente payée sur les rapports, avant le passage au net : il n’est pas retiré du net.';
  }
}

/**
 * The signal in force of the member a paid line would pay (CRM-03 lot b4c): « Signalée par Théo : ce n'est pas sa
 * vente », « Signalé par Théo : ce n'est pas son remboursement » for a refund, with their note quoted; `null` for none.
 */
export function signalText(
  sale: Pick<HeldSale, 'signal' | 'event'>,
  member: SaleMember | null,
): string | null {
  if (sale.signal === null) return null;
  const who = member === null ? 'son chatteur' : member.name;
  const said =
    sale.event === 'sale'
      ? `Signalée par ${who} : ce n’est pas sa vente.`
      : `Signalé par ${who} : ce n’est pas son remboursement.`;
  return sale.signal.note === null ? said : `${said} «${NBSP}${sale.signal.note}${NBSP}»`;
}

/** The chip of a signalled line, agreed with its event. */
export const signalChipText = (sale: Pick<HeldSale, 'event'>): string =>
  sale.event === 'sale' ? 'Signalée' : 'Signalé';

/** The decision in force on a line, said on its chip and agreed with its event; `null` for none. */
export function decisionText(
  sale: Pick<HeldSale, 'decision' | 'event'>,
  member: SaleMember | null,
): string | null {
  const counted = sale.event === 'sale' ? 'Comptée' : 'Compté';
  switch (sale.decision) {
    case null:
      return null;
    case 'count':
      return member === null ? counted : `${counted} pour ${member.name}`;
    case 'exclude':
      return sale.event === 'sale' ? 'Écartée' : 'Écarté';
    case 'give':
      // ADR 0101: a refund follows its sale.
      return sale.event === 'sale' ? 'Donnée' : 'Sa vente est donnée';
  }
}

/** Why the reader may not decide on a line of their own chatter, agreed with its event. */
export const ownLineText = (sale: Pick<HeldSale, 'event'>): string =>
  sale.event === 'sale'
    ? 'C’est une vente de ton chatteur : un autre membre en décide.'
    : 'C’est un remboursement de ton chatteur : un autre membre en décide.';

/** A gesture's button on the line: a verb, which says the same of a sale and a refund. */
export function outcomeLabel(outcome: SaleDecisionOutcome, member: SaleMember | null): string {
  switch (outcome) {
    case 'count':
      return member === null ? 'Compter' : `Compter pour ${member.name}`;
    case 'exclude':
      return 'Écarter';
    case 'give':
      return 'Donner à…';
    case 'withdraw':
      return 'Retirer la décision';
  }
}

/**
 * The gestures the panel shows on a line: those the server offers, but « Donner à… », whose choice of member and share
 * comes with its own screen (ADR 0101, second part).
 */
export const outcomesShown = (outcomes: readonly SaleDecisionOutcome[]): SaleDecisionOutcome[] =>
  outcomes.filter((outcome) => outcome !== 'give');

/** What the confirmation asks and says before a gesture is sent. */
export interface OutcomeWords {
  readonly title: string;
  readonly lead: string;
  readonly confirm: string;
}

const TAKEN_BACK = 'Tu peux retirer la décision tant qu’aucune clôture n’a compté la vente.';

type DecidedLine = Pick<HeldSale, 'reason' | 'memberId' | 'event' | 'saleOccurredAt'>;

/**
 * The confirmation of a gesture on a refund line. The decision is taken on its sale (CRM-03 lot b3), so it moves the
 * sale with it, when the register has one and pays it on this net; never an amount.
 */
function refundWords(
  outcome: SaleDecisionOutcome,
  sale: DecidedLine,
  member: SaleMember | null,
): OutcomeWords {
  const alone = sale.saleOccurredAt === null || sale.reason === 'refund_before_base';
  const takenBack = alone
    ? 'Tu peux retirer la décision tant qu’aucune clôture ne l’a compté.'
    : 'Tu peux retirer la décision tant qu’aucune clôture n’a compté sa vente.';
  switch (outcome) {
    case 'count':
      return {
        title:
          member === null ? 'Compter ce remboursement ?' : `Compter ce remboursement pour ${member.name} ?`,
        lead: `Sa vente va sur son relevé, et le remboursement s’en déduit. ${takenBack}`,
        confirm: outcomeLabel('count', member),
      };
    case 'exclude':
      return {
        title: 'Écarter ce remboursement ?',
        lead: alone
          ? `Il ne se déduira des ventes de personne. ${takenBack}`
          : `Il ne se déduira des ventes de personne, et sa vente ne comptera pour personne non plus. ${takenBack}`,
        confirm: 'Écarter',
      };
    case 'give':
      return {
        title: 'Donner la vente de ce remboursement ?',
        lead: `Sa vente va au membre choisi, et le remboursement se déduit de ses ventes. ${takenBack}`,
        confirm: outcomeLabel('give', member),
      };
    case 'withdraw':
      return {
        title: 'Retirer la décision ?',
        lead:
          sale.reason === null
            ? `Le remboursement suit de nouveau les règles : il se déduit des ventes de ${member?.name ?? 'son membre'}.`
            : 'Le remboursement suit de nouveau les règles : il attend une décision et ne se déduit des ventes de personne.',
        confirm: 'Retirer la décision',
      };
  }
}

/**
 * The confirmation of a gesture: what it does to the sale, its refunds with it, and that it can be taken back; on a
 * refund line, said of the refund (`refundWords`).
 */
export function outcomeWords(
  outcome: SaleDecisionOutcome,
  sale: DecidedLine,
  member: SaleMember | null,
): OutcomeWords {
  if (sale.event === 'refund') return refundWords(outcome, sale, member);
  switch (outcome) {
    case 'count':
      return {
        title: member === null ? 'Compter cette vente ?' : `Compter cette vente pour ${member.name} ?`,
        lead: `Elle va sur son relevé, ses remboursements avec elle. ${TAKEN_BACK}`,
        confirm: outcomeLabel('count', member),
      };
    case 'exclude':
      return {
        title: 'Écarter cette vente ?',
        lead: `Elle ne comptera pour personne, ses remboursements non plus. ${TAKEN_BACK}`,
        confirm: 'Écarter',
      };
    case 'give':
      return {
        title: 'Donner cette vente ?',
        lead: `Elle compte pour le membre choisi, ses remboursements avec elle. ${TAKEN_BACK}`,
        confirm: outcomeLabel('give', member),
      };
    case 'withdraw':
      return {
        title: 'Retirer la décision ?',
        lead:
          sale.reason === null
            ? `La vente suit de nouveau les règles : elle compte pour ${member?.name ?? 'son membre'}.`
            : 'La vente suit de nouveau les règles : elle attend une décision et ne compte pour personne.',
        confirm: 'Retirer la décision',
      };
  }
}

/** The panel's head: how many lines wait, and how many are decided. */
export function heldCountText(sales: readonly Pick<HeldSale, 'decision'>[]): string {
  const waiting = sales.filter((one) => one.decision === null).length;
  const decided = sales.length - waiting;
  const parts = [
    waiting === 0 ? null : `${String(waiting)}${NBSP}${waiting > 1 ? 'attendent' : 'attend'} une décision`,
    decided === 0 ? null : `${String(decided)}${NBSP}${decided > 1 ? 'décidées' : 'décidée'}`,
  ].filter((one) => one !== null);
  return parts.join(' · ');
}
