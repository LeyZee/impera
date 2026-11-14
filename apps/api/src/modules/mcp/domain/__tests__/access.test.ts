import type { McpCapability } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { decideCall, grantProblems, type ActorView, type GrantView } from '../access';
import { toolNamed, type McpToolSpec } from '../catalogue';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const tool = (name: string): McpToolSpec => {
  const found = toolNamed(name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};
const grant = (capabilities: readonly McpCapability[], creatorId: string | null = A): GrantView => ({
  capabilities,
  creatorId,
});
const owner: ActorView = {
  role: 'owner',
  teamScope: 'owner',
  secondFactorEnabled: true,
  readableCreatorIds: 'all',
};
const manager: ActorView = {
  role: 'operator',
  teamScope: 'agency',
  secondFactorEnabled: true,
  readableCreatorIds: [A],
};
const creator: ActorView = {
  role: 'creator',
  teamScope: 'self',
  secondFactorEnabled: true,
  readableCreatorIds: [A],
};

describe('decideCall (ADR 0026 § 4, ADR 0105 § 1)', () => {
  it('lets the owner read what his access holds, confined to its creator', () => {
    expect(decideCall(tool('conversations_list'), grant(['read:conversations']), owner)).toEqual({
      ok: true,
      creatorId: A,
    });
    expect(decideCall(tool('whoami'), grant([], null), owner)).toEqual({ ok: true, creatorId: null });
  });

  it('refuses everything, whoami included, to an account without its second factor', () => {
    const noCode = { ...owner, secondFactorEnabled: false };
    expect(decideCall(tool('whoami'), grant([]), noCode)).toEqual({
      ok: false,
      refusal: 'second_factor_required',
    });
  });

  it('refuses a capability the access does not hold: metadata never opens the text', () => {
    expect(decideCall(tool('conversation_messages'), grant(['read:conversations']), owner)).toEqual({
      ok: false,
      refusal: 'capability_missing',
    });
  });

  it("gives the text of scripts to the owner only, even if a manager's access somehow holds it", () => {
    const scripts = grant(['read:script_content']);
    expect(decideCall(tool('script_steps_get'), scripts, owner)).toEqual({ ok: true, creatorId: A });
    expect(decideCall(tool('script_steps_get'), scripts, manager)).toEqual({
      ok: false,
      refusal: 'owner_only',
    });
  });

  it('calls no tool of a creator from an access without one, and reads the agency within scope', () => {
    expect(decideCall(tool('fan_get'), grant(['read:fans'], null), owner)).toEqual({
      ok: false,
      refusal: 'creator_required',
    });
    expect(decideCall(tool('shifts_list'), grant(['read:team'], null), owner)).toEqual({
      ok: true,
      creatorId: null,
    });
  });

  it("confines a tool of the agency to the access's creator when it has one", () => {
    expect(decideCall(tool('sales_list'), grant(['read:sales'], A), owner)).toEqual({
      ok: true,
      creatorId: A,
    });
    expect(decideCall(tool('stats_get'), grant(['read:status'], A), manager)).toEqual({
      ok: true,
      creatorId: A,
    });
  });

  it("never reaches another creator than the access's", () => {
    expect(decideCall(tool('fan_get'), grant(['read:fans'], A), owner, B)).toEqual({
      ok: false,
      refusal: 'creator_forbidden',
    });
  });

  it('follows the person now: a member who lost the creator loses the call at once', () => {
    const access = grant(['read:conversations'], A);
    expect(decideCall(tool('conversations_list'), access, manager)).toEqual({ ok: true, creatorId: A });
    const moved = { ...manager, readableCreatorIds: [B] };
    expect(decideCall(tool('conversations_list'), access, moved)).toEqual({
      ok: false,
      refusal: 'creator_forbidden',
    });
  });

  it('opens nothing to a manager fallen to self, nor to a chatter, until the access bound to the shift (ADR 0025)', () => {
    const fallen: ActorView = { ...manager, teamScope: 'self' };
    expect(decideCall(tool('conversations_list'), grant(['read:conversations']), fallen)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
    expect(decideCall(tool('whoami'), grant([]), fallen)).toEqual({ ok: true, creatorId: A });
  });

  it('keeps the pay from a manager', () => {
    expect(decideCall(tool('commission_statements_list'), grant(['read:payroll']), manager)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
  });

  it('refuses a role and scope pair the table does not know', () => {
    const odd: ActorView = { ...creator, teamScope: 'agency' };
    expect(decideCall(tool('drops_list'), grant(['read:media']), odd)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
  });

  it("never lets a creator's own account read a conversation or a fan (ADR 0023)", () => {
    expect(decideCall(tool('fan_get'), grant(['read:fans']), creator)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
    expect(decideCall(tool('conversation_messages'), grant(['read:conversation_content']), creator)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
    expect(decideCall(tool('drops_list'), grant(['read:media']), creator)).toEqual({
      ok: true,
      creatorId: A,
    });
  });

  it.each([
    ['sales_by_chatter', 'read:sales'],
    ['shift_reports_list', 'read:team'],
    ['team_import_list', 'read:team'],
    ['commission_statements_list', 'read:payroll'],
  ] as const)(
    "never lets a creator's own account call %s, the team's work or pay (ADR 0023)",
    (name, capability) => {
      expect(decideCall(tool(name), grant([capability]), creator)).toEqual({
        ok: false,
        refusal: 'role_forbidden',
      });
      expect(decideCall(tool(name), grant([capability]), owner)).toEqual({ ok: true, creatorId: A });
    },
  );

  it('still tells a creator who is on shift, and her own sales (ADR 0023)', () => {
    expect(decideCall(tool('on_shift_now'), grant(['read:team']), creator)).toEqual({
      ok: true,
      creatorId: A,
    });
    expect(decideCall(tool('sales_list'), grant(['read:sales']), creator)).toEqual({
      ok: true,
      creatorId: A,
    });
  });
});

describe('grantProblems', () => {
  it("accepts the owner-only capabilities on an access in the owner's name", () => {
    expect(grantProblems(['read:script_content', 'prepare:team'], owner)).toEqual([]);
  });

  it("refuses them in anyone else's name, and a capability asked twice", () => {
    expect(grantProblems(['read:script_content'], manager)).toEqual(['owner_only']);
    expect(grantProblems(['read:fans', 'read:fans'], owner)).toEqual(['capability_repeated']);
  });

  it("refuses what the person's role and scope may never hold", () => {
    expect(grantProblems(['read:fans'], creator)).toEqual(['role_forbidden']);
    expect(grantProblems(['read:status'], { role: 'operator', teamScope: 'self' })).toEqual([
      'role_forbidden',
    ]);
    expect(grantProblems(['read:status', 'read:media', 'write:drops'], creator)).toEqual([]);
  });
});
