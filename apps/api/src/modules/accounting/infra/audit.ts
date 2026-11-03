import { AuditEntryIdSchema, newId } from '@impera/contracts';
import { schema, type Transaction } from '@impera/db';

import type { Actor } from '../../contractors/pure';

/** What the accountant's exports write in the audit log. */
type AuditedAction = 'accounting_journal.export' | 'accounting_das2.export' | 'accounting_archive.export';

/** Who did what (append-only, `audit_log`): never a name. */
export async function audit(
  tx: Transaction,
  actor: Actor,
  action: AuditedAction,
  entity: {
    readonly kind: 'accounting_journal' | 'accounting_das2' | 'accounting_archive';
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
