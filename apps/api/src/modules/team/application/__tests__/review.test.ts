import {
  CreatorIdSchema,
  FanIdSchema,
  FaultCodeSchema,
  MessageIdSchema,
  newId,
  RuleRefSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type FaultLevel,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ShiftRemark } from '../../domain/ports';
import { createReviewService, type ReviewStore, type StoredContest } from '../review';

/** Invented faults, rules and words only (ADR 0010). */
const creatorId = newId(CreatorIdSchema);
const shiftId = newId(ShiftIdSchema);
const me = newId(TeamMemberIdSchema);
const colleague = newId(TeamMemberIdSchema);
const userId = newId(UserIdSchema);
const NOW = new Date('2026-11-27T10:00:00Z');
const code = (name: string) => FaultCodeSchema.parse(`fault.${name}`);

const remark = (patch: Partial<ShiftRemark>): ShiftRemark => ({
  id: crypto.randomUUID(),
  kind: 'fault',
  creatorId,
  shiftId,
  chatterId: me,
  fanId: newId(FanIdSchema),
  faultCode: code('one'),
  messageIds: [newId(MessageIdSchema)],
  occurredAt: new Date('2026-11-26T21:00:00Z'),
  fanFeeling: 'Il s’est senti pressé.',
  missedMinor: 2500,
  missedSource: 'script_step',
  earnedMinor: null,
  currency: 'EUR',
  alternative: ['Alors, elle te plaît ?', 'J’en ai une autre…'],
  ruleRef: RuleRefSchema.parse('rule.example_one'),
  author: 'member',
  ...patch,
});

function harness(input: {
  remarks: ShiftRemark[];
  history?: ShiftRemark[];
  levels?: Record<string, FaultLevel>;
  explained?: Record<string, Date>;
  contests?: Record<string, StoredContest>;
  ruling?: 'ruled' | 'forbidden' | 'not_found';
}) {
  const recorded: { faultCode: string; remarkId: string }[] = [];
  const contested: string[] = [];
  const store: ReviewStore = {
    memberOf: () => Promise.resolve(me),
    shiftMember: () => Promise.resolve(me),
    levels: (_c, _u, codes) =>
      Promise.resolve(
        new Map(
          codes.flatMap((c) => {
            const level = input.levels?.[c];
            return level === undefined ? [] : [[c, { level, label: `Libellé ${c}` }] as const];
          }),
        ),
      ),
    explanations: () => Promise.resolve(new Map(Object.entries(input.explained ?? {}))),
    contests: () => Promise.resolve(new Map(Object.entries(input.contests ?? {}))),
    recordExplanations: (_c, _u, _m, rows) => {
      recorded.push(...rows);
      return Promise.resolve();
    },
    contest: (_c, _u, _m, remarkId) => {
      contested.push(remarkId);
      return Promise.resolve();
    },
    rule: () => Promise.resolve(input.ruling ?? 'ruled'),
  };
  const service = createReviewService({
    store,
    remarks: {
      remarksFor: () => Promise.resolve(input.remarks),
      remarksOfChatter: () => Promise.resolve(input.history ?? input.remarks),
      remark: ({ remarkId }) => Promise.resolve(input.remarks.find((r) => r.id === remarkId) ?? null),
    },
    excerpts: (_c, ids) =>
      Promise.resolve(
        ids.map((messageId) => ({
          messageId,
          from: 'chatter' as const,
          text: 'Un message',
          at: NOW.toISOString(),
        })),
      ),
    now: () => NOW,
  });
  return { service, recorded, contested };
}

describe('« Mon bilan »', () => {
  it('shows his remarks only, the gravest first, at most three, with the missed total', async () => {
    const remarks = [
      remark({ faultCode: code('std'), missedMinor: 4000 }),
      remark({ faultCode: code('grave'), missedMinor: null, missedSource: null }),
      remark({ faultCode: code('std'), missedMinor: 1000 }),
      remark({ faultCode: code('advice'), missedMinor: 500 }),
      remark({ chatterId: colleague, faultCode: code('grave') }),
      remark({
        kind: 'well_done',
        faultCode: null,
        missedMinor: null,
        missedSource: null,
        earnedMinor: 4000,
        alternative: [],
      }),
    ];
    const { service } = harness({
      remarks,
      levels: { 'fault.std': 'standard', 'fault.grave': 'firm', 'fault.advice': 'advice' },
    });
    const review = await service.myShiftReview(userId, creatorId, shiftId);
    expect(review.faults.map((f) => [f.faultCode, f.tone, f.missed?.minor ?? null])).toEqual([
      ['fault.grave', 'grave', null],
      ['fault.std', 'explain', 4000],
      ['fault.std', 'explain', 1000],
    ]);
    expect(review.wellDone.map((w) => w.earned)).toEqual([{ minor: 4000, currency: 'EUR' }]);
    expect(review.missedTotals).toEqual([{ currency: 'EUR', minor: 5500 }]);
    expect(review.faults[0]?.excerpt).toHaveLength(1);
  });

  it('treats a code the owner has not saved as advice, never counted', async () => {
    const { service } = harness({ remarks: [remark({ faultCode: code('unknown') })] });
    const [card] = (await service.myShiftReview(userId, creatorId, shiftId)).faults;
    expect(card?.tone).toBe('advice');
    expect(card?.label).toBeNull();
    expect(card?.counted).toBe(0);
  });

  it('recalls firmly once explained, and counts only what came after, contests and deduced authors aside', async () => {
    const explainedAt = new Date('2026-11-20T00:00:00Z');
    const now = remark({ faultCode: code('std') });
    const history = [
      now,
      remark({ faultCode: code('std'), occurredAt: new Date('2026-11-22T20:00:00Z') }),
      remark({ faultCode: code('std'), occurredAt: new Date('2026-11-19T20:00:00Z') }),
      remark({ faultCode: code('std'), occurredAt: new Date('2026-11-23T20:00:00Z'), author: 'deduced' }),
    ];
    const pending = remark({ faultCode: code('std'), occurredAt: new Date('2026-11-24T20:00:00Z') });
    const { service } = harness({
      remarks: [now],
      history: [...history, pending],
      levels: { 'fault.std': 'standard' },
      explained: { 'fault.std': explainedAt },
      contests: { [pending.id]: { reason: 'Il avait dit non', ruling: null } },
    });
    const [card] = (await service.myShiftReview(userId, creatorId, shiftId)).faults;
    expect(card?.tone).toBe('firm');
    expect(card?.counted).toBe(2);
  });

  it('records what he was shown, faults only', async () => {
    const fault = remark({});
    const { service, recorded } = harness({
      remarks: [fault, remark({ kind: 'well_done', faultCode: null }), remark({ chatterId: colleague })],
    });
    await service.markSeen(userId, creatorId, shiftId);
    expect(recorded).toEqual([{ faultCode: 'fault.one', remarkId: fault.id }]);
  });

  it('lets him contest his own remark only', async () => {
    const mine = remark({});
    const theirs = remark({ chatterId: colleague });
    const { service, contested } = harness({ remarks: [mine, theirs] });
    const actor = { userId, ip: '127.0.0.1' };
    await service.contest(actor, mine.id, { creatorId, reason: 'Il avait dit non' });
    await expect(service.contest(actor, theirs.id, { creatorId, reason: 'Non' })).rejects.toMatchObject({
      code: 'review_remark_not_found',
    });
    expect(contested).toEqual([mine.id]);
  });

  it('refuses a ruling the store refuses', async () => {
    const actor = { userId, ip: '127.0.0.1' };
    await expect(
      harness({ remarks: [], ruling: 'forbidden' }).service.rule(actor, crypto.randomUUID(), {
        creatorId,
        ruling: 'dropped',
      }),
    ).rejects.toMatchObject({ code: 'review_ruling_forbidden' });
    await expect(
      harness({ remarks: [], ruling: 'not_found' }).service.rule(actor, crypto.randomUUID(), {
        creatorId,
        ruling: 'upheld',
      }),
    ).rejects.toMatchObject({ code: 'review_remark_not_found' });
  });
});
