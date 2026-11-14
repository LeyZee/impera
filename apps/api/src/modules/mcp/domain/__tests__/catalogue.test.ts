import { MCP_CAPABILITIES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { MCP_CATALOGUE, MCP_CATALOGUE_VERSION, toolNamed } from '../catalogue';
import { NEVER_EXPOSED, neverExposedHits } from '../never-exposed';

describe('MCP catalogue (ADR 0026 § 5 and § 9, ADR 0105 § 4)', () => {
  it('is pinned: a change of a name, a capability or a scope shows in the PR', () => {
    expect(
      MCP_CATALOGUE.map((tool) => `${tool.name} ${tool.capability ?? '-'} ${tool.scope}`),
    ).toMatchSnapshot();
  });

  it('announces a semver version of itself', () => {
    expect(MCP_CATALOGUE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names its tools in snake_case, each once', () => {
    const names = MCP_CATALOGUE.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('holds no tool of the « never exposed » list', () => {
    const offending = MCP_CATALOGUE.flatMap((tool) =>
      neverExposedHits(tool.name).map((rule) => `${tool.name}: ${rule.why}`),
    );
    expect(offending).toEqual([]);
  });

  it('only reads in lot a, and needs a known capability for every tool but whoami', () => {
    for (const tool of MCP_CATALOGUE) {
      expect(tool.kind).toBe('read');
      if (tool.name === 'whoami') expect(tool.capability).toBeNull();
      else expect(MCP_CAPABILITIES).toContain(tool.capability);
      expect(tool.capability?.startsWith('read:') ?? true).toBe(true);
    }
  });

  it('puts the text of fans and of scripts behind their own capabilities', () => {
    expect(toolNamed('conversation_messages')?.capability).toBe('read:conversation_content');
    expect(toolNamed('drafts_pending')?.capability).toBe('read:conversation_content');
    expect(toolNamed('script_steps_get')?.capability).toBe('read:script_content');
    expect(toolNamed('conversations_list')?.capability).toBe('read:conversations');
  });

  it('refuses an unknown name instead of guessing one', () => {
    expect(toolNamed('draft_approve')).toBeUndefined();
    expect(toolNamed('WHOAMI')).toBeUndefined();
  });
});

describe('never exposed (ADR 0026 § 5, ADR 0105 § 3)', () => {
  it.each([
    'draft_approve',
    'message_send',
    'fan_age_confirm',
    'agent_set_automatic',
    'persona_get',
    'payroll_validate',
    'commission_rate_set',
    'contractor_file_get',
    'member_create',
    'fan_delete',
    'fans_export',
    'operator_note_set',
    'playground_reply',
    'telegram_token_get',
  ])('catches %s', (name) => {
    expect(neverExposedHits(name).length).toBeGreaterThan(0);
  });

  it.each([
    'draft_reject',
    'conversation_handoff',
    'agent_set_mode',
    'fan_flag_set',
    'creator_task_create',
    'drop_upload',
    'member_invite_prepare',
    'script_prepare',
  ])('leaves %s, a brake or a prepared gesture of lot b, to its own rules', (name) => {
    expect(neverExposedHits(name)).toEqual([]);
  });

  it('says why for every rule', () => {
    for (const rule of NEVER_EXPOSED) expect(rule.why.length).toBeGreaterThan(10);
  });
});
