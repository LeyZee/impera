import {
  McpPayPeriodInputSchema,
  McpPayPeriodStateSchema,
  UserIdSchema,
  type McpPayPeriodState,
} from '@impera/contracts';

import type { PayrollReader, PeriodStateEntry } from '../domain/ports';

import type { ServedTool } from './dispatch';

/** Why pay could not compute the period, copied by its code: only that code's fields, nothing pay adds besides. */
function blockedOf(blocked: PeriodStateEntry['blocked']): McpPayPeriodState['blocked'] {
  if (blocked === null) return null;
  if (blocked.code === 'commission_rate_missing_conflict')
    return { code: blocked.code, memberIds: [...blocked.memberIds], since: blocked.since };
  return { code: blocked.code, currency: blocked.currency, since: blocked.since };
}

/**
 * The pay tools (ADR 0105 § 3 and § 4, `read:payroll`, `agencyOnly`), read through `payroll` as the access's person,
 * whose role `resolveActor` read for this call. Closed by Charles's decision A (14/11): the state of a period, never
 * an amount of a member; each field copied by hand, so that nothing pay adds one day leaves without a review.
 */
export function payrollTools(payroll: PayrollReader): Readonly<Record<string, ServedTool>> {
  return {
    commission_statements_list: {
      description:
        'L’état d’une quinzaine de paie (`period` = son premier jour, le 1er ou le 16 du mois, par exemple `2026-11-01`) : sa fenêtre, quand l’équipe l’a clôturée, pourquoi la paie n’a pas pu la calculer (`blocked`), le délai de versement annoncé en jours ouvrés ; pour chaque relevé que la personne voit, le membre, le statut (brouillon, validé, payé), la révision, les dates, si son versement attend (sans la raison) et s’il est en retard sur le délai annoncé ; les compteurs ; et les sommes d’équipe (nombre de relevés, total, à verser) seulement pour qui voit toute l’équipe, le total et le montant à verser chacun seulement quand au moins deux relevés y apportent un montant. Sans délai annoncé, le retard est inconnu (`null`). Jamais un montant d’un membre, ni net, ni commission, ni taux. Les jours fériés ne sont pas connus : un retard compte du lundi au vendredi.',
      input: McpPayPeriodInputSchema,
      output: McpPayPeriodStateSchema,
      run: async ({ grant, actor }, input): Promise<McpPayPeriodState> => {
        const { period } = McpPayPeriodInputSchema.parse(input);
        const read = await payroll.periodState(
          { userId: UserIdSchema.parse(grant.userId), role: actor.role },
          period,
        );
        const statements = read.statements.map((one) => ({
          memberId: one.memberId,
          status: one.status,
          revision: one.revision,
          computedAt: one.computedAt,
          validatedAt: one.validatedAt,
          paidAt: one.paidAt,
          payoutBlocked: one.payoutBlocked,
          payoutLate: one.payoutLate,
        }));
        const count = (keep: (one: (typeof statements)[number]) => boolean): number =>
          statements.filter(keep).length;
        return {
          period,
          window:
            read.window === null
              ? null
              : {
                  period: read.window.period,
                  startsAt: read.window.startsAt,
                  endsAt: read.window.endsAt,
                  timeZone: read.window.timeZone,
                },
          closedAt: read.closedAt,
          blocked: blockedOf(read.blocked),
          payoutDelayBusinessDays: read.payoutDelayBusinessDays,
          statements,
          counts: {
            draft: count((one) => one.status === 'draft'),
            validated: count((one) => one.status === 'validated'),
            paid: count((one) => one.status === 'paid'),
            payoutBlocked: count((one) => one.payoutBlocked),
            payoutLate:
              read.payoutDelayBusinessDays === null ? null : count((one) => one.payoutLate === true),
          },
          team:
            read.team === null
              ? null
              : {
                  statements: read.team.statements,
                  totalMinor: read.team.totalMinor,
                  payableMinor: read.team.payableMinor,
                },
        };
      },
    },
  };
}
