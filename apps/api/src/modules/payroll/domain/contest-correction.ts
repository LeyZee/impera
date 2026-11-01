import { PAY_AMOUNT_MAX_MINOR, type ContestCorrection, type InvoiceKind } from '@nirvana/contracts';

import { CreditNoteExceedsInvoice, InvoiceCorrectionUnprocessable } from './errors';
import { longDay } from './invoices';

/**
 * The correction of a contest the owner upholds (EQ-06 lot 6, ADR 0039 § 3 to 5), the pure part: the adjustments of pay
 * it writes, in the same transaction as `contest_upheld`. Each corrects the document's period and names the document;
 * the store puts them on the member's first open period, as any adjustment. Money only moves through pay: an amount in
 * the contractor's favour becomes a line of his next invoice, one in the agency's a credit note on the document's
 * invoice (ADR 0036), and the cancel and reissue of an invoice a pair of both, of what is left of it.
 */

/** The contested document, as its correction reads it. */
export interface ContestedDocument {
  readonly kind: InvoiceKind;
  /** The invoice a credit in the agency's favour lands on: the document itself, or the invoice a credit note cites. */
  readonly invoice: {
    readonly number: string;
    readonly issuedOn: string;
    /** What its credit notes have not taken off yet, excluding VAT, positive or zero. */
    readonly leftMinor: number;
  };
}

/** An adjustment the correction writes, excluding VAT: positive in the contractor's favour. */
export interface CorrectionAdjustment {
  readonly amountMinor: number;
  readonly reason: string;
}

/**
 * The adjustments that correct an upheld contest, in the order they are written. `amount`: one, with the owner's
 * reason; in the agency's favour, never more than its invoice has left (a credit note is never issued below zero).
 * `reissue`: the pair that cancels an invoice and bills it again, of what its credit notes left of it, each saying so;
 * the payouts do not move (the two add up to zero). A credit note is never reissued: its error of text is corrected by
 * the next document, and only an amount corrects it. Neither is an invoice that has more left than one adjustment of
 * pay carries (`PAY_AMOUNT_MAX_MINOR`, which the base checks on each): its pair could not be written.
 */
export function correctionAdjustments(
  document: ContestedDocument,
  correction: ContestCorrection,
  reason: string,
): CorrectionAdjustment[] {
  const said = reason.trim();
  if (said === '') throw new RangeError('An upheld contest gives its reason');
  const { invoice } = document;
  if (correction.kind === 'amount') {
    if (!Number.isSafeInteger(correction.amountMinor) || correction.amountMinor === 0) {
      throw new RangeError('A correction is a whole amount of cents, never zero');
    }
    if (-correction.amountMinor > invoice.leftMinor) throw new CreditNoteExceedsInvoice(invoice.leftMinor);
    return [{ amountMinor: correction.amountMinor, reason: said }];
  }
  if (document.kind !== 'invoice') throw new InvoiceCorrectionUnprocessable('reissue_credit_note');
  if (invoice.leftMinor <= 0) throw new InvoiceCorrectionUnprocessable('nothing_left');
  if (invoice.leftMinor > PAY_AMOUNT_MAX_MINOR)
    throw new InvoiceCorrectionUnprocessable('above_pay_amount_max');
  return reissuePair(invoice.number, invoice.issuedOn, invoice.leftMinor);
}

/** The cancel, then the reissue, of `leftMinor` of an invoice, each saying which. */
function reissuePair(number: string, issuedOn: string, leftMinor: number): CorrectionAdjustment[] {
  const which = `la facture ${number} du ${longDay(issuedOn)}`;
  return [
    { amountMinor: -leftMinor, reason: `Annulation de ${which}` },
    { amountMinor: leftMinor, reason: `Refacturation de ${which}` },
  ];
}

/** Two lists of adjustments that are the same correction: amount and reason, in order. */
const sameAdjustments = (
  recorded: readonly CorrectionAdjustment[],
  asked: readonly CorrectionAdjustment[],
): boolean =>
  recorded.length === asked.length &&
  recorded.every(
    (one, index) => one.amountMinor === asked[index]?.amountMinor && one.reason === asked[index].reason,
  );

/**
 * Whether the adjustments written when the contest was upheld (`written`, negative first) are the correction asked
 * again, which then writes nothing: the same amount and reason, or the cancel and reissue of the same invoice, for the
 * amount it had left then, whatever it has left now (the cancel may have been issued since).
 */
export function correctionReplayed(
  document: ContestedDocument,
  correction: ContestCorrection,
  reason: string,
  written: readonly CorrectionAdjustment[],
): boolean {
  if (correction.kind === 'amount') {
    return sameAdjustments(written, [{ amountMinor: correction.amountMinor, reason: reason.trim() }]);
  }
  const reissued = written.at(-1)?.amountMinor ?? 0;
  return (
    document.kind === 'invoice' &&
    reissued > 0 &&
    sameAdjustments(written, reissuePair(document.invoice.number, document.invoice.issuedOn, reissued))
  );
}
