import { DomainError, type PayPeriod, type SaleDecisionOutcome } from '@impera/contracts';

import type { PayoutHold } from './ports';

/** Error codes of the module (api.md § Erreurs): the suffix gives the HTTP status. */

/** No usable rate for a currency the period was paid in: pay never guesses a rate (ADR 0023 § Paie). */
export class MissingExchangeRate extends DomainError {
  constructor(readonly currency: string) {
    super('exchange_rate_missing_conflict', 'Aucun taux de change utilisable pour cette devise', {
      details: { currency },
    });
  }
}

/**
 * A member to pay without a commission rate in force on the period's last day: pay never guesses a rate (EQ-01).
 * `details.memberId` is the first; `memberIds`, every member of the period without one, for the period's block.
 */
export class CommissionRateMissing extends DomainError {
  readonly memberIds: readonly [string, ...string[]];

  constructor(memberId: string, ...others: readonly string[]) {
    super('commission_rate_missing_conflict', 'Aucun taux de commission en vigueur pour ce membre', {
      details: { memberId },
    });
    this.memberIds = [memberId, ...others];
  }
}

export class CommissionStatementNotFound extends DomainError {
  constructor() {
    super('commission_statement_not_found', 'Relevé introuvable');
  }
}

/** A page cursor the periods' list did not give (api.md § Pagination). */
export class PayPeriodCursorInvalid extends DomainError {
  constructor() {
    super('cursor_invalid', 'Curseur de pagination invalide');
  }
}

export class BonusNotFound extends DomainError {
  constructor() {
    super('bonus_not_found', 'Prime introuvable');
  }
}

/**
 * A sale the period neither holds nor pays a member for as the validator reads it (CRM-03 lot b3): closed, counted by
 * a closing, the agent's, without a chatter, or of a creator they do not see.
 */
export class PaySaleNotFound extends DomainError {
  constructor() {
    super('pay_sale_not_found', 'Cette vente n’attend aucune décision dans cette quinzaine');
  }
}

/** A line that is not on the member's own statement of the period (CRM-03 lot b4c). */
export class PaySaleSignalNotFound extends DomainError {
  constructor() {
    super('pay_sale_signal_not_found', 'Cette vente n’est pas sur ton relevé de cette quinzaine');
  }
}

/** A line already signalled, or a withdrawal without a signal in force (CRM-03 lot b4c). */
export class PaySaleSignalStateConflict extends DomainError {
  constructor(kind: 'signal' | 'withdraw') {
    super(
      'pay_sale_signal_state_conflict',
      kind === 'signal' ? 'Cette vente est déjà signalée' : 'Cette vente n’est pas signalée',
    );
  }
}

/** An outcome the sale does not offer now (`saleDecisionsOpen`): `details.outcomes` says those it does. */
export class PaySaleOutcomeConflict extends DomainError {
  constructor(outcomes: readonly SaleDecisionOutcome[]) {
    super('pay_sale_outcome_conflict', 'Cette décision n’est pas possible pour cette vente', {
      details: { outcomes: [...outcomes] },
    });
  }
}

export class PenaltyNotFound extends DomainError {
  constructor() {
    super('penalty_not_found', 'Malus introuvable');
  }
}

/** One's own statement, bonus, penalty or adjustment: four eyes, a member never decides their own pay (ADR 0023 § Paie). */
export class PayrollOwnForbidden extends DomainError {
  constructor() {
    super('payroll_own_forbidden', 'Un membre ne décide jamais de sa propre paie');
  }
}

/** Validating what is not a draft, paying what is not validated (once), correcting a draft. */
export class CommissionStatementStatusConflict extends DomainError {
  constructor(message = 'Ce relevé n’est plus un brouillon') {
    super('commission_statement_status_conflict', message);
  }
}

/**
 * Another revision, or other inputs, than the reader saw: they validate what they read, never a statement they did not
 * see. `period` is the statement's, for its recalculation once the transaction is undone.
 */
export class CommissionStatementChanged extends DomainError {
  constructor(readonly period: PayPeriod) {
    super('commission_statement_changed_conflict', 'Le relevé a changé depuis son affichage');
  }
}

/**
 * A final statement of a member who left while some of his documents still await an answer or stay contested (EQ-14,
 * ADR 0039 § 6): it waits for them, its period carrying their corrections.
 */
export class CommissionStatementDocumentsOpen extends DomainError {
  constructor(count: number) {
    super(
      'commission_statement_documents_open_conflict',
      'Ce relevé final attend que ses factures et avoirs soient acceptés ou que leurs contestations soient tranchées',
      { details: { count } },
    );
  }
}

/**
 * A transfer whose documents are not all issued, or under a tax treaty without the contractor's tax residence
 * certificate of its calendar year accepted by the owner (ADR 0041 § 2 and § 4): no transfer without its invoice, and
 * the agency never withholds 25 %, it does not pay.
 */
export class PayoutBlocked extends DomainError {
  constructor(hold: PayoutHold) {
    super('payout_blocked_conflict', payoutBlockedMessage(hold), {
      details: { reason: hold.reason, year: hold.year },
    });
  }
}

function payoutBlockedMessage(hold: PayoutHold): string {
  switch (hold.reason) {
    case 'documents_not_issued':
      return 'Versement bloqué : les factures et avoirs de ce versement ne sont pas tous émis';
    case 'tax_residence_missing':
      return `Versement bloqué : l’attestation de résidence fiscale ${hold.year} de ce prestataire manque`;
    case 'tax_residence_unverified':
      return `Versement bloqué : l’attestation de résidence fiscale ${hold.year} de ce prestataire attend ta vérification`;
  }
}

/** A period that has not ended in the agency's zone. */
export class CommissionStatementOpen extends DomainError {
  constructor() {
    super('commission_statement_open_conflict', 'La quinzaine n’est pas terminée');
  }
}

/** An earlier statement of the member is still a draft, or pay has not written it yet: periods close in order. */
export class CommissionStatementOrder extends DomainError {
  constructor(details: { readonly statementId: string } | { readonly period: PayPeriod }) {
    super('commission_statement_order_conflict', 'Un relevé plus ancien de ce membre attend sa validation', {
      details,
    });
  }
}

/** An earlier period of the team gives statements that are not validated: periods close in order (ADR 0032). */
export class PayPeriodOrder extends DomainError {
  constructor(period: PayPeriod) {
    super('pay_period_order_conflict', 'Une quinzaine plus ancienne attend sa validation', {
      details: { period },
    });
  }
}

/** Reports of the period still wait for review: closing now would send them to the next period unseen (ADR 0032). */
export class PayPeriodReportsPending extends DomainError {
  constructor(count: number) {
    super('pay_period_reports_pending_conflict', 'Des rapports de la quinzaine attendent leur relecture', {
      details: { count },
    });
  }
}

/**
 * Pay has not written a period the closing goes through (its hourly job has not run since the period began): there is
 * nothing to close it on. The next run writes it; one that never comes means the worker is down.
 */
export class PayPeriodNotComputed extends DomainError {
  constructor(period: PayPeriod) {
    super('pay_period_not_computed_conflict', 'La paie n’a pas encore calculé cette quinzaine', {
      details: { period },
    });
  }
}

/** The closing could not read reports it counts (a creator the validator does not see): it never leaves one out. */
export class PayPeriodReportsUnread extends DomainError {
  constructor(count: number) {
    super('pay_period_reports_unread_conflict', 'Des rapports de la quinzaine échappent à cette validation', {
      details: { count },
    });
  }
}

/**
 * Sales of the platform a member would be paid for in the periods to close that the validating member may not read
 * (CRM-03): the closing would leave them behind, so it refuses, as for reports.
 */
export class PayPeriodSalesUnread extends DomainError {
  constructor(count: number) {
    super('pay_period_sales_unread_conflict', 'Des ventes de la quinzaine échappent à cette validation', {
      details: { count },
    });
  }
}

/**
 * A bonus, a penalty or an adjustment for a period the member's validated statements have closed, or tiers and a goal
 * for a period some statement is validated for, or an earlier one (EQ-04).
 */
export class PayPeriodClosed extends DomainError {
  constructor(
    period: PayPeriod,
    {
      forTeam = false,
      beforeJoining = false,
    }: { readonly forTeam?: boolean; readonly beforeJoining?: boolean } = {},
  ) {
    super(
      'pay_period_closed_conflict',
      forTeam
        ? 'Un relevé de cette quinzaine, ou d’une plus récente, est déjà validé'
        : beforeJoining
          ? 'Cette quinzaine est d’avant l’arrivée de ce membre'
          : 'Cette quinzaine est déjà validée pour ce membre',
      { details: { period } },
    );
  }
}

/** Every period of the penalty is closed for the member: a cancellation would change nothing. */
export class PenaltyCancelConflict extends DomainError {
  constructor() {
    super('penalty_cancel_conflict', 'Toutes les quinzaines de ce malus sont déjà validées');
  }
}

/** The same `id` sent again with other values: a retry gives back what was recorded, never something else. */
export class PayEntryConflict extends DomainError {
  constructor(
    code:
      | 'bonus_conflict'
      | 'penalty_conflict'
      | 'pay_adjustment_conflict'
      | 'bonus_tier_set_conflict'
      | 'collective_goal_conflict'
      | 'payout_minimum_conflict'
      | 'pay_sale_decision_conflict'
      | 'pay_sale_signal_conflict',
  ) {
    super(code, 'Cet identifiant est déjà pris par une autre saisie');
  }
}

/** A payment dated after today in the agency's zone: pay records a transfer made, never one to come. */
export class PaymentInFuture extends DomainError {
  constructor(today: string) {
    super('payment_in_future_unprocessable', 'Un paiement ne se date pas après aujourd’hui', {
      details: { today },
    });
  }
}

/**
 * A payment dated before its statement's period began: most likely a slip of the year, which a paid statement would
 * keep forever (EQ-05, Bilan).
 */
export class PaymentBeforePeriod extends DomainError {
  constructor(period: PayPeriod) {
    super(
      'payment_before_period_unprocessable',
      'Un paiement ne se date pas avant le début de sa quinzaine',
      {
        details: { period },
      },
    );
  }
}

/** An amount sent that is not what the statement pays (EQ-05: the default while another amount has no rule). */
export class PaymentAmountMismatch extends DomainError {
  constructor(payableMinor: number) {
    super('payment_amount_unprocessable', 'Le montant envoyé n’est pas celui à verser', {
      details: { payableMinor },
    });
  }
}

/** More entries of a kind in one period than the list gives (EQ-05): it refuses rather than cut one short. */
export class PayrollEntriesTooMany extends DomainError {
  constructor(max: number) {
    super('payroll_entries_too_many_unprocessable', 'Trop de saisies sur cette quinzaine pour les lister', {
      details: { max },
    });
  }
}

/** A bonus for a period after the next one: a slip of the year, refused as the body it is (400). */
export class PayPeriodTooFar extends DomainError {
  constructor(period: PayPeriod) {
    super('request_invalid', 'Une prime vise la quinzaine en cours, une passée ou la suivante', {
      details: { period },
    });
  }
}

/**
 * PAIE-22: tiers or a payout minimum from a period that has begun (400). A pay rule starts with a fortnight not worked
 * yet, as a commission rate does: it never changes under a chatter's feet.
 */
export class PayRuleStarted extends DomainError {
  constructor(period: PayPeriod) {
    super('pay_rule_started_invalid', 'Une règle de paie part d’une quinzaine qui n’a pas commencé', {
      details: { period },
    });
  }
}

/** PAIE-22: a collective goal set after the 3rd day of its period (400). */
export class CollectiveGoalLate extends DomainError {
  constructor(period: PayPeriod) {
    super('collective_goal_late_invalid', 'L’objectif d’une quinzaine se pose au plus tard son 3e jour', {
      details: { period },
    });
  }
}
