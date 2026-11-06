import { DomainError, PAY_AMOUNT_MAX_MINOR } from '@impera/contracts';

/** A credit note for more than what is left of its invoice (EQ-06): an invoice is never credited below zero. */
export class CreditNoteExceedsInvoice extends DomainError {
  constructor(leftMinor: number) {
    super('credit_note_amount_unprocessable', 'L’avoir dépasse ce qui reste de la facture', {
      details: { leftMinor },
    });
  }
}

/** « 50 000 € »: the most one adjustment of pay carries, in whole euros, from the ceiling itself. */
const PAY_AMOUNT_MAX_WORDS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(PAY_AMOUNT_MAX_MINOR / 100);

/** What the owner reads when a correction is refused, by its reason. */
const CORRECTION_REFUSALS = {
  reissue_credit_note: 'Seule une facture s’annule et se refacture, jamais un avoir',
  nothing_left: 'Les avoirs ont déjà repris toute cette facture : il n’y a rien à refacturer',
  above_pay_amount_max: `Il reste plus de ${PAY_AMOUNT_MAX_WORDS} HT sur cette facture : c’est plus qu’un ajustement de paie ne porte, elle ne s’annule pas et ne se refacture pas en une fois`,
} as const;

/**
 * A correction of an upheld contest that the document does not allow (ADR 0039 § 3): only an invoice is cancelled and
 * reissued, only for what its credit notes left of it, and only while that fits in one adjustment of pay.
 */
export class InvoiceCorrectionUnprocessable extends DomainError {
  constructor(reason: keyof typeof CORRECTION_REFUSALS) {
    super('invoice_correction_unprocessable', CORRECTION_REFUSALS[reason], { details: { reason } });
  }
}

/** A step of an invoice's acceptance that its state or its deadline no longer allows (EQ-06). */
export class InvoiceAcceptanceConflict extends DomainError {
  constructor(state: string) {
    super('invoice_acceptance_conflict', 'Cette étape n’est plus possible pour cette facture', {
      details: { state },
    });
  }
}

/** The document does not exist, or is not the reader's to read (the invoice's policy). */
export class InvoiceNotFound extends DomainError {
  constructor() {
    super('invoice_not_found', 'Facture introuvable');
  }
}

/** Only the contractor answers their invoice or credit note (ADR 0039 § 1): never the owner, a manager or another. */
export class InvoiceAnswerForbidden extends DomainError {
  constructor() {
    super('invoice_answer_forbidden', 'Seul le prestataire répond à sa facture');
  }
}

/** The document's PDF is not rendered yet (ADR 0037 § 5): the screen says « PDF en préparation ». */
export class InvoicePdfNotFound extends DomainError {
  constructor() {
    super('invoice_pdf_not_found', 'PDF en préparation, réessaie dans quelques minutes');
  }
}

/**
 * Neither bucket gave the PDF with its fingerprint (ADR 0037 § 7): both unreachable, or the copy missing too. An
 * altered file is never served; the owner is alerted of a wrong one.
 */
export class InvoicePdfUnavailable extends DomainError {
  constructor() {
    super('invoice_pdf_unavailable', 'Le PDF est momentanément indisponible, réessaie dans un instant');
  }
}

/**
 * The PDF was kept by a store in memory, which lost it when the server restarted (development only: production refuses
 * to start without its buckets). It is never rendered again (ADR 0037), so it is said lost, never « réessaie »
 * (recette EQP-09).
 */
export class InvoicePdfGone extends DomainError {
  constructor() {
    super(
      'invoice_pdf_gone',
      'Ce PDF est perdu : le serveur de développement le gardait en mémoire et l’a oublié en redémarrant',
    );
  }
}

/** A character the PDF would print that its font has no glyph for: the PDF is not rendered (ADR 0037 § 2). */
export class InvoicePdfGlyphMissing extends Error {
  constructor(readonly codePoints: readonly number[]) {
    super(
      `The invoice font has no glyph for ${codePoints.map((one) => `U+${one.toString(16).toUpperCase().padStart(4, '0')}`).join(', ')}`,
    );
    this.name = 'InvoicePdfGlyphMissing';
  }
}
