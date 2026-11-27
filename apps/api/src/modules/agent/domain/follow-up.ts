import {
  DEFAULT_AGENT_HOURS,
  nextFollowUpAllowed,
  followUpQuietAt,
  replyOpenAt,
  type AgentHours,
  type DatedRanges,
  type FanFlags,
} from '@impera/contracts';

/** A follow-up the worker asks for (P3-10): which delay of the persona, after which silence of his. */
export interface FollowUpMoment {
  /** The index of the delay in `follow_ups.delays_hours`, from 0. */
  readonly step: number;
  /** How many delays the persona has. */
  readonly steps: number;
  readonly flags: FanFlags;
  readonly now: Date;
  /** Her time zone: her quiet hours are on her clock. */
  readonly timeZone: string;
  /** Her hours (P3-14); absent, the defaults: always open, quiet from 23:00 to 9:00. */
  readonly hours?: AgentHours;
  /** When an automation of the platform last wrote to him (welcome, reminder before expiry: ADR 0110 § 6). */
  readonly lastAutomationAt?: Date;
  /** Her dated exceptions (ADR 0148 § 3): a date closed by one gets no follow-up either. */
  readonly exceptions?: DatedRanges;
}

/** How long after an automation of the platform wrote to him no follow-up of hers goes out (ADR 0110 § 6). */
const AFTER_AUTOMATION_MS = 6 * 3_600_000;

export type FollowUpDecision =
  | { readonly kind: 'write' }
  | {
      readonly kind: 'skip';
      readonly reason:
        | 'follow_up_do_not_contact'
        | 'follow_up_distress'
        | 'follow_up_age_disputed'
        | 'follow_up_plan_over'
        | 'follow_up_no_allowed_hour';
    }
  | {
      readonly kind: 'later';
      readonly reason: 'follow_up_quiet_hours' | 'follow_up_outside_hours' | 'follow_up_after_automation';
      readonly at: Date;
    };

/**
 * Whether she follows up on his silence now (P3-10). Never to a fan nobody may write to, one in distress, nor one
 * whose age is in doubt;
 * never past her last delay; out of her reply slots or in her quiet hours (a message out of nowhere at night reads
 * as a machine's), at the first minute both allow, on her clock (P3-14). A follow-up never sells: it keeps the link, and
 * a sales follow-up after a refused offer waits for Reveal's script history (P6-01), so none of the two the method
 * allows is written yet. Within 6 h of a message an automation of the platform wrote to him, at the end of them
 * (ADR 0110 § 6).
 */
export function followUpDecision(context: FollowUpMoment): FollowUpDecision {
  const { flags } = context;
  if (flags.doNotContact === true) return { kind: 'skip', reason: 'follow_up_do_not_contact' };
  if (flags.salesFrozen?.reason === 'distress') return { kind: 'skip', reason: 'follow_up_distress' };
  // His age in doubt: the agent writes nothing to him until the owner or a manager confirms it (Charles, 16/11).
  if (flags.ageDisputed !== undefined) return { kind: 'skip', reason: 'follow_up_age_disputed' };
  if (context.step < 0 || context.step >= context.steps)
    return { kind: 'skip', reason: 'follow_up_plan_over' };
  const { now, timeZone, hours = DEFAULT_AGENT_HOURS, exceptions = [] } = context;
  // An automation of the platform just wrote to him: hers waits 6 h after it, then her hours are read again.
  if (context.lastAutomationAt !== undefined) {
    const after = context.lastAutomationAt.getTime() + AFTER_AUTOMATION_MS;
    if (now.getTime() < after)
      return { kind: 'later', reason: 'follow_up_after_automation', at: new Date(after) };
  }
  const open = replyOpenAt(hours, timeZone, now, exceptions);
  if (open && !followUpQuietAt(hours, timeZone, now)) return { kind: 'write' };
  const at = nextFollowUpAllowed(hours, timeZone, now, exceptions);
  // Her slots all fall in her quiet hours: no minute ever allows a follow-up, none is written.
  if (at === null) return { kind: 'skip', reason: 'follow_up_no_allowed_hour' };
  return { kind: 'later', reason: open ? 'follow_up_quiet_hours' : 'follow_up_outside_hours', at };
}
