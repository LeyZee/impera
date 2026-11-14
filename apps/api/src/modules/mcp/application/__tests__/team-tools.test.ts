import {
  CreatorIdSchema,
  McpGrantIdSchema,
  McpOnShiftNowSchema,
  newId,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import type { ContentReaderView, GrantRecord, ShiftReader } from '../../domain/ports';
import { teamTools } from '../team-tools';

const nora = newId(CreatorIdSchema);
const lea = newId(CreatorIdSchema);
const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: null,
  label: 'Agent inventé',
  capabilities: ['read:team'],
  createdAt: new Date('2026-11-14T10:00:00.000Z'),
  expiresAt: new Date('2026-12-14T10:00:00.000Z'),
  lastUsedAt: null,
  revokedAt: null,
};
const manager: ActorView = {
  role: 'operator',
  teamScope: 'agency',
  secondFactorEnabled: true,
  readableCreatorIds: [lea],
};
const now = new Date('2026-11-14T21:00:00.000Z');
const shift = newId(ShiftIdSchema);
const member = newId(TeamMemberIdSchema);

function shifts(): ShiftReader & { asked: [ContentReaderView, 'all' | readonly string[], Date][] } {
  const asked: [ContentReaderView, 'all' | readonly string[], Date][] = [];
  return {
    asked,
    onShiftNow(reader, creators, at) {
      asked.push([reader, creators, at]);
      return Promise.resolve([
        {
          shiftId: shift,
          creatorId: lea,
          memberId: member,
          memberName: 'Lou',
          endsAt: '2026-11-14T23:00:00.000Z',
          ...{ platformAccountId: 'compte-plateforme', rateBasisPoints: 2000 },
        },
      ]);
    },
  };
}

describe('on_shift_now (ADR 0026 § 5, read:team)', () => {
  it('reads as the access’s person: its creator, else those the person reads now', async () => {
    const source = shifts();
    const tool = teamTools(source, () => now)['on_shift_now'];
    if (tool === undefined) throw new Error('no on_shift_now');
    await tool.run({ grant, actor: manager, creatorId: nora }, {});
    await tool.run({ grant, actor: manager, creatorId: null }, {});
    await tool.run(
      { grant, actor: { ...manager, role: 'owner', readableCreatorIds: 'all' }, creatorId: null },
      {},
    );
    expect(source.asked).toEqual([
      [{ userId: grant.userId, role: 'operator' }, [nora], now],
      [{ userId: grant.userId, role: 'operator' }, [lea], now],
      [{ userId: grant.userId, role: 'owner' }, 'all', now],
    ]);
  });

  it('gives the shift, its member by name and its end; never an account nor a rate', async () => {
    const tool = teamTools(shifts(), () => now)['on_shift_now'];
    if (tool === undefined) throw new Error('no on_shift_now');
    const value = McpOnShiftNowSchema.parse(await tool.run({ grant, actor: manager, creatorId: null }, {}));
    expect(value).toEqual({
      onShift: [
        {
          shiftId: shift,
          creatorId: lea,
          memberId: member,
          memberName: 'Lou',
          endsAt: '2026-11-14T23:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(value)).not.toMatch(/compte-plateforme|2000|rate/u);
  });
});
