import { AuditEntryIdSchema, newId } from '@nirvana/contracts';
import { schema, type Transaction } from '@nirvana/db';

import type { Actor } from '../domain/ports';

/**
 * What pay writes in the audit log: an action on a statement, a period, a member's entry, a team rule, the billing
 * settings, a contractor's file, texts and regimes.
 */
type AuditedAction =
  | 'commission_statement.validate'
  | 'commission_statement.pay'
  | 'pay_period.close'
  | 'bonus.create'
  | 'bonus.cancel'
  | 'penalty.create'
  | 'penalty.cancel'
  | 'pay_adjustment.create'
  | 'bonus_tier_set.create'
  | 'collective_goal.create'
  | 'payout_minimum.create'
  | 'payroll_settings.update'
  | 'billing_settings.update'
  | 'billing_settings.accounts'
  | 'accounting_journal.export'
  | 'accounting_das2.export'
  | 'agency_logo.add'
  | 'contractor_profile.create'
  | 'contractor_profile.update'
  | 'contractor_profile.verify'
  | 'contractor_profile.prefix'
  | 'contract_text.add'
  | 'contract.accept'
  | 'billing_regime.create'
  | 'billing_regime.validate'
  | 'contractor_regime.assign'
  | 'contractor_document.add'
  | 'contractor_document.review';

/** Who did what (append-only, `audit_log`): never a name. */
export async function audit(
  tx: Transaction,
  actor: Actor,
  action: AuditedAction,
  entity: {
    readonly kind:
      | 'commission_statement'
      | 'pay_period'
      | 'bonus'
      | 'penalty'
      | 'pay_adjustment'
      | 'bonus_tier_set'
      | 'collective_goal'
      | 'payout_minimum'
      | 'payroll_settings'
      | 'billing_settings'
      | 'accounting_journal'
      | 'accounting_das2'
      | 'agency_logo'
      | 'contractor_profile'
      | 'contract_text'
      | 'contract_acceptance'
      | 'billing_regime'
      | 'contractor_regime'
      | 'contractor_document';
    readonly id: string;
  },
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: entity.kind,
    entityId: entity.id,
    details,
    ip: actor.ip,
  });
}
