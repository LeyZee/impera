import type {
  AgentMode,
  CreatorSetupStep,
  MemberSetupStep,
  SetupNote,
  SetupState,
  TeamRole,
} from '@impera/contracts';

/*
 * « Mise en route » (pilotage plan W1): what is done is read from the base, never ticked by hand. Pure, so that the
 * rules of each step are tested here and the reader only gathers facts.
 */

/** What the base holds of a creator, read by the setup reader. */
export interface CreatorSetupFacts {
  /** Her platform accounts (Reveal and others). */
  readonly accounts: number;
  /** Of those, how many have pay rules (Réglages › Règles de paie). */
  readonly accountsWithPayRules: number;
  readonly hasActivePersona: boolean;
  /** An agency percentage in force today or earlier. */
  readonly hasAgencyRate: boolean;
  /** Her own account: `none` before any invitation, `pending` while its link is unused. */
  readonly access: 'none' | 'pending' | 'active';
  /** An urgent alert reaches a group for her now; `null` when Telegram is off (no key). */
  readonly telegramReachable: boolean | null;
  /** Her agent hours stored; `false` follows the defaults. */
  readonly hasOwnHours: boolean;
  /** A shift not cancelled on one of her accounts, ending in the last 14 days or later. */
  readonly hasShifts: boolean;
  readonly mode: AgentMode;
  /**
   * The latest reliability check of her accounts' platform: `clean` and run on days after her first account was
   * made; `none` without a check that covers her.
   */
  readonly check: 'clean' | 'not_clean' | 'none';
}

const step = <K extends string>(
  key: K,
  state: SetupState,
  note: SetupNote | null = null,
): { key: K; state: SetupState; note: SetupNote | null } => ({ key, state, note });

const doneIf = (done: boolean): SetupState => (done ? 'done' : 'todo');

export function creatorSetup(facts: CreatorSetupFacts): CreatorSetupStep[] {
  const { accounts, accountsWithPayRules } = facts;
  return [
    step('platform_account', doneIf(accounts > 0)),
    step('persona', doneIf(facts.hasActivePersona)),
    step('agency_rate', doneIf(facts.hasAgencyRate)),
    step('access', facts.access === 'active' ? 'done' : facts.access === 'pending' ? 'waiting' : 'todo'),
    // Every account: one without rules gets its end-of-shift reports refused.
    step(
      'pay_rules',
      doneIf(accounts > 0 && accountsWithPayRules >= accounts),
      accounts > 1
        ? { kind: 'accounts', done: Math.min(accountsWithPayRules, accounts), total: accounts }
        : null,
    ),
    step(
      'telegram',
      doneIf(facts.telegramReachable === true),
      facts.telegramReachable === null ? { kind: 'telegram_off' } : null,
    ),
    // The defaults are a choice the agency may keep: done, and said so, never a step that cannot be ticked.
    step('agent_hours', 'done', facts.hasOwnHours ? null : { kind: 'default_hours' }),
    step('shifts', doneIf(facts.hasShifts)),
    // Stopped is a state to put right before she runs; Copilote and Automatique are both set up.
    step('agent_mode', doneIf(facts.mode !== 'stop'), { kind: 'agent_mode', mode: facts.mode }),
    step(
      'reliability_check',
      doneIf(facts.check === 'clean'),
      facts.check === 'not_clean' ? { kind: 'check_not_clean' } : null,
    ),
  ];
}

/** What the base holds of a team member. */
export interface MemberSetupFacts {
  readonly teamRole: TeamRole;
  /** A password set: his invitation link was used. */
  readonly invitationUsed: boolean;
  /** An authenticator code confirmed or a passkey. */
  readonly secondFactor: boolean;
  /** An extension link not revoked. */
  readonly extensionLinked: boolean;
  /** One platform chatter account linked to him (Équipe › Reveal). */
  readonly platformAccountLinked: boolean;
  readonly creators: number;
  /** A shift not cancelled, past or planned. */
  readonly hasShift: boolean;
}

export function memberSetup(facts: MemberSetupFacts): MemberSetupStep[] {
  const steps: MemberSetupStep[] = [
    step('invitation', facts.invitationUsed ? 'done' : 'waiting'),
    step('second_factor', doneIf(facts.secondFactor)),
  ];
  if (facts.teamRole === 'chatter') {
    steps.push(step('extension', doneIf(facts.extensionLinked)));
    steps.push(step('platform_account', doneIf(facts.platformAccountLinked)));
  }
  steps.push(step('creators', doneIf(facts.creators > 0)));
  if (facts.teamRole === 'chatter') steps.push(step('first_shift', doneIf(facts.hasShift)));
  return steps;
}
