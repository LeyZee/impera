import { isSetupComplete } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorSetup, memberSetup, type CreatorSetupFacts, type MemberSetupFacts } from '../setup';

const ready: CreatorSetupFacts = {
  accounts: 1,
  accountsWithPayRules: 1,
  hasActivePersona: true,
  hasAgencyRate: true,
  access: 'active',
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

  it('waits on her while her invitation is not opened', () => {
    expect(stateOf(creatorSetup({ ...ready, access: 'pending' }), 'access')).toBe('waiting');
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

describe('memberSetup', () => {
  const chatter: MemberSetupFacts = {
    teamRole: 'chatter',
    invitationUsed: true,
    secondFactor: true,
    extensionLinked: true,
    platformAccountLinked: true,
    creators: 2,
    hasShift: true,
  };

  it('gives a chatter six steps', () => {
    const steps = memberSetup(chatter);
    expect(steps.map((step) => step.key)).toEqual([
      'invitation',
      'second_factor',
      'extension',
      'platform_account',
      'creators',
      'first_shift',
    ]);
    expect(isSetupComplete(steps)).toBe(true);
  });

  it('gives a manager no extension, platform account nor shift', () => {
    expect(memberSetup({ ...chatter, teamRole: 'manager' }).map((step) => step.key)).toEqual([
      'invitation',
      'second_factor',
      'creators',
    ]);
  });

  it('waits on a newcomer and leaves the rest to do', () => {
    const steps = memberSetup({
      teamRole: 'chatter',
      invitationUsed: false,
      secondFactor: false,
      extensionLinked: false,
      platformAccountLinked: false,
      creators: 0,
      hasShift: false,
    });
    expect(steps.map((step) => step.state)).toEqual(['waiting', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });
});
