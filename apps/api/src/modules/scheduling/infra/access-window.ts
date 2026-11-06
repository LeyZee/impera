import { and, enterCreator, eq, schema, sql, withMember, type Database } from '@impera/db';

import type { JobLogger } from '../domain/ports';
import { creatorsInAccessWindow, DEFAULT_SCHEDULING_SETTINGS } from '../domain/shifts';

const { schedulingSettings, shifts, teamMembers } = schema;

/**
 * Those of a member's creators whose access window is open now (ADR 0025, EQ-13): his own shifts there, not cancelled,
 * while he is `active`, widened by the planning's margin. Never a creator outside the list given: a shift planned on
 * another one opens nothing (reco 8: a member reaches only the creators of his list). Never rejects.
 */
export type ShiftCreators = (userId: string, creatorIds: readonly string[]) => Promise<string[]>;

interface ShiftAccessDeps {
  readonly logger: JobLogger;
  /** Tests move it to open or close a window; the system's otherwise. */
  readonly now?: () => Date;
}

/**
 * Read at each request on the app connection, as the member himself and creator by creator (the policies of `shifts`
 * read one creator at a time and give him his own rows only), never from a cache: a shift cancelled, moved, shortened
 * or stopped counts as it now is from the next request on. One indexed statement per creator of his list
 * (`shifts_member_end_idx`), the margin read inside it; the window itself is the domain's. A read that fails closes:
 * no creator, never an error, so his other screens still answer and nothing opens wider (security.md, fail closed).
 */
export function createShiftAccessReader(db: Database, deps: ShiftAccessDeps): ShiftCreators {
  const now = deps.now ?? (() => new Date());
  return async (userId, creatorIds) => {
    if (creatorIds.length === 0) return [];
    const at = now();
    const margin = sql<number>`coalesce((select ${schedulingSettings.accessMarginMinutes} from ${schedulingSettings}), ${DEFAULT_SCHEDULING_SETTINGS.accessMarginMinutes})`;
    try {
      return await withMember(db, userId, async (tx) => {
        const rows = [];
        for (const creatorId of creatorIds) {
          await enterCreator(tx, creatorId, creatorIds);
          rows.push(
            ...(await tx
              .select({
                creatorId: shifts.creatorId,
                startsAt: shifts.startsAt,
                endsAt: shifts.endsAt,
                stoppedAt: shifts.stoppedAt,
                margin: sql<number>`${margin}::int`,
              })
              .from(shifts)
              .innerJoin(teamMembers, eq(teamMembers.id, shifts.memberId))
              .where(
                and(
                  eq(shifts.creatorId, creatorId),
                  eq(teamMembers.userId, userId),
                  eq(teamMembers.status, 'active'),
                  sql`${shifts.cancelledAt} is null`,
                  sql`${shifts.endsAt} > ${at.toISOString()}::timestamptz - make_interval(mins => ${margin})`,
                  sql`${shifts.startsAt} <= ${at.toISOString()}::timestamptz + make_interval(mins => ${margin})`,
                ),
              )),
          );
        }
        const [first] = rows;
        return first === undefined ? [] : creatorsInAccessWindow(rows, at, first.margin);
      });
    } catch (error) {
      deps.logger.warn({ err: error, userId }, 'shift access window unreadable: closed');
      return [];
    }
  };
}
