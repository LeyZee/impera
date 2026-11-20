import { AuditEntryIdSchema, newId, PreparedScriptContentSchema } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import type { PreparedRecognitionStore } from '../../domain/ports';

import { nativesOf } from './natives';

const { auditLog, platformScriptBranches, preparedScripts } = schema;

/**
 * The recognition (ADR 0112 § 23) as the service role, in one transaction: the scripts « prêt à copier » of the
 * account, its active native scripts that no script in preparation took and on which the agency set no branch, then
 * the ties. A tie writes the branch settings under the person who made the script ready, closes the script in
 * preparation and leaves a line in `audit_log`. Two imports of the same account at once: the lock on the scripts in
 * preparation makes the second wait, then find them closed.
 */
export function createDrizzlePreparedRecognitionStore(adminDb: Database): PreparedRecognitionStore {
  return {
    recognise: (account, decide, now) =>
      withAdmin(adminDb, async (tx) => {
        const ready = await tx
          .select({
            id: preparedScripts.id,
            content: preparedScripts.content,
            updatedBy: preparedScripts.updatedBy,
          })
          .from(preparedScripts)
          .where(
            and(
              eq(preparedScripts.platformAccountId, account.id),
              eq(preparedScripts.state, 'ready_to_copy'),
            ),
          )
          .orderBy(sql`${preparedScripts.updatedAt}`, sql`${preparedScripts.id}`)
          .for('update');
        if (ready.length === 0) return 0;
        const natives = await nativesOf(tx, account.id, { free: true });
        const byId = new Map(ready.map((row) => [row.id, row]));
        const recognitions = decide(
          ready.map((row) => ({ id: row.id, content: PreparedScriptContentSchema.parse(row.content) })),
          natives,
        );
        for (const recognition of recognitions) {
          const script = byId.get(recognition.preparedId);
          if (script === undefined) continue;
          if (recognition.settings.length > 0)
            await tx.insert(platformScriptBranches).values(
              recognition.settings.map((setting) => ({
                platformScriptId: recognition.nativeId,
                creatorId: account.creatorId,
                platformStepRef: setting.stepRef,
                branchOrder: setting.order,
                condition: setting.condition,
                updatedBy: script.updatedBy,
              })),
            );
          await tx
            .update(preparedScripts)
            .set({ state: 'matched', matchedPlatformScriptId: recognition.nativeId, matchedAt: now })
            .where(eq(preparedScripts.id, recognition.preparedId));
          await tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: null,
            action: 'prepared_script.matched',
            entity: 'prepared_script',
            entityId: recognition.preparedId,
            details: {
              creatorId: account.creatorId,
              platformScriptId: recognition.nativeId,
              settings: recognition.settings.length,
            },
          });
        }
        return recognitions.length;
      }),
  };
}
