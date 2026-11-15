import type {
  AgentMode,
  CreatorSetupStep,
  InvoiceNotIssuedReason,
  MemberSetupStep,
  SetupNote,
  SetupState,
  TeamRole,
} from '@impera/contracts';

/*
 * « Mise en route » (pilotage plan W1): what is done is read from the base, never ticked by hand. Pure, so that the
 * rules of each step are tested here and the reader only gathers facts.
 */

/**
 * An account's invitation: `none` before any link, `pending` while a link is alive and unused, `expired` when none is
 * alive any more and no password was chosen, `used` once a password is chosen.
 */
export type Invitation = 'none' | 'pending' | 'expired' | 'used';

/** Waiting on him while his link is alive; to send again once it died unused. */
function invitationStep<K extends string>(key: K, invitation: Invitation) {
  if (invitation === 'used') return step(key, 'done');
  if (invitation === 'pending') return step(key, 'waiting');
  return step(key, 'todo', invitation === 'expired' ? { kind: 'invitation_expired' } : null);
}

/** What the base holds of a creator, read by the setup reader. */
export interface CreatorSetupFacts {
  /** Her platform accounts (Reveal and others). */
  readonly accounts: number;
  /** Of those, how many have pay rules (Réglages › Règles de paie). */
  readonly accountsWithPayRules: number;
  readonly hasActivePersona: boolean;
  /** An agency percentage in force today or earlier. */
  readonly hasAgencyRate: boolean;
  /**
   * One of her Reveal accounts is linked to the sales feed: the agency's share is read there, the percentage is
   * optional (ADR 0054 § 7).
   */
  readonly hasLinkedReveal: boolean;
  /** Her own account. */
  readonly access: Invitation;
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
    // Done by a percentage, or by her share read at Reveal: the percentage is then optional (ADR 0054 § 7).
    step(
      'agency_rate',
      doneIf(facts.hasAgencyRate || facts.hasLinkedReveal),
      !facts.hasAgencyRate && facts.hasLinkedReveal ? { kind: 'share_read_on_platform' } : null,
    ),
    invitationStep('access', facts.access),
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
  readonly invitation: Invitation;
  /** An authenticator code confirmed or a passkey. */
  readonly secondFactor: boolean;
  /** An extension link not revoked. */
  readonly extensionLinked: boolean;
  /** One platform chatter account linked to him (Équipe › Reveal). */
  readonly platformAccountLinked: boolean;
  /** Creators on his list, archived ones left out. */
  readonly creators: number;
  /** A shift not cancelled, past or planned, on a creator not archived. */
  readonly hasShift: boolean;
  /** A chatter, or a manager with a rate or a share of the team's net in force: his pay is invoiced. */
  readonly paid: boolean;
  /** What stops his first invoice today, `null` when it could go out (`invoiceReadiness`). */
  readonly billing: Exclude<InvoiceNotIssuedReason, 'no_invoice_to_credit'> | null;
}

export function memberSetup(facts: MemberSetupFacts): MemberSetupStep[] {
  const steps: MemberSetupStep[] = [
    invitationStep('invitation', facts.invitation),
    step('second_factor', doneIf(facts.secondFactor)),
  ];
  if (facts.teamRole === 'chatter') {
    steps.push(step('extension', doneIf(facts.extensionLinked)));
    steps.push(step('platform_account', doneIf(facts.platformAccountLinked)));
  }
  steps.push(step('creators', doneIf(facts.creators > 0)));
  if (facts.teamRole === 'chatter') steps.push(step('first_shift', doneIf(facts.hasShift)));
  // Learnt on the 16th when paying otherwise: what stops his first invoice, and so who has to act.
  if (facts.paid) {
    steps.push(
      step(
        'billing',
        doneIf(facts.billing === null),
        facts.billing === null ? null : { kind: 'billing', reason: facts.billing },
      ),
    );
  }
  return steps;
}

/**
 * What a reader of the team sees (Charles's « ok manager mise en route », 12/11): the owner, everyone; an active
 * manager, the chatters alone and without « Facturation » (the files and the invoices are the owner's).
 */
export function memberSetupSeenBy<
  T extends { readonly teamRole: TeamRole; readonly steps: MemberSetupStep[] },
>(reader: 'owner' | 'manager', members: readonly T[]): T[] {
  if (reader === 'owner') return [...members];
  return members
    .filter((member) => member.teamRole === 'chatter')
    .map((member) => ({ ...member, steps: member.steps.filter((one) => one.key !== 'billing') }));
}
