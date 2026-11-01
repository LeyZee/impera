import type { BonusView, PayAdjustmentView, PenaltyView, TeamScope, UserId } from '@nirvana/contracts';

/** A period's entries as both routes give them: the period's own list, and what a statement counts. */
export interface AuthoredEntries {
  readonly bonuses: readonly BonusView[];
  readonly penalties: readonly PenaltyView[];
  readonly adjustments: readonly PayAdjustmentView[];
}

/**
 * Entries as their reader may see them (EQ-05): the owner and an active manager read who made and cancelled each one;
 * anyone else, closed by default, reads its reason, amount and state, its authors at `null`. The one rule for every
 * route that gives entries: `GET /v1/payroll/entries` and the statements of `GET /v1/payroll/periods/:period`.
 */
export function redactAuthors(
  scope: TeamScope,
  entries: AuthoredEntries,
): { bonuses: BonusView[]; penalties: PenaltyView[]; adjustments: PayAdjustmentView[] } {
  const agency = scope === 'owner' || scope === 'agency';
  const author = (userId: UserId | null): UserId | null => (agency ? userId : null);
  return {
    bonuses: entries.bonuses.map((bonus) => ({
      ...bonus,
      createdBy: author(bonus.createdBy),
      cancellation:
        bonus.cancellation === null
          ? null
          : { ...bonus.cancellation, cancelledBy: author(bonus.cancellation.cancelledBy) },
    })),
    penalties: entries.penalties.map((penalty) => ({
      ...penalty,
      createdBy: author(penalty.createdBy),
      cancellation:
        penalty.cancellation === null
          ? null
          : { ...penalty.cancellation, cancelledBy: author(penalty.cancellation.cancelledBy) },
    })),
    adjustments: entries.adjustments.map((adjustment) => ({
      ...adjustment,
      createdBy: author(adjustment.createdBy),
    })),
  };
}
