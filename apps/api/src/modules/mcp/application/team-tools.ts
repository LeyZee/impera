import {
  CreatorIdSchema,
  McpCreatorInputSchema,
  McpOnShiftNowSchema,
  McpShiftsInputSchema,
  McpShiftsListSchema,
  McpTeamImportInputSchema,
  McpTeamImportListSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type McpOnShiftNow,
  type McpShiftsList,
  type McpTeamImportList,
} from '@impera/contracts';

import type { ShiftReader, TeamImportReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

/**
 * The tools of the team (ADR 0026 § 5, ADR 0105 § 6, `read:team`), read through `scheduling` as the access's person,
 * whose role `resolveActor` read for this call (never the caller's word). Each field copied one by one.
 */
export function teamTools(
  shifts: ShiftReader,
  team: TeamImportReader,
  now: () => Date = () => new Date(),
): Readonly<Record<string, ServedTool>> {
  return {
    shifts_list: {
      description:
        'Le planning sur une période (de `from` à `to`, 42 jours au plus) pour les créatrices de cet accès (la sienne pour un accès borné, sinon celles que tu lis ; un manager, seulement ce qu’il planifie) : chaque shift, sa créatrice, son membre par son nom, son début, sa fin, arrêté en cours ou non. Jamais un compte de plateforme, un modèle de shift, une marge, un taux ni un montant.',
      input: McpShiftsInputSchema,
      output: McpShiftsListSchema,
      run: async ({ grant, actor, creatorId }, input): Promise<McpShiftsList> => {
        const { from, to } = McpShiftsInputSchema.parse(input);
        const creators = creatorId === null ? actor.readableCreatorIds : [creatorId];
        const entries = await shifts.shifts({ userId: grant.userId, role: actor.role }, creators, {
          from: new Date(from),
          to: new Date(to),
        });
        return {
          shifts: entries.map((entry) => ({
            shiftId: ShiftIdSchema.parse(entry.id),
            creatorId: CreatorIdSchema.parse(entry.creatorId),
            memberId: TeamMemberIdSchema.parse(entry.memberId),
            memberName: entry.memberName,
            startsAt: new Date(entry.startsAt).toISOString(),
            endsAt: new Date(entry.endsAt).toISOString(),
            stopped: entry.stopped,
          })),
        };
      },
    },
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
    team_import_list: {
      description:
        'L’équipe importée d’une plateforme (Reveal si aucune n’est nommée), sur un accès d’agence seulement : chaque compte de chatteur lié à un membre (par son nom) ou à l’agent, retiré par la plateforme ou non, et les comptes de la dernière lecture (nouveaux, retraits, lecture anormale). Jamais l’identifiant d’un compte de plateforme, un montant ni un taux.',
      input: McpTeamImportInputSchema,
      output: McpTeamImportListSchema,
      run: async ({ grant }, input): Promise<McpTeamImportList> => {
        const { platform } = McpTeamImportInputSchema.parse(input);
        const read = await team.teamImport(grant.userId, platform ?? 'reveal');
        return {
          platform: read.platform,
          accounts: read.accounts.map((account) => ({
            link:
              account.link.kind === 'member'
                ? {
                    kind: 'member',
                    memberId: TeamMemberIdSchema.parse(account.link.memberId),
                    memberName: account.link.memberDisplayName,
                  }
                : { kind: 'agent' },
            removed: account.removed,
          })),
          newCount: read.newCount,
          removalCount: read.removalCount,
          abnormalRead: read.abnormalRead,
        };
      },
    },
  };
}
