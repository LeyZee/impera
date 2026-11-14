import { CreatorIdSchema, McpGrantIdSchema, newId, UserIdSchema, type CreatorId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import type { GrantRecord } from '../../domain/ports';
import { creatorTools } from '../read-tools';

const nora = newId(CreatorIdSchema);
const lea = newId(CreatorIdSchema);
const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: null,
  label: 'Agent inventé',
  capabilities: ['read:status'],
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

/** A directory that records what it was asked, and answers Nora and Léa among them. */
function reader() {
  const asked: (readonly CreatorId[] | 'all')[] = [];
  return {
    asked,
    unarchived(ids: readonly CreatorId[] | 'all') {
      asked.push(ids);
      const all = [
        { id: lea, displayName: 'Léa', timezone: 'America/Montreal', hasAvatar: true },
        { id: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
      ];
      return Promise.resolve(ids === 'all' ? all : all.filter((entry) => ids.includes(entry.id)));
    },
  };
}

describe('the creator tools (ADR 0026 § 5)', () => {
  it('list the access’s creator, else those the person reads, else all for the owner; nothing more', async () => {
    const directory = reader();
    const tools = creatorTools(directory);
    const list = tools['creators_list'];
    if (list === undefined) throw new Error('no creators_list');
    expect(await list.run({ grant, actor: manager, creatorId: nora }, {})).toEqual({
      creators: [{ id: nora, displayName: 'Nora', timezone: 'Europe/Paris' }],
    });
    await list.run({ grant, actor: manager, creatorId: null }, {});
    await list.run(
      { grant, actor: { ...manager, role: 'owner', readableCreatorIds: 'all' }, creatorId: null },
      {},
    );
    expect(directory.asked).toEqual([[nora], [lea], 'all']);
  });

  it('get the access’s creator only, without her photo, and null once archived', async () => {
    const directory = reader();
    const get = creatorTools(directory)['creator_get'];
    if (get === undefined) throw new Error('no creator_get');
    expect(await get.run({ grant, actor: manager, creatorId: lea }, {})).toEqual({
      creator: { id: lea, displayName: 'Léa', timezone: 'America/Montreal' },
    });
    expect(await get.run({ grant, actor: manager, creatorId: newId(CreatorIdSchema) }, {})).toEqual({
      creator: null,
    });
  });
});
