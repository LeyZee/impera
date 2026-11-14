import {
  AiUsageSchema,
  CreatorIdSchema,
  McpAiUsageSchema,
  McpGrantIdSchema,
  newId,
  UserIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import type { GrantRecord } from '../../domain/ports';
import { statusTools } from '../status-tools';

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
const owner: ActorView = {
  role: 'owner',
  teamScope: 'owner',
  secondFactorEnabled: true,
  readableCreatorIds: 'all',
};

const usage = AiUsageSchema.parse({
  readAt: '2026-11-14T10:00:00.000Z',
  timeZone: 'Europe/Paris',
  usdPerEur: 1.08,
  today: { day: '2026-11-14', eur: 3.2, capEur: 20, alertAtEur: 16, state: 'ok', calls: 120, failed: 2 },
  hours: [],
  days: [{ day: '2026-11-14', eur: 3.2, calls: 120, providers: [{ provider: 'xai', eur: 3.2 }] }],
  models: [],
  uses: [],
  pace: { perDayEur: 4.1, perDayOver: 7, monthEur: 52.3, monthForecastEur: 118, month: '2026-11' },
  lastCallAt: '2026-11-14T09:58:00.000Z',
  credits: [],
});

describe('ai_usage_get (ADR 0091, ADR 0105 § 4)', () => {
  it('gives the spend as the screen shows it, never a balance nor a key', async () => {
    const tool = statusTools({ read: () => Promise.resolve(usage) })['ai_usage_get'];
    if (tool === undefined) throw new Error('no ai_usage_get');
    const value = McpAiUsageSchema.parse(await tool.run({ grant, actor: owner, creatorId: null }, {}));
    expect(value).toEqual({
      readAt: '2026-11-14T10:00:00.000Z',
      today: { day: '2026-11-14', eur: 3.2, capEur: 20, alertAtEur: 16, state: 'ok', calls: 120, failed: 2 },
      days: [{ day: '2026-11-14', eur: 3.2, calls: 120 }],
      pace: { perDayEur: 4.1, perDayOver: 7, monthEur: 52.3, monthForecastEur: 118, month: '2026-11' },
      lastCallAt: '2026-11-14T09:58:00.000Z',
    });
    expect(Object.keys(value).sort()).toEqual(['days', 'lastCallAt', 'pace', 'readAt', 'today']);
    expect(JSON.stringify(value)).not.toMatch(/xai|providers|usdPerEur|timeZone/u);
    expect(CreatorIdSchema.safeParse(value.readAt).success).toBe(false);
  });
});
