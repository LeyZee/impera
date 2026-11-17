import { AuditEntryIdSchema, newId, type CreatorId } from '@impera/contracts';
import { and, eq, inArray, onCreatorList, schema, withTenantMember, type Database } from '@impera/db';

import type { ScriptBranchStore } from '../../domain/ports';

const { auditLog, platformScriptBranches, platformScripts, platformScriptSteps } = schema;

/**
 * The agency's settings of a script's branches (ADR 0112 § A 3): in the person's transaction, under her RLS and the
 * team's scope (the owner, an active manager of her list, as her scripts are read); her own account is closed by the
 * base. The step's branches are read again in the same transaction: the branches named must be exactly those it has
 * now, or nothing is written (`stale`). Anyone else gets `not_found`, for a script that exists and one that does not.
 */
export function createDrizzleScriptBranchStore(db: Database): ScriptBranchStore {
  return {
    setStep: (creatorId: CreatorId, scriptId, platformIndex, branches, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner' && scope !== 'agency') return 'not_found';
        if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) return 'not_found';
        const [script] = await tx
          .select({ id: platformScripts.id })
          .from(platformScripts)
          .where(and(eq(platformScripts.id, scriptId), eq(platformScripts.creatorId, creatorId)));
        if (script === undefined) return 'not_found';
        const current = (
          await tx
            .select({ ref: platformScriptSteps.platformStepRef })
            .from(platformScriptSteps)
            .where(
              and(
                eq(platformScriptSteps.platformScriptId, scriptId),
                eq(platformScriptSteps.platformIndex, platformIndex),
              ),
            )
        ).map((row) => row.ref);
        if (current.length < 2) return 'not_found';
        const named = branches.map((branch) => branch.stepRef);
        if (new Set(named).size !== named.length || named.length !== current.length) return 'stale';
        if (named.some((ref) => !current.includes(ref))) return 'stale';

        await tx
          .delete(platformScriptBranches)
          .where(
            and(
              eq(platformScriptBranches.platformScriptId, scriptId),
              inArray(platformScriptBranches.platformStepRef, named),
            ),
          );
        await tx.insert(platformScriptBranches).values(
          branches.map((branch, order) => ({
            platformScriptId: scriptId,
            creatorId,
            platformStepRef: branch.stepRef,
            branchOrder: order,
            condition: branch.condition,
            updatedBy: userId,
          })),
        );
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'platform_script.branches_set',
          entity: 'platform_script',
          entityId: scriptId,
          details: { creatorId, platformIndex, branches: named.length },
        });
        return 'set';
      }),
  };
}
