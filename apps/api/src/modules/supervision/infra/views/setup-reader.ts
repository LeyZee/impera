import {
  CreatorIdSchema,
  TeamMemberIdSchema,
  TeamRoleSchema,
  type CreatorId,
  type TeamMemberId,
  type TeamRole,
} from '@impera/contracts';
import { sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import { modeOf } from '../../domain/dashboard';
import type { CreatorSetupFacts, Invitation, MemberSetupFacts } from '../../domain/setup';

/** Whether an urgent alert reaches a group for each creator (`telegram`'s coverage); `null` when Telegram is off. */
export type TelegramReach = () => Promise<ReadonlyMap<CreatorId, boolean> | null>;

/**
 * What stops the first invoice of each member on `day` (invoicing's `invoiceReadiness`), `null` when it could go out.
 * A port: supervision reads no invoicing table itself.
 */
export type BillingReadiness = (
  memberIds: readonly TeamMemberId[],
  day: string,
) => Promise<ReadonlyMap<TeamMemberId, MemberSetupFacts['billing']>>;

export interface SetupReader {
  /** Every creator not archived, the oldest first. */
  creators(): Promise<{ creatorId: CreatorId; facts: CreatorSetupFacts }[]>;
  /** Every member who has not left, by display name. */
  members(): Promise<{ memberId: TeamMemberId; teamRole: TeamRole; facts: MemberSetupFacts }[]>;
}

const count = z.coerce.number().int().nonnegative();
const day = z.union([z.string(), z.date()]).transform((value) => new Date(value).toISOString().slice(0, 10));

const CreatorRow = z.object({ id: CreatorIdSchema, own_hours: z.boolean() });
const AccountRow = z.object({
  creator_id: CreatorIdSchema,
  platform: z.string(),
  with_rules: z.boolean(),
  linked: z.boolean(),
  made_on: day,
});
const IdRow = z.object({ creator_id: CreatorIdSchema });
const InvitationSchema = z.enum(['none', 'pending', 'expired', 'used']) satisfies z.ZodType<Invitation>;
const AccessRow = z.object({ creator_id: CreatorIdSchema.nullable(), invitation: InvitationSchema });
const SwitchRow = z.object({ scope: z.string(), scope_id: z.string().nullable(), active: z.boolean() });
const AutoRow = z.object({ creator_id: CreatorIdSchema, auto: count });
const CheckRow = z.object({ platform: z.string(), clean: z.boolean(), to_day: day });
const MemberRow = z.object({
  id: TeamMemberIdSchema,
  team_role: TeamRoleSchema,
  invitation: InvitationSchema,
  second_factor: z.boolean(),
  extension: z.boolean(),
  linked: z.boolean(),
  creators: count,
  shift: z.boolean(),
  paid: z.boolean(),
});
const TodayRow = z.object({ today: day });

/**
 * An account's invitation, in SQL over `u` (the user): a password chosen, else a live link, else a link that died
 * unused (expired or replaced), else none. `target` is the column of `invitation_links` that names the account.
 */
const invitationOf = (
  target: 'member_id' | 'user_id',
  id: ReturnType<typeof sql>,
): ReturnType<typeof sql> => sql`
  case
    when exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') then 'used'
    when exists (select 1 from invitation_links l where l.${sql.raw(target)} = ${id}
                 and l.used_at is null and l.revoked_at is null and l.expires_at > now()) then 'pending'
    when exists (select 1 from invitation_links l where l.${sql.raw(target)} = ${id}) then 'expired'
    else 'none'
  end`;

/**
 * The facts of « Mise en route », read through the admin connection: her own account, the passwords, the passkeys and
 * the extension links are out of the application role's reach, and the routes are the owner's alone (like Réglages ›
 * Sécurité's accounts). A dashboard view (modules.md: read only, aggregates): nothing is written, no message, no fan.
 */
export function createSetupReader(
  adminDb: Database,
  telegramReach: TelegramReach,
  billing: BillingReadiness,
  agencyTimeZone: string,
): SetupReader {
  return {
    creators: async () => {
      const reach = await telegramReach();
      return withAdmin(adminDb, async (tx) => {
        const read = async <T extends z.ZodType>(
          schema: T,
          query: ReturnType<typeof sql>,
        ): Promise<z.infer<T>[]> => z.array(schema).parse((await tx.execute(query)).rows);
        const creators = await read(
          CreatorRow,
          sql`select id, agent_hours is not null as own_hours from creators where archived_at is null
              order by created_at, id`,
        );
        if (creators.length === 0) return [];
        const accounts = await read(
          AccountRow,
          sql`select pa.creator_id, pa.platform, pa.created_at::date as made_on,
                exists (select 1 from account_pay_rules r where r.platform_account_id = pa.id) as with_rules,
                exists (select 1 from sales_feed_models m where m.platform_account_id = pa.id) as linked
              from platform_accounts pa`,
        );
        const personas = await read(
          IdRow,
          sql`select distinct creator_id from persona_versions where is_active`,
        );
        const rates = await read(
          IdRow,
          sql`select distinct creator_id from creator_agency_rates
              where from_day <= (now() at time zone ${agencyTimeZone})::date`,
        );
        // Her own account opens her alone (`user_creator_link_check`); a password set means her link was used.
        const access = await read(
          AccessRow,
          sql`select u.creator_ids[1] as creator_id, ${invitationOf('user_id', sql`u.id`)} as invitation
              from "user" u where u.role = 'creator'`,
        );
        const shifts = await read(
          IdRow,
          sql`select distinct creator_id from shifts
              where cancelled_at is null and ends_at > now() - interval '14 days'`,
        );
        const switches = await read(
          SwitchRow,
          sql`select distinct on (scope, scope_id) scope, scope_id::text as scope_id, active from kill_switches
              order by scope, scope_id, set_at desc`,
        );
        const auto = await read(
          AutoRow,
          sql`select creator_id, count(*) as auto from conversations
              where mode = 'auto' and state not in ('human', 'paused') group by creator_id`,
        );
        const checks = await read(
          CheckRow,
          sql`select distinct on (platform) platform, clean, to_day from sales_feed_checks
              order by platform, generated_at desc`,
        );
        const has = (rows: readonly { creator_id: CreatorId }[]): Set<CreatorId> =>
          new Set(rows.map((row) => row.creator_id));
        const withPersona = has(personas);
        const withRate = has(rates);
        const withShifts = has(shifts);
        const global = switches.some((s) => s.scope === 'global' && s.active);
        return creators.map(({ id, own_hours }) => {
          const hers = accounts.filter((account) => account.creator_id === id);
          const account = access.find((row) => row.creator_id === id);
          const facts: CreatorSetupFacts = {
            accounts: hers.length,
            accountsWithPayRules: hers.filter((a) => a.with_rules).length,
            hasActivePersona: withPersona.has(id),
            hasAgencyRate: withRate.has(id),
            hasLinkedReveal: hers.some((a) => a.platform === 'reveal' && a.linked),
            access: account?.invitation ?? 'none',
            telegramReachable: reach === null ? null : (reach.get(id) ?? false),
            hasOwnHours: own_hours,
            hasShifts: withShifts.has(id),
            mode: modeOf({
              switches: {
                global,
                creator: switches.some((s) => s.scope === 'creator' && s.scope_id === id && s.active),
              },
              autoConversations: auto.find((row) => row.creator_id === id)?.auto ?? 0,
            }),
            check: checkOf(hers, checks),
          };
          return { creatorId: id, facts };
        });
      });
    },
    members: async () => {
      const { today, rows } = await withAdmin(adminDb, async (tx) => {
        const read = async <T extends z.ZodType>(
          schema: T,
          query: ReturnType<typeof sql>,
        ): Promise<z.infer<T>[]> => z.array(schema).parse((await tx.execute(query)).rows);
        const [{ today } = { today: '' }] = await read(
          TodayRow,
          sql`select (now() at time zone ${agencyTimeZone})::date as today`,
        );
        // An archived creator is off his list and her shifts no longer start him (recette Équipe 12/11).
        const rows = await read(
          MemberRow,
          sql`select m.id, m.team_role, ${invitationOf('member_id', sql`m.id`)} as invitation,
                (u.two_factor_enabled or exists (select 1 from passkey p where p.user_id = u.id)) as second_factor,
                exists (select 1 from extension_links l where l.user_id = u.id and l.revoked_at is null) as extension,
                exists (select 1 from sales_feed_chatters c where c.member_id = m.id) as linked,
                (select count(*) from creators c where c.id = any(u.creator_ids) and c.archived_at is null)
                  as creators,
                exists (select 1 from shifts s join creators c on c.id = s.creator_id
                        where s.member_id = m.id and s.cancelled_at is null and c.archived_at is null) as shift,
                -- A chatter's pay is always invoiced; a manager's once a rate or a share of the team's net is in force.
                (m.team_role = 'chatter' or coalesce((
                  select r.rate_bps > 0 or coalesce(r.team_share_bps, 0) > 0 from member_commission_rates r
                  where r.member_id = m.id and r.effective_from <= ${today}::date
                  order by r.effective_from desc limit 1), false)) as paid
              from team_members m join "user" u on u.id = m.user_id
              where m.status <> 'left'
              order by m.display_name, m.id`,
        );
        return { today, rows };
      });
      // Out of the transaction above: invoicing reads in its own.
      const blocked = await billing(
        rows.filter((row) => row.paid).map((row) => row.id),
        today,
      );
      return rows.map((row) => ({
        memberId: row.id,
        teamRole: row.team_role,
        facts: {
          teamRole: row.team_role,
          invitation: row.invitation,
          secondFactor: row.second_factor,
          extensionLinked: row.extension,
          platformAccountLinked: row.linked,
          creators: row.creators,
          hasShift: row.shift,
          paid: row.paid,
          billing: blocked.get(row.id) ?? null,
        },
      }));
    },
  };
}

/**
 * Each platform of hers has a latest check: clean and run on days after her account there was made (it saw her
 * sales), or not. One that is not clean says so; a platform with no check that covers her leaves it to do.
 */
function checkOf(
  accounts: readonly z.infer<typeof AccountRow>[],
  checks: readonly z.infer<typeof CheckRow>[],
): CreatorSetupFacts['check'] {
  if (accounts.length === 0) return 'none';
  let clean = true;
  for (const account of accounts) {
    const latest = checks.find((check) => check.platform === account.platform);
    if (latest === undefined) return 'none';
    if (!latest.clean) return 'not_clean';
    if (latest.to_day < account.made_on) clean = false;
  }
  return clean ? 'clean' : 'none';
}
