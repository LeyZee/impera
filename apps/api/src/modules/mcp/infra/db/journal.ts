import { AuditEntryIdSchema, newId } from '@impera/contracts';
import { schema, withMember, type Database } from '@impera/db';

import type { McpJournal } from '../../domain/ports';

/**
 * Each call of an agent in `audit_log` (ADR 0026 § 8), as its person inside `withMember`, never by the service role
 * (ADR 0105 § 5). The action is `mcp.<tool>`, `mcp.tool_unknown` for a name outside the catalogue: the category of the
 * agents' calls. Never a text, an argument nor the token.
 */
export function createDrizzleJournal(db: Database): McpJournal {
  return {
    record: (entry) =>
      withMember(db, entry.userId, async (tx) => {
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: entry.userId,
          action: `mcp.${entry.tool ?? 'tool_unknown'}`,
          entity: 'mcp_grant',
          entityId: entry.grantId,
          ip: entry.ip,
          details: {
            outcome: entry.outcome,
            creatorId: entry.creatorId,
            subject: entry.subject,
            requestId: entry.requestId,
          },
        });
      }),
  };
}
