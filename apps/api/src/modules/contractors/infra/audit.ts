import { AuditEntryIdSchema, newId } from '@nirvana/contracts';
import { schema, type Transaction } from '@nirvana/db';

import type { Actor } from '../domain/ports';

/** What the contractors' file writes in the audit log: the billing settings, a contractor's file, texts, regimes, documents. */
type AuditedAction =
  | 'billing_settings.update'
  | 'billing_settings.accounts'
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
      | 'billing_settings'
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
