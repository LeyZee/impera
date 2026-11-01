import { DomainError } from '@nirvana/contracts';

/** Error codes of the module (`SCHEDULING_ERROR_CODES`, api.md § Erreurs): the suffix gives the HTTP status. */
export class ShiftNotFound extends DomainError {
  constructor() {
    super('shift_not_found', 'Shift introuvable');
  }
}

export class ShiftTemplateNotFound extends DomainError {
  constructor() {
    super('shift_template_not_found', 'Modèle de shift introuvable');
  }
}

export class MemberNotFound extends DomainError {
  constructor() {
    super('member_not_found', 'Membre introuvable');
  }
}

export class CreatorNotFound extends DomainError {
  constructor() {
    super('creator_not_found', 'Créatrice introuvable');
  }
}

export class PlatformAccountNotFound extends DomainError {
  constructor() {
    super('platform_account_not_found', 'Ce compte n’est pas un compte de cette créatrice');
  }
}

export class MemberNotActive extends DomainError {
  constructor() {
    super('member_left_conflict', 'Ce membre n’est pas actif : il ne reçoit pas de shift');
  }
}

/** A shift that starts before the member's first day: pay would find no rate of theirs for it. */
export class MemberNotJoined extends DomainError {
  constructor(joinedOn: string) {
    super('member_not_joined_conflict', 'Ce membre n’est pas encore arrivé dans l’équipe à cette date', {
      details: { joinedOn },
    });
  }
}

export class MemberCreatorConflict extends DomainError {
  constructor() {
    super('member_creator_conflict', 'Ce membre ne travaille pas sur cette créatrice');
  }
}

export class ShiftMemberConflict extends DomainError {
  constructor(shiftId: string | null) {
    super('shift_member_conflict', 'Ce membre a déjà un shift à ce moment-là', {
      details: shiftId === null ? {} : { shiftId },
    });
  }
}

export class ShiftAccountConflict extends DomainError {
  constructor(shiftId: string | null) {
    super('shift_account_conflict', 'Ce compte a déjà un membre à ce moment-là', {
      details: shiftId === null ? {} : { shiftId },
    });
  }
}

export class ShiftEnded extends DomainError {
  constructor() {
    super('shift_ended_conflict', 'Ce shift est fini : il ne change plus');
  }
}

export class ShiftStarted extends DomainError {
  constructor() {
    super(
      'shift_started_conflict',
      'Ce shift a commencé : on peut seulement le finir plus tôt, l’arrêter ou l’annuler',
    );
  }
}

export class ShiftRangeInvalid extends DomainError {
  constructor() {
    super(
      'shift_range_invalid',
      'Un shift commence et finit à la minute pile, finit après son début et dure 24 heures au plus',
    );
  }
}

export class PlanningRangeInvalid extends DomainError {
  constructor() {
    super('planning_range_invalid', 'La période lue finit après son début et dure six semaines au plus');
  }
}

/** The range of a leaves read (`LEAVE_QUERY_MAX_DAYS`). */
export class LeaveRangeInvalid extends DomainError {
  constructor() {
    super('planning_range_invalid', 'La période lue finit après son début et dure un an au plus');
  }
}

export class ShiftTemplateDateInvalid extends DomainError {
  constructor() {
    super('shift_template_date_invalid', 'Un modèle commence aujourd’hui au plus tôt');
  }
}

/** Planning is the owner's and the active managers' (ADR 0024). */
export class PlanningForbidden extends DomainError {
  constructor() {
    super('role_forbidden', 'Seuls le propriétaire et les managers actifs planifient');
  }
}

/** The settings are the owner's alone. */
export class OwnerOnly extends DomainError {
  constructor() {
    super('role_forbidden', 'Seul le propriétaire règle le planning');
  }
}

/**
 * No shift on a member during their approved leave (ADR 0031). The leave is named only to someone who reads it: never
 * to the colleague who accepts an exchange from a requester on leave.
 */
export class MemberOnLeave extends DomainError {
  constructor(leaveRequestId: string | null) {
    super('member_on_leave_conflict', 'Ce membre est en congé à ce moment-là', {
      details: leaveRequestId === null ? {} : { leaveRequestId },
    });
  }
}

export class LeaveRequestNotFound extends DomainError {
  constructor() {
    super('leave_request_not_found', 'Demande de congé introuvable');
  }
}

/** The same `id` was recorded with other values. */
export class LeaveRequestConflict extends DomainError {
  constructor() {
    super('leave_request_conflict', 'Cette demande de congé existe déjà avec d’autres valeurs');
  }
}

export class LeaveOverlap extends DomainError {
  constructor(leaveRequestId: string | null) {
    super(
      'leave_overlap_conflict',
      'Un autre congé en attente ou validé couvre déjà une partie de ces jours',
      {
        details: leaveRequestId === null ? {} : { leaveRequestId },
      },
    );
  }
}

export class LeaveDecided extends DomainError {
  constructor() {
    super('leave_decided_conflict', 'Cette demande de congé a déjà sa réponse, ou ce congé est fini');
  }
}

/** Approving while shifts of the member still cover the leave: they go to someone else first. */
export class LeaveShifts extends DomainError {
  constructor(shiftIds: readonly string[]) {
    super('leave_shifts_conflict', 'Des shifts du membre tombent encore pendant ce congé', {
      details: { shiftIds: [...shiftIds] },
    });
  }
}

export class LeaveOwnDecision extends DomainError {
  constructor() {
    super('leave_own_decision_forbidden', 'Un manager ne décide pas de son propre congé');
  }
}

export class LeaveDateInvalid extends DomainError {
  constructor() {
    super('leave_date_invalid', 'Un congé commence aujourd’hui au plus tôt');
  }
}

/** A pending request of someone else is refused, never withdrawn by the agency. */
export class LeaveNotWithdrawable extends DomainError {
  constructor() {
    super('role_forbidden', 'Une demande en attente se refuse : seul son membre la retire');
  }
}

export class ShiftSwapNotFound extends DomainError {
  constructor() {
    super('shift_swap_not_found', 'Échange introuvable');
  }
}

/** The same `id` was recorded with other values. */
export class ShiftSwapConflict extends DomainError {
  constructor() {
    super('shift_swap_conflict', 'Cet échange existe déjà avec d’autres valeurs');
  }
}

export class ShiftSwapOpen extends DomainError {
  constructor(shiftSwapRequestId: string | null) {
    super('shift_swap_open_conflict', 'Cette proposition attend déjà sa réponse', {
      details: shiftSwapRequestId === null ? {} : { shiftSwapRequestId },
    });
  }
}

export class ShiftSwapAnswered extends DomainError {
  constructor() {
    super('shift_swap_answered_conflict', 'Cet échange n’est plus proposé');
  }
}

export class ShiftSwapLapsed extends DomainError {
  constructor() {
    super(
      'shift_swap_lapsed_conflict',
      'Cet échange ne tient plus : un des shifts a commencé, a été annulé, ou a changé de mains ou d’heures',
    );
  }
}

export class ShiftSwapRevert extends DomainError {
  constructor() {
    super(
      'shift_swap_revert_conflict',
      'Cet échange ne revient plus en arrière : un des shifts a commencé, ou a changé de mains ou d’heures',
    );
  }
}

export class ShiftSwapSelf extends DomainError {
  constructor() {
    super('shift_swap_self_invalid', 'Un échange se fait avec un collègue');
  }
}

/** Only the colleague asked answers a swap; only its requester or the agency withdraws it. */
export class ShiftSwapNotYours extends DomainError {
  constructor() {
    super(
      'role_forbidden',
      'Seul le collègue sollicité répond à un échange, et il ne le retire pas : il le refuse',
    );
  }
}

/** End-of-shift reports (EQ-03, `SHIFT_REPORT_ERROR_CODES`). */
export class ShiftReportNotFound extends DomainError {
  constructor() {
    super('shift_report_not_found', 'Rapport introuvable');
  }
}

export class ShiftReportConflict extends DomainError {
  constructor() {
    super('shift_report_conflict', 'Ce rapport a déjà été envoyé avec d’autres valeurs');
  }
}

export class ShiftReportExists extends DomainError {
  constructor(shiftReportId: string) {
    super('shift_report_exists_conflict', 'Ce shift a déjà son rapport', { details: { shiftReportId } });
  }
}

export class ShiftReportEarly extends DomainError {
  constructor(opensAt: Date) {
    super('shift_report_early_conflict', 'Le rapport se fait à la fin du shift', {
      details: { opensAt: opensAt.toISOString() },
    });
  }
}

export class ShiftReportChanged extends DomainError {
  constructor(message = 'Ce rapport a changé depuis qu’il a été lu') {
    super('shift_report_changed_conflict', message);
  }
}

export class ShiftReportValidated extends DomainError {
  constructor(message = 'Un rapport validé ne change plus : il se corrige') {
    super('shift_report_validated_conflict', message);
  }
}

export class ShiftReportTotal extends DomainError {
  constructor() {
    super('shift_report_total_conflict', 'Cette correction ferait passer le total validé du shift sous zéro');
  }
}

export class ShiftReportDetected extends DomainError {
  constructor() {
    super(
      'shift_report_detected_conflict',
      'Sur cette quinzaine, la paie de ce compte lit les ventes détectées, pas les rapports',
    );
  }
}

export class ShiftReportCurrency extends DomainError {
  constructor() {
    super(
      'shift_report_currency_conflict',
      'Ce compte ne se déclare pas dans cette devise sur cette quinzaine',
    );
  }
}

export class PayRulesMissing extends DomainError {
  constructor() {
    super(
      'pay_rules_missing_conflict',
      'Les règles de paie de ce compte ne sont pas posées pour cette quinzaine',
    );
  }
}

export class ShiftReportOwnReview extends DomainError {
  constructor() {
    super(
      'shift_report_own_review_forbidden',
      'Ce rapport se relit par quelqu’un d’autre : ton propre shift, ou ce que tu as envoyé',
    );
  }
}

export class ShiftReportForbidden extends DomainError {
  constructor() {
    super('shift_report_forbidden', 'Ce rapport est celui d’un autre membre');
  }
}

/** What Zod refuses at `POST`, held again on a change (`PATCH`): the same 400. */
export class ShiftReportInvalid extends DomainError {
  constructor(message: string) {
    super('request_invalid', message);
  }
}

/** An account's pay rules (EQ-03, `PAY_RULES_ERROR_CODES`). */
export class PayRulesConflict extends DomainError {
  constructor() {
    super('pay_rules_conflict', 'Ces règles ont déjà été posées avec d’autres valeurs');
  }
}

export class PayRulesPeriodConflict extends DomainError {
  constructor(accountPayRulesId: string) {
    super('pay_rules_period_conflict', 'Ce compte a déjà des règles à partir de cette quinzaine', {
      details: { accountPayRulesId },
    });
  }
}

export class PayRulesPeriodInvalid extends DomainError {
  constructor() {
    super(
      'pay_rules_period_invalid',
      'De nouvelles règles partent d’une quinzaine qui n’a pas commencé ; seules les premières d’un compte partent de la quinzaine en cours',
    );
  }
}

export class PayRulesSource extends DomainError {
  constructor() {
    super(
      'pay_rules_source_conflict',
      'Les ventes de ce compte ne sont pas encore relevées : sa paie se lit dans les rapports',
    );
  }
}

export class PayRulesForbidden extends DomainError {
  constructor(message: string) {
    super('role_forbidden', message);
  }
}
