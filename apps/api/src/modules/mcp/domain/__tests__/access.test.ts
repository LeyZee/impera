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
const owner: ActorView = { role: 'owner', secondFactorEnabled: true, readableCreatorIds: 'all' };
const manager: ActorView = { role: 'operator', secondFactorEnabled: true, readableCreatorIds: [A] };

describe('decideCall (ADR 0026 § 4, ADR 0105 § 1)', () => {
  it('lets the owner read what his access holds', () => {
    expect(decideCall(tool('conversations_list'), grant(['read:conversations']), owner)).toEqual({
      ok: true,
    });
    expect(decideCall(tool('whoami'), grant([], null), owner)).toEqual({ ok: true });
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
    expect(decideCall(tool('script_steps_get'), scripts, owner)).toEqual({ ok: true });
    expect(decideCall(tool('script_steps_get'), scripts, manager)).toEqual({
      ok: false,
      refusal: 'owner_only',
    });
  });

  it('calls no tool of a creator from an access without one', () => {
    expect(decideCall(tool('fan_get'), grant(['read:fans'], null), owner)).toEqual({
      ok: false,
      refusal: 'creator_required',
    });
    expect(decideCall(tool('shifts_list'), grant(['read:team'], null), owner)).toEqual({ ok: true });
  });

  it("never reaches another creator than the access's", () => {
    expect(decideCall(tool('fan_get'), grant(['read:fans'], A), owner, B)).toEqual({
      ok: false,
      refusal: 'creator_forbidden',
    });
  });

  it('follows the person now: a member who lost the creator loses the call at once', () => {
    const access = grant(['read:conversations'], A);
    expect(decideCall(tool('conversations_list'), access, manager)).toEqual({ ok: true });
    const moved = { ...manager, readableCreatorIds: [B] };
    expect(decideCall(tool('conversations_list'), access, moved)).toEqual({
      ok: false,
      refusal: 'creator_forbidden',
    });
  });

  it("never lets a creator's own account read a conversation or a fan (ADR 0023)", () => {
    const creator: ActorView = { role: 'creator', secondFactorEnabled: true, readableCreatorIds: [A] };
    expect(decideCall(tool('fan_get'), grant(['read:fans']), creator)).toEqual({
      ok: false,
      refusal: 'role_forbidden',
    });
    expect(decideCall(tool('drops_list'), grant(['read:media']), creator)).toEqual({ ok: true });
  });
});

describe('grantProblems', () => {
  it("accepts the owner-only capabilities on an access in the owner's name", () => {
    expect(grantProblems(['read:script_content', 'prepare:team'], 'owner')).toEqual([]);
  });

  it("refuses them in anyone else's name, and a capability asked twice", () => {
    expect(grantProblems(['read:script_content'], 'operator')).toEqual(['owner_only']);
    expect(grantProblems(['read:fans', 'read:fans'], 'owner')).toEqual(['capability_repeated']);
  });
});
