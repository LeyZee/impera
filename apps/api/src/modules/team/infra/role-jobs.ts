import { TeamMemberIdSchema, type TeamMemberId } from '@nirvana/contracts';
import { sql, type Database } from '@nirvana/db';
import { z } from 'zod';

const AppliedSchema = z.object({ id: TeamMemberIdSchema });

/**
 * The job `team.apply_roles`, on the admin connection (no account runs it): each record takes the role in force on
 * `today` (`member_roles`), so that a role dated for a later 1st or 16th becomes his on that day, for his access
 * (`withMember` reads the record) as for the screens. Pay does not wait for it: it reads the dated roles. Replayed, it
 * changes nothing more. Returns the members whose role changed.
 */
export async function applyRolesUnscoped(adminDb: Database, today: string): Promise<TeamMemberId[]> {
  const result = await adminDb.execute(sql`
    update team_members m set team_role = due.team_role, updated_at = now()
    from (
      select distinct on (r.member_id) r.member_id, r.team_role from member_roles r
      where r.effective_from <= ${today}::date
      order by r.member_id, r.effective_from desc
    ) due
    where due.member_id = m.id and m.team_role <> due.team_role
    returning m.id`);
  return result.rows.map((row) => AppliedSchema.parse(row).id);
}
