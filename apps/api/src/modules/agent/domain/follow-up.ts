import {
  DEFAULT_AGENT_HOURS,
  nextFollowUpAllowed,
  followUpQuietAt,
  replyOpenAt,
  type AgentHours,
  type FanFlags,
} from '@nirvana/contracts';

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
}

export type FollowUpDecision =
  | { readonly kind: 'write' }
  | {
      readonly kind: 'skip';
      readonly reason:
        | 'follow_up_do_not_contact'
        | 'follow_up_distress'
        | 'follow_up_plan_over'
        | 'follow_up_no_allowed_hour';
    }
  | {
      readonly kind: 'later';
      readonly reason: 'follow_up_quiet_hours' | 'follow_up_outside_hours';
      readonly at: Date;
    };

/**
 * Whether she follows up on his silence now (P3-10). Never to a fan nobody may write to, nor to one in distress;
 * never past her last delay; out of her reply slots or in her quiet hours (a message out of nowhere at night reads
 * as a machine's), at the first minute both allow, on her clock (P3-14). A follow-up never sells: it keeps the link, and
 * a sales follow-up after a refused offer waits for Reveal's script history (P6-01), so none of the two the method
 * allows is written yet.
 */
export function followUpDecision(context: FollowUpMoment): FollowUpDecision {
  const { flags } = context;
  if (flags.doNotContact === true) return { kind: 'skip', reason: 'follow_up_do_not_contact' };
  if (flags.salesFrozen?.reason === 'distress') return { kind: 'skip', reason: 'follow_up_distress' };
  if (context.step < 0 || context.step >= context.steps)
    return { kind: 'skip', reason: 'follow_up_plan_over' };
  const { now, timeZone, hours = DEFAULT_AGENT_HOURS } = context;
  const open = replyOpenAt(hours, timeZone, now);
  if (open && !followUpQuietAt(hours, timeZone, now)) return { kind: 'write' };
  const at = nextFollowUpAllowed(hours, timeZone, now);
  // Her slots all fall in her quiet hours: no minute ever allows a follow-up, none is written.
  if (at === null) return { kind: 'skip', reason: 'follow_up_no_allowed_hour' };
  return { kind: 'later', reason: open ? 'follow_up_quiet_hours' : 'follow_up_outside_hours', at };
}
