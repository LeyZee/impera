import {
  AGENCY_PERIOD_DAYS,
  ConversationIdSchema,
  DomainError,
  FAN_FOLD_FROM,
  FAN_FOLD_TO,
  FanFlagsSchema,
  FanIdSchema,
  foldPseudonym,
  type CreatorId,
  type FanHolder,
  type FanListItem,
  type FanListPage,
  type FanListQuery,
  type FanListState,
  type UserId,
} from '@impera/contracts';
import { sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

/**
 * Every fan of one creator, for the agency (ADR 0124): read inside her tenant with the team's scope, the figures
 * summed from the platform's register (`platform_sales`, ADR 0078: sales less their refunds) and his latest
 * conversation. A scope of one's own reads nothing (0124 § 4, 0043 § 7). Read only: nothing is written, here or in
 * the platform (§ 6).
 */
export interface FanListReader {
  /** `null`: the reader's scope is his own, the list is not his to read. */
  read(creatorId: CreatorId, userId: UserId, query: FanListQuery, now: Date): Promise<FanListPage | null>;
}

/** Euros for one dollar in millionths, as pay keeps it (`rate_micros`); `null`: no rate known yet. */
export type UsdRateMicrosOf = (userId: UserId) => Promise<number | null>;

/** A piece of SQL, as `sql` builds it. */
type SQL = ReturnType<typeof sql>;

const DAY_MS = 86_400_000;

class CursorInvalid extends DomainError {
  constructor() {
    super('cursor_invalid', 'Curseur de pagination invalide');
  }
}

/** The cursor: the last row's sort key (an integer, as text: it may pass 2^53) and its id, in base64url. */
const CursorSchema = z.tuple([z.string().regex(/^-?\d{1,20}$/), z.uuid()]);

function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id])).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { key: string; id: string } | null {
  if (cursor === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new CursorInvalid();
  }
  const parsed = CursorSchema.safeParse(json);
  if (!parsed.success) throw new CursorInvalid();
  return { key: parsed.data[0], id: parsed.data[1] };
}

const minor = z.coerce.number().int();
const instant = z.coerce.date().nullable();

const RowSchema = z.object({
  id: FanIdSchema,
  display_name: z.string(),
  first_seen_at: z.coerce.date(),
  flags: z.unknown(),
  eur_ever: minor,
  usd_ever: minor,
  eur_period: minor,
  usd_period: minor,
  last_paid_at: instant,
  conversation_id: ConversationIdSchema.nullable(),
  last_inbound_at: instant,
  /** His last message's own time on the platform, never the time it was read in (PRO1-05). */
  last_message_at: instant,
  last_outbound_at: instant,
  mode: z.string().nullable(),
  state: z.string().nullable(),
  care_since: instant,
  holder_name: z.string().nullable(),
  sort_key: z.coerce.string(),
});
type Row = z.infer<typeof RowSchema>;

const TotalSchema = z.array(z.object({ total: z.coerce.number().int().nonnegative() }));

/** Upper and lower case accented letters to their plain lower letter (Postgres's `lower` may leave « É » as it is). */
const FOLD_FROM = FAN_FOLD_FROM + FAN_FOLD_FROM.toUpperCase();
const FOLD_TO = FAN_FOLD_TO + FAN_FOLD_TO;

function holderOf(row: Row): FanHolder {
  if (row.conversation_id === null) return 'none';
  if (row.state === 'human') return 'human';
  return row.mode === 'auto' ? 'agent' : 'copilot';
}

/** His states with Suivi's words on the screen; a flag the contract does not read is left out, never guessed. */
function statesOf(row: Row): FanListState[] {
  const parsed = FanFlagsSchema.safeParse(row.flags);
  const flags = parsed.success ? parsed.data : {};
  return [
    ...(flags.ageDisputed === undefined ? [] : ['age_disputed' as const]),
    ...(flags.doNotContact === true ? ['do_not_contact' as const] : []),
    ...(row.care_since === null ? [] : ['care' as const]),
    ...(flags.salesFrozen === undefined ? [] : ['sales_frozen' as const]),
  ];
}

function itemOf(row: Row): FanListItem {
  const unanswered =
    row.last_inbound_at !== null &&
    (row.last_outbound_at === null || row.last_outbound_at < row.last_inbound_at);
  const holder = holderOf(row);
  return {
    fanId: row.id,
    displayName: row.display_name,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    lastPaidAt: row.last_paid_at?.toISOString() ?? null,
    paidPeriod: { eurMinor: row.eur_period, usdMinor: row.usd_period },
    paidEver: { eurMinor: row.eur_ever, usdMinor: row.usd_ever },
    holder,
    holderName: holder === 'human' ? row.holder_name : null,
    conversationId: row.conversation_id,
    unanswered,
    states: statesOf(row),
  };
}

export function createFanListReader(db: Database, usdRateMicrosOf: UsdRateMicrosOf): FanListReader {
  return {
    read: async (creatorId, userId, query, now) => {
      const rate = await usdRateMicrosOf(userId);
      return withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope === 'self') return null;
        const periodStart = new Date(now.getTime() - AGENCY_PERIOD_DAYS[query.period] * DAY_MS);
        const lapsedBefore = new Date(now.getTime() - query.lapsedDays * DAY_MS);
        const sort = query.filter === 'big_payers' ? 'paid' : query.sort;
        // Dollars brought to euro cents at pay's rate, rounded half away from zero; left out without a rate.
        const usdInEur = (column: SQL): SQL =>
          rate === null
            ? sql`0`
            : sql`(case when ${column} >= 0 then (${column} * ${rate} + 500000) / 1000000
                       else -((-${column} * ${rate} + 500000) / 1000000) end)`;
        const key: SQL =
          sort === 'paid'
            ? sql`(r.eur_${sql.raw(query.filter === 'big_payers' ? 'period' : 'ever')}::bigint
                  + ${usdInEur(sql.raw(`r.usd_${query.filter === 'big_payers' ? 'period' : 'ever'}::bigint`))})`
            : sql`coalesce((extract(epoch from ${sql.raw(sort === 'last_message' ? 'r.last_message_at' : 'r.last_paid_at')}) * 1000000)::bigint, -1)`;
        const filter: SQL = {
          all: sql`true`,
          big_payers: sql`(r.eur_period > 0 or r.usd_period > 0)`,
          lapsed: sql`(r.eur_ever > 0 or r.usd_ever > 0) and r.last_paid_at < ${lapsedBefore.toISOString()}::timestamptz`,
          payers: sql`(r.eur_ever > 0 or r.usd_ever > 0)`,
          never_paid: sql`r.last_paid_at is null`,
          unanswered: sql`r.last_inbound_at is not null
                          and (r.last_outbound_at is null or r.last_outbound_at < r.last_inbound_at)`,
        }[query.filter];
        const wanted = query.q === undefined ? '' : foldPseudonym(query.q);
        const search: SQL =
          wanted === ''
            ? sql`true`
            : sql`strpos(translate(lower(r.display_name), ${FOLD_FROM}, ${FOLD_TO}), ${wanted}) > 0`;
        // His sales less their refunds (at most one per sale: the register is unique by sale and event), by currency.
        const rows: SQL = sql`
          with net as (
            select s.platform_account_id as account, s.platform_fan_id as fan, s.currency, s.occurred_at,
                   s.gross_incl_vat_minor - coalesce(r.gross_incl_vat_minor, 0) as gross
              from platform_sales s
              left join platform_sales r
                on r.creator_id = ${creatorId}::uuid and r.event = 'refund'
               and r.platform = s.platform and r.platform_sale_id = s.platform_sale_id
             where s.creator_id = ${creatorId}::uuid and s.event = 'sale' and s.platform_fan_id is not null),
          paid as (
            select account, fan,
                   coalesce(sum(gross) filter (where currency = 'EUR'), 0) as eur_ever,
                   coalesce(sum(gross) filter (where currency = 'USD'), 0) as usd_ever,
                   coalesce(sum(gross) filter (where currency = 'EUR' and occurred_at >= ${periodStart.toISOString()}::timestamptz), 0) as eur_period,
                   coalesce(sum(gross) filter (where currency = 'USD' and occurred_at >= ${periodStart.toISOString()}::timestamptz), 0) as usd_period,
                   max(occurred_at) filter (where gross > 0) as last_paid_at
              from net group by account, fan),
          r as (
            select f.id, f.display_name, f.first_seen_at, f.flags,
                   coalesce(p.eur_ever, 0) as eur_ever, coalesce(p.usd_ever, 0) as usd_ever,
                   coalesce(p.eur_period, 0) as eur_period, coalesce(p.usd_period, 0) as usd_period,
                   p.last_paid_at, c.id as conversation_id, c.last_inbound_at, c.last_outbound_at, c.mode, c.state,
                   c.care_since, u.name as holder_name,
                   -- His last message at the platform's own time: a catch-up of the connector reads late, never anew.
                   coalesce(c.last_inbound_message_at, c.last_inbound_at) as last_message_at
              from fans f
              left join paid p on p.account = f.platform_account_id and p.fan = f.platform_fan_id
              left join lateral (
                select c.id, c.last_inbound_at, c.last_outbound_at, c.mode, c.state, c.care_since, c.routed_to_user_id,
                       (select max(m.platform_created_at) from messages m
                         where m.conversation_id = c.id and m.direction = 'inbound') as last_inbound_message_at
                  from conversations c where c.fan_id = f.id
                 order by c.updated_at desc, c.id desc limit 1) c on true
              left join "user" u on u.id = c.routed_to_user_id
             where f.creator_id = ${creatorId}::uuid)`;
        const after = decodeCursor(query.cursor);
        const page = RowSchema.array().parse(
          (
            await tx.execute(sql`${rows}
              select r.*, (${key})::text as sort_key from r
               where ${filter} and ${search}
                 ${after === null ? sql`` : sql`and ((${key}), r.id) < (${after.key}::bigint, ${after.id}::uuid)`}
               order by ${key} desc, r.id desc
               limit ${query.limit + 1}`)
          ).rows,
        );
        const [count] = TotalSchema.parse(
          (await tx.execute(sql`${rows} select count(*) as total from r where ${filter} and ${search}`)).rows,
        );
        const items = page.slice(0, query.limit);
        const last = items.at(-1);
        return {
          items: items.map(itemOf),
          nextCursor:
            page.length > query.limit && last !== undefined ? encodeCursor(last.sort_key, last.id) : null,
          total: count?.total ?? 0,
          sharedFansKnown: false,
        };
      });
    },
  };
}
