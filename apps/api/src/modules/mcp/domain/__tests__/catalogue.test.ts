import { MCP_CAPABILITIES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { MCP_CATALOGUE, MCP_CATALOGUE_VERSION, toolNamed } from '../catalogue';
import { NEVER_EXPOSED, neverExposedHits } from '../never-exposed';

describe('MCP catalogue (ADR 0026 § 5 and § 9, ADR 0105 § 4)', () => {
  it('is pinned: a change of a name, a capability, a scope or a restriction shows in the PR', () => {
    expect(
      MCP_CATALOGUE.map((tool) =>
        [
          tool.name,
          tool.capability ?? '-',
          tool.scope,
          ...(tool.ownerOnly === true ? ['owner-only'] : []),
          ...(tool.agencyOnly === true ? ['agency-only'] : []),
        ].join(' '),
      ),
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
    // To a fan
    'message_send',
    'message_create',
    'broadcast',
    'draft_approve',
    'draft_propose',
    'draft_suggest',
    // Speeding up
    'fan_age_confirm',
    'fan_unfreeze',
    'conversation_hand_back',
    'agent_set_automatic',
    'agent_set_auto',
    'agent_enable',
    // Prepared actions
    'prepared_action_confirm',
    // Keys, accesses, second factor
    'telegram_token_get',
    'grant_create',
    'access_renew',
    'access_revoke',
    'second_factor_reset',
    'passkey_add',
    'login',
    // Persona
    'persona_get',
    // Pay and rates
    'payroll_validate',
    'pay_period_validate',
    'payment_mark',
    'statement_validate',
    'commission_rate_set',
    'agency_rate_set',
    'contractor_file_get',
    // Members
    'member_create',
    'member_invite',
    'invitation_create',
    'member_depart',
    // Scripts and drops
    'script_create',
    'script_update',
    'script_activate',
    'script_price_set',
    'drop_validate',
    'drop_publish',
    // Deletion, export, notes, AI budget, connectors
    'fan_delete',
    'fans_export',
    'operator_note_set',
    'fan_note_set',
    'playground_reply',
    'media_describe',
    'conversation_summarize',
    'connector_sync',
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
