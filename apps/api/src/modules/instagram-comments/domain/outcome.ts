import type { CommentHandoffReason, CommentOutcome } from '@impera/contracts';

import type { ReplyViolation } from './reply-guards';

/**
 * What the code decides around the model (ADR 0122 § 2 and § 3): which comments never reach it, what the code's own
 * detectors force, what becomes of a reply a guard refuses, and what a hostile comment gets while the hiding switch
 * is off. The rules on age and on distress outrank everything else here, as in the chatting.
 */

/** What the code knows of a comment before any call to the model. */
export interface CommentFacts {
  readonly fromOwnAccount: boolean;
  /** An age doubt on this author is open: no human has settled it yet. */
  readonly authorAgeDoubtOpen: boolean;
  /** The chatting's detectors, run by the code on the comment, without the model. */
  readonly ageDoubtDetected: boolean;
  readonly distressDetected: boolean;
  readonly repliesToAuthorToday: number;
  readonly repliesInThread: number;
}

/** The bounds of her replies; the owner's settings stay inside those of the code. */
export interface ReplyBounds {
  readonly perAuthorPerDay: number;
  readonly perThread: number;
}

export type BeforeModel =
  /** Her own comment: nothing happens, her replies start nothing. */
  | { readonly step: 'ignore' }
  /** The author's age is in doubt and unsettled: no reply anywhere, and no call to the model. A handoff never replies either. */
  | { readonly step: 'mute' }
  | { readonly step: 'handoff'; readonly handoff: CommentHandoffReason }
  /** A bound is reached: no reply, the comment may still be hidden. */
  | { readonly step: 'no_reply' }
  | { readonly step: 'ask_model' };

export function beforeModel(facts: CommentFacts, bounds: ReplyBounds): BeforeModel {
  if (facts.fromOwnAccount) return { step: 'ignore' };
  if (facts.ageDoubtDetected) return { step: 'handoff', handoff: 'age_doubt' };
  // Distress before the open doubt: a handoff answers nothing either, and a muted author in distress still reaches a human.
  if (facts.distressDetected) return { step: 'handoff', handoff: 'distress' };
  if (facts.authorAgeDoubtOpen) return { step: 'mute' };
  if (facts.repliesToAuthorToday >= bounds.perAuthorPerDay || facts.repliesInThread >= bounds.perThread)
    return { step: 'no_reply' };
  return { step: 'ask_model' };
}

/** A written attempt of the model's and what the guards found in it. */
export interface GuardedAttempt {
  readonly outcome: CommentOutcome;
  /** Empty for an outcome that is not a reply. */
  readonly violations: readonly ReplyViolation[];
}

export type AfterGuards =
  | { readonly step: 'settled'; readonly outcome: CommentOutcome }
  /** The first reply was refused: the model writes one more, and only one. */
  | { readonly step: 'rewrite'; readonly refusedBy: readonly ReplyViolation[] };

/**
 * A refused reply is rewritten once, then the outcome becomes `skip` (§ 3). `attempts` holds one or two attempts, in
 * order. A bound reached (`replyAllowed` false) turns a reply into a skip without a rewrite.
 */
export function afterGuards(attempts: readonly GuardedAttempt[], replyAllowed: boolean): AfterGuards {
  const last = attempts.at(-1);
  if (last === undefined) return { step: 'settled', outcome: { kind: 'skip', reason: 'no_attempt' } };
  if (last.outcome.kind !== 'reply') return { step: 'settled', outcome: last.outcome };
  if (!replyAllowed) return { step: 'settled', outcome: { kind: 'skip', reason: 'reply_bound_reached' } };
  if (last.violations.length === 0) return { step: 'settled', outcome: last.outcome };
  if (attempts.length < 2) return { step: 'rewrite', refusedBy: last.violations };
  return { step: 'settled', outcome: { kind: 'skip', reason: 'refused_by_guards' } };
}

/**
 * Hiding is a real action on her account, behind its own switch, off by default (§ 3): off, a hostile comment is only
 * flagged in the CRM.
 */
export function hostileCommentAction(hidingOn: boolean, canHide: boolean): 'hide' | 'flag_only' {
  return hidingOn && canHide ? 'hide' : 'flag_only';
}

const NEVER_GROUPED: readonly CommentHandoffReason[] = ['age_doubt', 'distress'];

/**
 * Handoffs are bounded by post and by hour; beyond, a single grouped one (§ 3). A handoff for age or distress is
 * never set aside by that bound.
 */
export function handoffDelivery(
  reason: CommentHandoffReason,
  handoffsOfPostThisHour: number,
  bound: number,
): 'alone' | 'grouped' {
  if (NEVER_GROUPED.includes(reason)) return 'alone';
  return handoffsOfPostThisHour >= bound ? 'grouped' : 'alone';
}

/** Deleting is irreversible: the owner's gesture only (§ 3). No model, job nor other role deletes. */
export function mayDeleteComment(actor: { readonly role: string }): boolean {
  return actor.role === 'owner';
}
