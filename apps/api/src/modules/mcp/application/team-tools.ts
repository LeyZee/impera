import {
  CreatorIdSchema,
  McpCreatorInputSchema,
  McpOnShiftNowSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type McpOnShiftNow,
} from '@impera/contracts';

import type { ShiftReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

/**
 * The tools of the team (ADR 0026 § 5, ADR 0105 § 6, `read:team`), read through `scheduling` as the access's person,
 * whose role `resolveActor` read for this call (never the caller's word). Each field copied one by one.
 */
export function teamTools(
  shifts: ShiftReader,
  now: () => Date = () => new Date(),
): Readonly<Record<string, ServedTool>> {
  return {
    on_shift_now: {
      description:
        'Qui est en shift maintenant sur les créatrices de cet accès (la sienne pour un accès borné, sinon celles que tu lis ; un manager, seulement ce qu’il planifie) : le shift, le membre par son nom, la fin. Jamais un compte de plateforme, une marge ni un taux.',
      input: McpCreatorInputSchema,
      output: McpOnShiftNowSchema,
      run: async ({ grant, actor, creatorId }): Promise<McpOnShiftNow> => {
        // Confined to the access's creator, or the one named; else those the person reads now.
        const creators = creatorId === null ? actor.readableCreatorIds : [creatorId];
        const entries = await shifts.onShiftNow({ userId: grant.userId, role: actor.role }, creators, now());
        return {
          onShift: entries.map((entry) => ({
            shiftId: ShiftIdSchema.parse(entry.shiftId),
            creatorId: CreatorIdSchema.parse(entry.creatorId),
            memberId: TeamMemberIdSchema.parse(entry.memberId),
            memberName: entry.memberName,
            endsAt: new Date(entry.endsAt).toISOString(),
          })),
        };
      },
    },
  };
}
