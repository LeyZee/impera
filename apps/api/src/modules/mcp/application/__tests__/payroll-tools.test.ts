import {
  McpGrantIdSchema,
  McpPayPeriodInputSchema,
  McpPayPeriodStateSchema,
  newId,
  PayPeriodBlockSchema,
  PayPeriodSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import type { GrantRecord, PayrollReader, PeriodStateEntry } from '../../domain/ports';
import { payrollTools } from '../payroll-tools';

/** Every number the JSON of a value holds as a value: never digits inside an id, a date or a key. */
const numbersIn = (value: unknown): number[] =>
  (JSON.stringify(value).match(/(?<=[:,[])-?\d+(?:\.\d+)?(?=[,\]}])/gu) ?? []).map(Number);

/** Invented members and amounts only (ADR 0010). */
const P1 = PayPeriodSchema.parse('2026-11-01');
const [lou, sam] = [newId(TeamMemberIdSchema), newId(TeamMemberIdSchema)].toSorted();
const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: null,
  label: 'Agent inventé',
  capabilities: ['read:payroll'],
  createdAt: new Date('2026-11-14T10:00:00.000Z'),
  expiresAt: new Date('2026-12-14T10:00:00.000Z'),
  lastUsedAt: null,
  revokedAt: null,
};
const owner: ActorView = {
  role: 'owner',
  teamScope: 'owner',
  secondFactorEnabled: true,
  readableCreatorIds: 'all',
};
const chatter: ActorView = { ...owner, role: 'operator', teamScope: 'self', readableCreatorIds: [] };

const state = (memberId: string | undefined, over: Record<string, unknown> = {}) => ({
  memberId: TeamMemberIdSchema.parse(memberId),
  status: 'validated' as const,
  revision: 2,
  computedAt: '2026-11-16T08:00:00.000Z',
  validatedAt: '2026-11-17T08:00:00.000Z',
  paidAt: null,
  payoutBlocked: false,
  payoutLate: true,
  ...over,
});

const period: PeriodStateEntry = {
  window: {
    period: P1,
    startsAt: '2026-10-31T23:00:00.000Z',
    endsAt: '2026-11-15T23:00:00.000Z',
    timeZone: 'Europe/Paris',
  },
  closedAt: '2026-11-17T08:00:00.000Z',
  blocked: null,
  payoutDelayBusinessDays: 2,
  statements: [state(lou), state(sam, { payoutBlocked: true, payoutLate: false })],
  team: { statements: 2, totalMinor: 41_000, payableMinor: 38_000 },
};

/** Pay as the MCP reads it, and what it might add one day besides, which never leaves: amounts and a rate. */
function source(read: PeriodStateEntry): PayrollReader & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    periodState: (reader, at) => {
      asked.push([reader, at]);
      return Promise.resolve({
        ...read,
        ...{ netMinor: 205_000, rateBps: 2_000 },
        window: read.window === null ? null : { ...read.window, ...{ closedBy: 'invente' } },
        statements: read.statements.map((one) => ({
          ...one,
          ...{
            netMinor: 100_000,
            commissionMinor: 20_000,
            totalMinor: 21_000,
            payableMinor: 19_000,
            rateBps: 2_000,
          },
        })),
        blocked: read.blocked === null ? null : { ...read.blocked, ...{ rateBps: 2_000 } },
        team: read.team === null ? null : { ...read.team, ...{ netMinor: 205_000 } },
      });
    },
  };
}

const toolOf = (reader: PayrollReader) => {
  const tool = payrollTools(reader)['commission_statements_list'];
  if (tool === undefined) throw new Error('no commission_statements_list');
  return tool;
};

describe('commission_statements_list (ADR 0105 § 3 and § 4, read:payroll, decision A)', () => {
  it('reads the period as the access’s person and their role, and gives its state with the counts', async () => {
    const pay = source(period);
    const out = McpPayPeriodStateSchema.parse(
      await toolOf(pay).run({ grant, actor: owner, creatorId: null }, { period: P1 }),
    );
    expect(pay.asked).toEqual([[{ userId: grant.userId, role: 'owner' }, P1]]);
    expect(out).toMatchObject({
      period: P1,
      closedAt: '2026-11-17T08:00:00.000Z',
      blocked: null,
      payoutDelayBusinessDays: 2,
      counts: { draft: 0, validated: 2, paid: 0, payoutBlocked: 1, payoutLate: 1 },
      team: { statements: 2, totalMinor: 41_000, payableMinor: 38_000 },
    });
    expect(out.statements.map((one) => one.memberId)).toEqual([lou, sam]);
  });

  it('gives no amount of a member, nor a rate, nor anything pay adds besides', async () => {
    const out = await toolOf(source(period)).run({ grant, actor: owner, creatorId: null }, { period: P1 });
    const text = JSON.stringify(out);
    for (const closed of ['rateBps', 'netMinor', 'commissionMinor', 'closedBy', 'invente'])
      expect(text).not.toContain(closed);
    for (const amount of [100_000, 20_000, 21_000, 19_000, 205_000, 2_000])
      expect(numbersIn(out)).not.toContain(amount);
    expect(McpPayPeriodStateSchema.safeParse(out).success).toBe(true);
    // Two members whose pay differs read the same, but for their ids.
    const one = McpPayPeriodStateSchema.parse(out).statements;
    expect(one[0] === undefined ? null : { ...one[0], memberId: sam }).toEqual(
      one[1] === undefined ? null : { ...one[1], payoutBlocked: false, payoutLate: true },
    );
  });

  it('copies a block by its code, without what pay would add to it', async () => {
    const since = '2026-11-16T08:00:00.000Z';
    const rate = McpPayPeriodStateSchema.parse(
      await toolOf(
        source({
          ...period,
          blocked: {
            code: 'commission_rate_missing_conflict',
            memberIds: [TeamMemberIdSchema.parse(sam)],
            since,
          },
        }),
      ).run({ grant, actor: owner, creatorId: null }, { period: P1 }),
    );
    expect(rate.blocked).toEqual({ code: 'commission_rate_missing_conflict', memberIds: [sam], since });
    const currency = McpPayPeriodStateSchema.parse(
      await toolOf(
        source({ ...period, blocked: { code: 'exchange_rate_missing_conflict', currency: 'USD', since } }),
      ).run({ grant, actor: owner, creatorId: null }, { period: P1 }),
    );
    expect(currency.blocked).toEqual({ code: 'exchange_rate_missing_conflict', currency: 'USD', since });
    // The tool's schema refuses a field in excess in the block and in the window.
    const parsed = currency;
    expect(
      McpPayPeriodStateSchema.safeParse({ ...parsed, blocked: { ...parsed.blocked, rateBps: 2_000 } })
        .success,
    ).toBe(false);
    expect(
      McpPayPeriodStateSchema.safeParse({ ...parsed, window: { ...parsed.window, closedBy: 'invente' } })
        .success,
    ).toBe(false);
  });

  it('knows every block pay records, with the same fields', () => {
    const blocked = McpPayPeriodStateSchema.shape.blocked.unwrap();
    const shapes = (union: typeof PayPeriodBlockSchema | typeof blocked): string[] =>
      union.options.map((option) => Object.keys(option.shape).toSorted().join()).toSorted();
    expect(shapes(blocked)).toEqual(shapes(PayPeriodBlockSchema));
    expect(blocked.options.map((option) => option.shape.code.value).toSorted()).toEqual(
      PayPeriodBlockSchema.options.map((option) => option.shape.code.value).toSorted(),
    );
  });

  it('passes on the sums pay withholds, each apart', async () => {
    const out = McpPayPeriodStateSchema.parse(
      await toolOf(
        source({ ...period, team: { statements: 2, totalMinor: 26_300, payableMinor: null } }),
      ).run({ grant, actor: owner, creatorId: null }, { period: P1 }),
    );
    expect(out.team).toEqual({ statements: 2, totalMinor: 26_300, payableMinor: null });
  });

  it('says the delay is unknown without one announced, and passes on what pay withholds', async () => {
    const out = await toolOf(
      source({
        ...period,
        payoutDelayBusinessDays: null,
        statements: [state(lou, { payoutLate: null })],
        team: null,
      }),
    ).run({ grant, actor: chatter, creatorId: null }, { period: P1 });
    expect(out).toMatchObject({ counts: { payoutLate: null }, team: null });
  });

  it('takes a period by its first day only', () => {
    expect(McpPayPeriodInputSchema.safeParse({ period: '2026-11-16' }).success).toBe(true);
    expect(McpPayPeriodInputSchema.safeParse({ period: '2026-11-15' }).success).toBe(false);
    expect(McpPayPeriodInputSchema.safeParse({ period: P1, memberId: lou }).success).toBe(false);
  });
});
