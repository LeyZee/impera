import {
  SALE_WHOLE_BP,
  type HeldSale,
  type SaleDecisionOutcome,
  type SaleExcludeReason,
  type SaleGiftCount,
  type SaleHeldReason,
  type TeamImportOverview,
} from '@impera/contracts';

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

/** Who sold, as a gesture's sheet recalls it under the sale's instant: a member, an unlinked chatter or the agent. */
export function saleSellerText(sale: HeldSale, member: { readonly name: string } | null): string {
  if (sale.byAgent) return 'vendue par l’IA';
  return `vendue par ${member?.name ?? 'un chatteur'}`;
}

/**
 * Who reads the note of a give, under its field: both members on a member's sale, the one who receives it on the
 * agent's, which has no one else to tell. Missing, the line says first that it is required.
 */
export function giveNoteHint(byAgent: boolean, missing: boolean): string {
  const readers = byAgent ? 'le membre la lira sur son relevé' : 'les deux membres la liront sur leur relevé';
  if (missing) return `Obligatoire : ${readers}.`;
  return `${readers.charAt(0).toUpperCase()}${readers.slice(1)}. Jamais le message ni le nom d’un fan.`;
}

/** The example in a gesture's note, fitted to the gesture and, to set a sale aside, to its reason. */
export function notePlaceholder(outcome: SaleDecisionOutcome, why: SaleExcludeReason | null): string {
  switch (outcome) {
    case 'count':
      return 'Shift prolongé d’une heure, prévenu par message.';
    case 'exclude':
      return why === 'agent_decisive'
        ? 'Le fan a payé juste après le message de l’IA.'
        : 'Vente faite par la créatrice elle-même.';
    case 'give':
      return 'Le fan a été convaincu pendant son shift.';
    case 'withdraw':
      return 'Décision prise sur le mauvais membre.';
  }
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

/** A share in basis points, as the screens say it: « 60 % ». */
export const shareText = (bp: number): string => `${String(Math.round(bp / 100))}${NBSP}%`;

/**
 * The decision in force on a line, said on its chip and agreed with its event; `null` for none. A give names its
 * recipient (`nameOf`), and a shared one their share (ADR 0101 §§ 6, 15): « Donnée à Léa », « Partagée avec Léa :
 * 60 % ». A refund follows its sale.
 */
export function decisionText(
  sale: Pick<HeldSale, 'decision' | 'event' | 'given'>,
  member: SaleMember | null,
  nameOf: (memberId: string) => string,
): string | null {
  const ofSale = sale.event === 'sale';
  const counted = ofSale ? 'Comptée' : 'Compté';
  switch (sale.decision) {
    case null:
      return null;
    case 'count':
      return member === null ? counted : `${counted} pour ${member.name}`;
    case 'exclude':
      return ofSale ? 'Écartée' : 'Écarté';
    case 'give': {
      if (sale.given === null) return ofSale ? 'Donnée' : 'Sa vente est donnée';
      const to = nameOf(sale.given.recipientMemberId);
      if (sale.given.shareBp < SALE_WHOLE_BP)
        return `${ofSale ? 'Partagée' : 'Sa vente est partagée'} avec ${to}${NBSP}: ${shareText(sale.given.shareBp)}`;
      return `${ofSale ? 'Donnée' : 'Sa vente est donnée'} à ${to}`;
    }
  }
}

/**
 * What the validator wrote with a decision in force that keeps its reason (ADR 0101 §§ 3, 8): a give's note, quoted,
 * or an exclusion because the agent was decisive; `null` otherwise.
 */
export function decidedWhyText(sale: Pick<HeldSale, 'decision' | 'given' | 'excludeReason'>): string | null {
  if (sale.decision === 'give' && sale.given !== null)
    return `Pourquoi${NBSP}: «${NBSP}${sale.given.note}${NBSP}»`;
  if (sale.decision === 'exclude' && sale.excludeReason === 'agent_decisive')
    return 'L’IA a été décisive : la vente compte pour l’agent dans le Dashboard, jamais en paie.';
  return null;
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
 * The gestures the panel shows on a line: those the server offers, « Donner à… » while the reader has someone to name
 * (the server leaves themselves out of `recipients`).
 */
export const outcomesShown = (sale: Pick<HeldSale, 'outcomes' | 'recipients'>): SaleDecisionOutcome[] =>
  sale.outcomes.filter((outcome) => outcome !== 'give' || sale.recipients.length > 0);

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
/** A refund line no sale of the register pays (older than the register, or paid before the net): it stands alone. */
export const refundAlone = (sale: Pick<HeldSale, 'event' | 'saleOccurredAt' | 'reason'>): boolean =>
  sale.event === 'refund' && (sale.saleOccurredAt === null || sale.reason === 'refund_before_base');

function refundWords(
  outcome: SaleDecisionOutcome,
  sale: DecidedLine,
  member: SaleMember | null,
): OutcomeWords {
  const alone = refundAlone(sale);
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

/** The shares « Partager » offers the recipient (ADR 0101 § 11): by steps of 10 %, from 10 % to 90 %. */
export const SHARE_STEP_BP = 1_000;
export const SHARE_MIN_BP = SHARE_STEP_BP;
export const SHARE_MAX_BP = SALE_WHOLE_BP - SHARE_STEP_BP;
/** The share « 50/50 » sets in one gesture. */
export const HALF_BP = SALE_WHOLE_BP / 2;

/** A share brought back onto the steps « Partager » offers. */
export const shareOnStep = (bp: number): number =>
  Math.min(SHARE_MAX_BP, Math.max(SHARE_MIN_BP, Math.round(bp / SHARE_STEP_BP) * SHARE_STEP_BP));

/**
 * The two parts of a shared net (ADR 0101 § 13), as the server writes them: the recipient's rounded once, half away
 * from zero, the author's the rest, so that they always make the net. Shown before the give is sent; the server's are
 * what pays.
 */
export function partsOf(netMinor: number, recipientShareBp: number): { recipient: number; author: number } {
  const magnitude = Math.floor((Math.abs(netMinor) * recipientShareBp + SALE_WHOLE_BP / 2) / SALE_WHOLE_BP);
  const recipient = netMinor < 0 && magnitude > 0 ? -magnitude : magnitude;
  return { recipient, author: netMinor - recipient };
}

/** What « Donner à… » asks and says, after whether the sale is shared and with whom. */
export interface GiveWords {
  readonly title: string;
  readonly lead: string;
  readonly confirm: string;
}

/**
 * The give's sheet (ADR 0101): whole, the sale counts for the recipient at their rate, its refunds with it; shared,
 * each counts their part. Before a recipient is chosen, the confirmation names none.
 */
export function giveWords(recipient: string | null, shareBp: number): GiveWords {
  const shared = shareBp < SALE_WHOLE_BP;
  return {
    title: 'Donner cette vente',
    lead: `${
      shared
        ? 'Chacun compte sa part du net, à son taux et dans ses paliers. Ses remboursements se partagent pareil.'
        : 'Elle compte pour le membre choisi, à son taux et dans ses paliers, ses remboursements avec elle.'
    } ${TAKEN_BACK}`,
    confirm: recipient === null ? 'Donner' : shared ? `Partager avec ${recipient}` : `Donner à ${recipient}`,
  };
}

/**
 * The owner's count of the gives of the month (ADR 0101 § 17), one validator after the other, the most first: « Théo :
 * 3 ventes données, dont 2 partagées ». `nameOf` names a validator by their account, « toi » for the reader.
 */
export function giftCountText(
  count: Pick<SaleGiftCount, 'given' | 'shared'> & { readonly decidedBy: string },
  nameOf: (userId: string) => string,
): string {
  const given = `${String(count.given)}${NBSP}${count.given > 1 ? 'ventes données' : 'vente donnée'}`;
  const shared =
    count.shared === 0
      ? ''
      : `, dont ${String(count.shared)}${NBSP}${count.shared > 1 ? 'partagées' : 'partagée'}`;
  return `${nameOf(count.decidedBy)}${NBSP}: ${given}${shared}`;
}
