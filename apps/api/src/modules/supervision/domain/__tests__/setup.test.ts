import { isSetupComplete } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  creatorSetup,
  memberSetup,
  memberSetupSeenBy,
  type CreatorSetupFacts,
  type MemberSetupFacts,
} from '../setup';

const ready: CreatorSetupFacts = {
  accounts: 1,
  accountsWithPayRules: 1,
  hasActivePersona: true,
  hasAgencyRate: true,
  hasLinkedReveal: true,
  access: 'used',
  telegramReachable: true,
  hasOwnHours: true,
  hasShifts: true,
  mode: 'copilot',
  check: 'clean',
};

const stateOf = (steps: readonly { key: string; state: string }[], key: string): string | undefined =>
  steps.find((step) => step.key === key)?.state;

describe('creatorSetup', () => {
  it('lists the ten steps in order, all done for a creator set up', () => {
    const steps = creatorSetup(ready);
    expect(steps.map((step) => step.key)).toEqual([
      'platform_account',
      'persona',
      'agency_rate',
      'access',
      'pay_rules',
      'telegram',
      'agent_hours',
      'shifts',
      'agent_mode',
      'reliability_check',
    ]);
    expect(isSetupComplete(steps)).toBe(true);
  });

  it('leaves a creator made by hand, with nothing yet, with every step but her hours and her mode to do', () => {
    const steps = creatorSetup({
      accounts: 0,
      accountsWithPayRules: 0,
      hasActivePersona: false,
      hasAgencyRate: false,
      hasLinkedReveal: false,
      access: 'none',
      telegramReachable: false,
      hasOwnHours: false,
      hasShifts: false,
      mode: 'copilot',
      check: 'none',
    });
    expect(steps.filter((step) => step.state === 'done').map((step) => step.key)).toEqual([
      'agent_hours',
      'agent_mode',
    ]);
    expect(steps.find((step) => step.key === 'agent_hours')?.note).toEqual({ kind: 'default_hours' });
    expect(isSetupComplete(steps)).toBe(false);
  });

  it('takes her share read at Reveal for the percentage, which is then optional (ADR 0054 § 7)', () => {
    const rate = (facts: Partial<CreatorSetupFacts>) =>
      creatorSetup({ ...ready, ...facts }).find((step) => step.key === 'agency_rate');
    expect(rate({ hasAgencyRate: false })).toEqual({
      key: 'agency_rate',
      state: 'done',
      note: { kind: 'share_read_on_platform' },
    });
    expect(rate({ hasLinkedReveal: false })).toEqual({ key: 'agency_rate', state: 'done', note: null });
    expect(rate({})).toEqual({ key: 'agency_rate', state: 'done', note: null });
    expect(rate({ hasAgencyRate: false, hasLinkedReveal: false })?.state).toBe('todo');
  });

  it('waits on her while her invitation is not opened, and asks a new link once it died unused', () => {
    expect(stateOf(creatorSetup({ ...ready, access: 'pending' }), 'access')).toBe('waiting');
    expect(creatorSetup({ ...ready, access: 'expired' }).find((step) => step.key === 'access')).toEqual({
      key: 'access',
      state: 'todo',
      note: { kind: 'invitation_expired' },
    });
  });

  it('asks pay rules on every account and counts them when she has several', () => {
    const steps = creatorSetup({ ...ready, accounts: 2, accountsWithPayRules: 1 });
    const rules = steps.find((step) => step.key === 'pay_rules');
    expect(rules?.state).toBe('todo');
    expect(rules?.note).toEqual({ kind: 'accounts', done: 1, total: 2 });
    expect(stateOf(creatorSetup({ ...ready, accounts: 2, accountsWithPayRules: 2 }), 'pay_rules')).toBe(
      'done',
    );
  });

  it('says Telegram is off rather than ticking it', () => {
    const telegram = creatorSetup({ ...ready, telegramReachable: null }).find(
      (step) => step.key === 'telegram',
    );
    expect(telegram).toEqual({ key: 'telegram', state: 'todo', note: { kind: 'telegram_off' } });
  });

  it('leaves a stopped agent to put right, and gives the mode in force', () => {
    const mode = creatorSetup({ ...ready, mode: 'stop' }).find((step) => step.key === 'agent_mode');
    expect(mode).toEqual({ key: 'agent_mode', state: 'todo', note: { kind: 'agent_mode', mode: 'stop' } });
    expect(stateOf(creatorSetup({ ...ready, mode: 'auto' }), 'agent_mode')).toBe('done');
  });

  it('says a latest reliability check that is not clean', () => {
    const check = creatorSetup({ ...ready, check: 'not_clean' }).find(
      (step) => step.key === 'reliability_check',
    );
    expect(check).toEqual({ key: 'reliability_check', state: 'todo', note: { kind: 'check_not_clean' } });
  });
});

const readyMember: MemberSetupFacts = {
  teamRole: 'chatter',
  invitation: 'used',
  secondFactor: true,
  extensionLinked: true,
  platformAccountLinked: true,
  creators: 1,
  hasShift: true,
  paid: true,
  billing: null,
};

describe('memberSetup', () => {
  const chatter: MemberSetupFacts = {
    teamRole: 'chatter',
    invitation: 'used',
    secondFactor: true,
    extensionLinked: true,
    platformAccountLinked: true,
    creators: 2,
    hasShift: true,
    paid: true,
    billing: null,
  };

  it('gives a chatter seven steps, his invoicing last', () => {
    const steps = memberSetup(chatter);
    expect(steps.map((step) => step.key)).toEqual([
      'invitation',
      'second_factor',
      'extension',
      'platform_account',
      'creators',
      'first_shift',
      'billing',
    ]);
    expect(isSetupComplete(steps)).toBe(true);
  });

  it('gives a manager no extension, platform account nor shift, and no invoicing while he is not paid', () => {
    expect(memberSetup({ ...chatter, teamRole: 'manager', paid: false }).map((step) => step.key)).toEqual([
      'invitation',
      'second_factor',
      'creators',
    ]);
    expect(memberSetup({ ...chatter, teamRole: 'manager' }).map((step) => step.key)).toContain('billing');
  });

  it('says what stops his first invoice', () => {
    const billing = memberSetup({ ...chatter, billing: 'no_mandate' }).find((step) => step.key === 'billing');
    expect(billing).toEqual({
      key: 'billing',
      state: 'todo',
      note: { kind: 'billing', reason: 'no_mandate' },
    });
  });

  it('asks a new link once his invitation died unused', () => {
    expect(memberSetup({ ...chatter, invitation: 'expired' })[0]).toEqual({
      key: 'invitation',
      state: 'todo',
      note: { kind: 'invitation_expired' },
    });
  });

  it('waits on a newcomer and leaves the rest to do', () => {
    const steps = memberSetup({
      teamRole: 'chatter',
      invitation: 'pending',
      secondFactor: false,
      extensionLinked: false,
      platformAccountLinked: false,
      creators: 0,
      hasShift: false,
      paid: true,
      billing: 'no_mandate',
    });
    expect(steps.map((step) => step.state)).toEqual([
      'waiting',
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
  });
});

describe('memberSetupSeenBy', () => {
  const team = [
    {
      memberId: 'a',
      teamRole: 'chatter' as const,
      steps: memberSetup({ ...readyMember, teamRole: 'chatter' }),
    },
    {
      memberId: 'b',
      teamRole: 'manager' as const,
      steps: memberSetup({ ...readyMember, teamRole: 'manager' }),
    },
  ];

  it('shows the owner everyone, invoicing included', () => {
    expect(memberSetupSeenBy('owner', team)).toEqual(team);
  });

  it('shows a manager the chatters alone, without their invoicing', () => {
    const seen = memberSetupSeenBy('manager', team);
    expect(seen.map((member) => member.memberId)).toEqual(['a']);
    expect(seen[0]?.steps.map((step) => step.key)).not.toContain('billing');
  });
});
