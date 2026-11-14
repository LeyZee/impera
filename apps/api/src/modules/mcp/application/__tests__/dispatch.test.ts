import { CreatorIdSchema, McpGrantIdSchema, newId, UserIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ActorView } from '../../domain/access';
import type { GrantRecord, McpCallRecord } from '../../domain/ports';
import { createDispatcher, whoami, type ServedTool } from '../dispatch';

const nora = newId(CreatorIdSchema);
const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: nora,
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

/** A tool of the catalogue that needs `read:status` and names its creator, served by a stub. */
const creatorGet: ServedTool = {
  description: 'stub',
  input: z.strictObject({ creatorId: z.string().optional() }),
  output: z.object({ creatorId: z.string().nullable() }),
  run: (context) => Promise.resolve({ creatorId: context.creatorId }),
};

/** The owner's alone (`ownerOnly` in the catalogue), served by a stub. */
const aiUsageGet: ServedTool = {
  description: 'stub',
  input: z.strictObject({}),
  output: z.object({}),
  run: () => Promise.resolve({}),
};

const setup = (over: { spend?: boolean; journalFails?: boolean } = {}) => {
  const lines: McpCallRecord[] = [];
  const dispatcher = createDispatcher({
    journal: {
      record: (entry) => {
        if (over.journalFails === true) return Promise.reject(new Error('journal down'));
        lines.push(entry);
        return Promise.resolve();
      },
    },
    spendRead: () => Promise.resolve(over.spend ?? true),
    tools: { whoami, creator_get: creatorGet, ai_usage_get: aiUsageGet },
  });
  const call = (name: string, args: unknown = {}, actor: ActorView = owner) =>
    dispatcher.call({ grant, actor, name, args, requestId: 'req-1', ip: '203.0.113.1' });
  return { dispatcher, lines, call };
};

describe('the dispatcher of the MCP server (ADR 0026 § 4 and § 8)', () => {
  it('calls a served tool confined to the access’s creator, and writes it down', async () => {
    const { call, lines } = setup();
    expect(await call('creator_get')).toEqual({ ok: true, value: { creatorId: nora } });
    expect(lines).toEqual([
      {
        userId: grant.userId,
        grantId: grant.id,
        tool: 'creator_get',
        outcome: 'ok',
        creatorId: nora,
        subject: {},
        requestId: 'req-1',
        ip: '203.0.113.1',
      },
    ]);
  });

  it('refuses, and writes down, a name not served, arguments it does not take, and what the rule refuses', async () => {
    const { call, lines } = setup();
    expect(await call('agent_status')).toEqual({ ok: false, refusal: 'tool_unknown' });
    expect(await call('draft_approve')).toEqual({ ok: false, refusal: 'tool_unknown' });
    expect(await call('creator_get', { creatorId: 1 })).toEqual({ ok: false, refusal: 'arguments_invalid' });
    expect(await call('creator_get', { creatorId: newId(CreatorIdSchema) })).toEqual({
      ok: false,
      refusal: 'creator_forbidden',
    });
    expect(await call('whoami', {}, { ...owner, secondFactorEnabled: false })).toEqual({
      ok: false,
      refusal: 'second_factor_required',
    });
    expect(lines.map((line) => [line.tool, line.outcome])).toEqual([
      [null, 'tool_unknown'],
      [null, 'tool_unknown'],
      ['creator_get', 'arguments_invalid'],
      ['creator_get', 'creator_forbidden'],
      ['whoami', 'second_factor_required'],
    ]);
  });

  it('writes down the identifiers a call touches, from its validated input, once the rule has let it through', async () => {
    const lines: McpCallRecord[] = [];
    const dispatcher = createDispatcher({
      journal: { record: (entry) => Promise.resolve(void lines.push(entry)) },
      spendRead: () => Promise.resolve(true),
      tools: { creator_get: { ...creatorGet, subject: () => ({ fanId: 'fan-1' }) } },
    });
    const call = (args: unknown) =>
      dispatcher.call({
        grant,
        actor: owner,
        name: 'creator_get',
        args,
        requestId: 'req-1',
        ip: '203.0.113.1',
      });
    await call({});
    await call({ creatorId: newId(CreatorIdSchema) });
    expect(lines.map((line) => [line.outcome, line.subject])).toEqual([
      ['ok', { fanId: 'fan-1' }],
      ['creator_forbidden', {}],
    ]);
  });

  it('refuses a read past the access’s minute', async () => {
    const { call, lines } = setup({ spend: false });
    expect(await call('whoami')).toEqual({ ok: false, refusal: 'rate_limited' });
    expect(lines.at(-1)?.outcome).toBe('rate_limited');
  });

  it('gives nothing when the call cannot be written down', async () => {
    const { call } = setup({ journalFails: true });
    await expect(call('whoami')).rejects.toThrow('journal down');
  });

  it('lists the served tools whose capability the access holds', () => {
    const { dispatcher } = setup();
    expect(dispatcher.list(grant, owner).map((tool) => tool.name)).toEqual(['whoami', 'creator_get']);
    expect(
      dispatcher.list({ ...grant, capabilities: ['read:team'] }, owner).map((tool) => tool.name),
    ).toEqual(['whoami']);
  });

  it('lists an owner-only tool to the owner on an access of the agency, and to no one else', () => {
    const { dispatcher } = setup();
    const agency = { ...grant, creatorId: null };
    const manager: ActorView = {
      ...owner,
      role: 'operator',
      teamScope: 'agency',
      readableCreatorIds: [nora],
    };
    expect(dispatcher.list(agency, owner).map((tool) => tool.name)).toEqual([
      'whoami',
      'creator_get',
      'ai_usage_get',
    ]);
    expect(dispatcher.list(agency, manager).map((tool) => tool.name)).toEqual(['whoami', 'creator_get']);
    expect(dispatcher.list(grant, owner).map((tool) => tool.name)).toEqual(['whoami', 'creator_get']);
  });

  it('refuses an owner-only tool to a manager on an access of the agency', async () => {
    const { dispatcher, lines } = setup();
    const manager: ActorView = {
      ...owner,
      role: 'operator',
      teamScope: 'agency',
      readableCreatorIds: [nora],
    };
    expect(
      await dispatcher.call({
        grant: { ...grant, creatorId: null },
        actor: manager,
        name: 'ai_usage_get',
        args: {},
        requestId: 'req-1',
        ip: '203.0.113.1',
      }),
    ).toEqual({ ok: false, refusal: 'owner_only' });
    expect(lines.at(-1)?.outcome).toBe('owner_only');
  });
});
