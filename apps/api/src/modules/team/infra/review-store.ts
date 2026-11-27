import {
  FaultLevelSchema,
  RemarkRulingSchema,
  TeamMemberIdSchema,
  type FaultCode,
  type FaultLevel,
} from '@impera/contracts';
import { and, eq, inArray, onCreatorList, schema, withTenantMember, type Database } from '@impera/db';

import type { ReviewStore, StoredContest } from '../application/review';

const {
  chatterFaultExplanations,
  chatterFaultLevels,
  chatterRemarkContests,
  chatterRemarkRulings,
  shifts,
  teamMembers,
} = schema;

/**
 * The `team` side of the chatter review (migration 0281), each read and write under `withTenantMember`: the policies
 * decide who reads and writes what, the store only asks.
 */
export function createDrizzleReviewStore(db: Database): ReviewStore {
  return {
    async memberOf(creatorId, userId) {
      return withTenantMember(db, creatorId, userId, async (tx) => {
        const [row] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(eq(teamMembers.userId, userId))
          .limit(1);
        return row === undefined ? null : TeamMemberIdSchema.parse(row.id);
      });
    },

    async shiftMember(creatorId, userId, shiftId) {
      return withTenantMember(db, creatorId, userId, async (tx) => {
        const [row] = await tx
          .select({ id: teamMembers.id })
          .from(shifts)
          .innerJoin(teamMembers, eq(teamMembers.id, shifts.memberId))
          .where(and(eq(shifts.id, shiftId), eq(shifts.creatorId, creatorId), eq(teamMembers.userId, userId)))
          .limit(1);
        return row === undefined ? null : TeamMemberIdSchema.parse(row.id);
      });
    },

    async levels(creatorId, userId, codes) {
      if (codes.length === 0) return new Map();
      return withTenantMember(db, creatorId, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(chatterFaultLevels)
          .where(inArray(chatterFaultLevels.faultCode, [...codes]));
        return new Map<string, { level: FaultLevel; label: string }>(
          rows.map((r) => [r.faultCode, { level: FaultLevelSchema.parse(r.level), label: r.label }]),
        );
      });
    },

    async explanations(creatorId, userId, memberId, codes) {
      if (codes.length === 0) return new Map();
      return withTenantMember(db, creatorId, userId, async (tx) => {
        const rows = await tx
          .select({ faultCode: chatterFaultExplanations.faultCode, at: chatterFaultExplanations.explainedAt })
          .from(chatterFaultExplanations)
          .where(
            and(
              eq(chatterFaultExplanations.memberId, memberId),
              inArray(chatterFaultExplanations.faultCode, [...codes]),
            ),
          );
        return new Map(rows.map((r) => [r.faultCode, r.at]));
      });
    },

    async contests(creatorId, userId, remarkIds) {
      if (remarkIds.length === 0) return new Map();
      return withTenantMember(db, creatorId, userId, async (tx) => {
        const rows = await tx
          .select({
            remarkId: chatterRemarkContests.remarkId,
            reason: chatterRemarkContests.reason,
            ruling: chatterRemarkRulings.ruling,
          })
          .from(chatterRemarkContests)
          .leftJoin(chatterRemarkRulings, eq(chatterRemarkRulings.remarkId, chatterRemarkContests.remarkId))
          .where(inArray(chatterRemarkContests.remarkId, [...remarkIds]));
        return new Map<string, StoredContest>(
          rows.map((r) => [
            r.remarkId,
            { reason: r.reason, ruling: r.ruling === null ? null : RemarkRulingSchema.parse(r.ruling) },
          ]),
        );
      });
    },

    async recordExplanations(creatorId, userId, memberId, rows) {
      const byCode = new Map<FaultCode, string>();
      for (const row of rows) if (!byCode.has(row.faultCode)) byCode.set(row.faultCode, row.remarkId);
      await withTenantMember(db, creatorId, userId, async (tx) => {
        // A code the owner has not saved has no level yet: nothing to explain until he does.
        const known = await tx
          .select({ faultCode: chatterFaultLevels.faultCode })
          .from(chatterFaultLevels)
          .where(inArray(chatterFaultLevels.faultCode, [...byCode.keys()]));
        const saved = new Set(known.map((k) => k.faultCode));
        const values = [...byCode]
          .filter(([faultCode]) => saved.has(faultCode))
          .map(([faultCode, remarkId]) => ({ creatorId, memberId, faultCode, remarkId }));
        if (values.length > 0) await tx.insert(chatterFaultExplanations).values(values).onConflictDoNothing();
      });
    },

    async contest(creatorId, userId, memberId, remarkId, reason) {
      await withTenantMember(db, creatorId, userId, (tx) =>
        tx
          .insert(chatterRemarkContests)
          .values({ remarkId, creatorId, memberId, reason })
          .onConflictDoNothing(),
      );
    },

    async rule(creatorId, userId, remarkId, ruling) {
      return withTenantMember(db, creatorId, userId, async (tx, scope) => {
        const manages =
          scope === 'owner' || (scope === 'agency' && (await onCreatorList(tx, userId, creatorId)));
        if (!manages) return 'forbidden';
        const [contest] = await tx
          .select({ memberId: chatterRemarkContests.memberId, mine: teamMembers.userId })
          .from(chatterRemarkContests)
          .innerJoin(teamMembers, eq(teamMembers.id, chatterRemarkContests.memberId))
          .where(eq(chatterRemarkContests.remarkId, remarkId));
        if (contest === undefined) return 'not_found';
        if (contest.mine === userId) return 'forbidden';
        await tx
          .insert(chatterRemarkRulings)
          .values({ remarkId, creatorId, ruling, saidBy: userId })
          .onConflictDoNothing();
        return 'ruled';
      });
    },
  };
}
