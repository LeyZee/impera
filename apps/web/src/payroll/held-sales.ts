import type { HeldSale, SaleDecisionOutcome, SaleHeldReason } from '@nirvana/contracts';

import { momentAt } from './model';

import { signedAmountText } from '@/reports/model';
import { platformName } from '@/scheduling/model';

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

/** « Vente du lundi 2 novembre à 14 h 05 », « Remboursement du … (vente du …) ». */
export function saleWhen(sale: HeldSale, timeZone: string): string {
  if (sale.event === 'sale') return `Vente du ${momentAt(sale.occurredAt, timeZone)}`;
  const of =
    sale.saleOccurredAt === null
      ? ', vente d’avant le registre'
      : ` de la vente du ${momentAt(sale.saleOccurredAt, timeZone)}`;
  return `Remboursement du ${momentAt(sale.occurredAt, timeZone)}${of}`;
}

/** The line's net, signed: a refund takes off. */
export const saleAmount = (sale: HeldSale): string => signedAmountText(sale.netMinor, sale.currency);

/** Why a line waits for a decision, as the validator reads it; `null` for a line a member would be paid for. */
export function heldReasonText(
  sale: Pick<HeldSale, 'platform' | 'reason'>,
  member: SaleMember | null,
  owner: boolean,
): string | null {
  const reason: SaleHeldReason | null = sale.reason;
  switch (reason) {
    case null:
      return null;
    case 'chatter_unlinked':
      return owner
        ? `Son chatteur sur ${platformName(sale.platform)} n’est relié à aucun membre : relie-le dans Réglages › Ventes et la vente compte seule. Sinon, écarte-la.`
        : `Son chatteur sur ${platformName(sale.platform)} n’est relié à aucun membre : le propriétaire le relie dans Réglages › Ventes. Sinon, écarte-la.`;
    case 'off_shift':
      return `${member?.name ?? 'Son chatteur'} n’était ni en poste ni dans sa marge d’accès à l’heure de la vente.`;
    case 'status_unknown':
      return `${platformName(sale.platform)} lui donne un statut que Nirvana ne connaît pas encore.`;
    case 'refund_before_register':
      return 'Remboursement d’une vente plus ancienne que le registre des ventes : il n’est retiré à personne.';
    case 'refund_before_base':
      return 'Remboursement d’une vente payée sur les rapports, avant le passage au net : il n’est pas retiré du net.';
  }
}

/**
 * The signal in force of the member a paid line would pay (CRM-03 lot b4c): « Signalée par Théo : ce n'est pas sa
 * vente », with their note quoted; `null` for none.
 */
export function signalText(sale: Pick<HeldSale, 'signal'>, member: SaleMember | null): string | null {
  if (sale.signal === null) return null;
  const who = member === null ? 'son chatteur' : member.name;
  const said = `Signalée par ${who} : ce n’est pas sa vente.`;
  return sale.signal.note === null ? said : `${said} «${NBSP}${sale.signal.note}${NBSP}»`;
}

/** The decision in force on a line, said on its chip; `null` for none. */
export function decisionText(sale: Pick<HeldSale, 'decision'>, member: SaleMember | null): string | null {
  switch (sale.decision) {
    case null:
      return null;
    case 'count':
      return member === null ? 'Comptée' : `Comptée pour ${member.name}`;
    case 'exclude':
      return 'Écartée';
  }
}

/** A gesture's button on the line. */
export function outcomeLabel(outcome: SaleDecisionOutcome, member: SaleMember | null): string {
  switch (outcome) {
    case 'count':
      return member === null ? 'Compter' : `Compter pour ${member.name}`;
    case 'exclude':
      return 'Écarter';
    case 'withdraw':
      return 'Retirer la décision';
  }
}

/** What the confirmation asks and says before a gesture is sent. */
export interface OutcomeWords {
  readonly title: string;
  readonly lead: string;
  readonly confirm: string;
}

const TAKEN_BACK = 'Tu peux retirer la décision tant qu’aucune clôture n’a compté la vente.';

/** The confirmation of a gesture: what it does to the sale, its refunds with it, and that it can be taken back. */
export function outcomeWords(
  outcome: SaleDecisionOutcome,
  sale: Pick<HeldSale, 'reason' | 'memberId'>,
  member: SaleMember | null,
): OutcomeWords {
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
