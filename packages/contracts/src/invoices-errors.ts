/**
 * The invoices' error codes (EQ-06).
 */

/**
 * The refusals of the invoices' rules (EQ-06), each suffix setting its status (api.md). Kept apart from
 * `PAYROLL_ERROR_CODES` until the invoices' screens word them (lot 8).
 */
export const INVOICE_ERROR_CODES = [
  /** A logo the server refuses to keep, with its reason in `details.reason` (`AGENCY_LOGO_REFUSALS`). */
  'agency_logo_invalid',
  /** No logo was added with this fingerprint. */
  'agency_logo_not_found',
  /** Réglages › Facturation is not saved yet: the accounts come after it. */
  'billing_settings_missing_conflict',
  'billing_regime_backdated_unprocessable',
  /** The regime is not one of the contractor's country: its mentions and its VAT are another country's. */
  'billing_regime_country_unprocessable',
  /** The same id sent again with another regime. */
  'billing_regime_id_conflict',
  'billing_regime_not_found',
  /** The accountant's validation is recorded already, on another day: it is recorded once. */
  'billing_regime_validated_conflict',
  /** A validation recorded for a day still to come. */
  'billing_regime_validation_future_unprocessable',
  /** The same id sent again with another contractor, regime or day. */
  'contractor_regime_id_conflict',
  /** The same id sent again with another file or other dates. */
  'contractor_document_id_conflict',
  /** A file the server refuses to keep, with its reason in `details.reason` (`CONTRACTOR_DOCUMENT_REFUSALS`). */
  'contractor_document_invalid',
  /** A date of issue still to come. */
  'contractor_document_issued_future_unprocessable',
  'contractor_document_not_found',
  /** The owner checked it already, otherwise: a document is checked once. */
  'contractor_document_reviewed_conflict',
  /** The bucket did not give the file with its fingerprint: never an altered file. */
  'contractor_document_unavailable',
  /**
   * The file of a refused document, erased once its upload lock ended (« ok purge a » de Charles, 01/11): its row, its
   * reason and its fingerprint stay.
   */
  'contractor_document_file_gone',
  'credit_note_amount_unprocessable',
  'invoice_acceptance_conflict',
  /** Only the contractor answers their document: never the owner, a manager or another member (ADR 0039 § 1). */
  'invoice_answer_forbidden',
  /**
   * A correction the document does not allow (ADR 0039 § 3), its reason in `details.reason`: `reissue_credit_note`
   * (only an invoice is cancelled and reissued), `nothing_left` (its credit notes took it off whole already),
   * `above_pay_amount_max` (what it has left is more than one adjustment of pay carries, `PAY_AMOUNT_MAX_MINOR`).
   */
  'invoice_correction_unprocessable',
  /** The invoice does not exist, or is not the reader's. */
  'invoice_not_found',
  /** The export needs every account and journal: those missing in `details.missing` (`JOURNAL_ACCOUNT_NAMES`). */
  'journal_accounts_missing_unprocessable',
  /** Its PDF is not rendered yet (« PDF en préparation », ADR 0037 § 5). */
  'invoice_pdf_not_found',
  /** Neither bucket gave the PDF with its fingerprint: never an altered file (ADR 0037 § 7). */
  'invoice_pdf_unavailable',
  /** Only the contractor accepts his contract and his mandate, never the owner nor a manager for him. */
  'contract_acceptance_forbidden',
  /** The text the screen showed is not this version's: the contractor accepts only what he read. */
  'contract_text_changed_conflict',
  /** The same id sent again with another text. */
  'contract_text_id_conflict',
  'contract_text_not_found',
  /** A newer version of this kind replaced it: the contractor reads and accepts that one. */
  'contract_text_superseded_conflict',
  /** The file changed since the owner read it: he checks again what he sees. */
  'contractor_profile_changed_conflict',
  /** A manager, or another member, writing a contractor's file: only the contractor and the owner write it. */
  'contractor_profile_forbidden',
  /** The contractor has not written his file yet. */
  'contractor_profile_not_found',
  /** The contractor's first invoice froze his prefix. */
  'invoice_prefix_frozen_conflict',
  /** Another contractor holds this prefix. */
  'invoice_prefix_taken_conflict',
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];
