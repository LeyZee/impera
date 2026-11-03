import type { InvoiceAcceptanceState, InvoiceEventKind } from '@impera/contracts';

import { InvoiceAcceptanceConflict } from './errors';

/**
 * Where an invoice stands with its contractor (EQ-06, ADR 0023 § Factures; BOI-TVA-DECLA-30-20-10-30 § 150-160): each
 * invoice is accepted or contested with a reason before the mandate's deadline, and accepted tacitly after it. The
 * owner alone ends a contest, with a reason: refused, the document stays as it is; upheld, pay corrects it, in the same
 * action (ADR 0039 § 3, `contest-correction.ts`). A credit note follows the same steps, from `pending`, and has the same
 * two ends (§ 5). A credit note never moves the invoice it cites: no credit note answers a contest (§ 4). Each step is
 * dated in `audit_log` by the caller.
 */

export type AcceptanceState = InvoiceAcceptanceState;

export type AcceptanceStep =
  | { readonly kind: 'accept' }
  | { readonly kind: 'contest'; readonly reason: string }
  /** The dated job, once the deadline has passed without an answer. */
  | { readonly kind: 'lapse' }
  /** The owner upholds the contest; its correction is written with it. */
  | { readonly kind: 'uphold'; readonly reason: string }
  | { readonly kind: 'refuse'; readonly reason: string };

/** A step that gives a reason: a contest and either of its ends. */
const reasonOf = (step: AcceptanceStep): string | null =>
  step.kind === 'contest' || step.kind === 'uphold' || step.kind === 'refuse' ? step.reason.trim() : null;

/** The end of the mandate's delay to contest: the issue plus whole days. */
export function acceptanceDeadline(issuedAt: Date, days: number): Date {
  if (!Number.isSafeInteger(days) || days < 1) throw new RangeError('A delay to contest is whole days');
  return new Date(issuedAt.getTime() + days * 86_400_000);
}

/** The state after `step`, or a conflict when the state or the deadline no longer allows it. */
export function nextAcceptance(
  state: AcceptanceState,
  step: AcceptanceStep,
  at: { readonly now: Date; readonly deadline: Date },
): AcceptanceState {
  return acceptanceStep(state, step, at.now.getTime() < at.deadline.getTime());
}

/**
 * The state after `step` while the delay to answer is `open` or not, as the database tells it in the transaction that
 * writes (`now() < acceptance_deadline`, the clock its trigger checks too); a conflict when it no longer allows it.
 */
export function acceptanceStep(state: AcceptanceState, step: AcceptanceStep, open: boolean): AcceptanceState {
  if (reasonOf(step) === '') throw new RangeError('A contest and its end give a reason');
  switch (step.kind) {
    case 'accept':
      if (state === 'pending' && open) return 'accepted';
      break;
    case 'contest':
      if (state === 'pending' && open) return 'contested';
      break;
    case 'lapse':
      if (state === 'pending' && !open) return 'tacitly_accepted';
      break;
    case 'uphold':
      if (state === 'contested') return 'contest_upheld';
      break;
    case 'refuse':
      if (state === 'contested') return 'contest_refused';
      break;
  }
  throw new InvoiceAcceptanceConflict(state);
}

/** A step of a document as `invoice_events` keeps it, oldest first. */
export interface RecordedStep {
  readonly kind: InvoiceEventKind;
  readonly reason: string | null;
}

/** The event each step writes. */
const EVENT_OF = {
  accept: 'accepted',
  contest: 'contested',
  lapse: 'lapsed',
  uphold: 'contest_upheld',
  refuse: 'contest_refused',
} as const satisfies Record<AcceptanceStep['kind'], InvoiceEventKind>;

/** The state each event leads to; the issue and a payment leave it where it stands. */
const STATE_AFTER: Partial<Record<InvoiceEventKind, AcceptanceState>> = {
  accepted: 'accepted',
  contested: 'contested',
  lapsed: 'tacitly_accepted',
  contest_upheld: 'contest_upheld',
  contest_refused: 'contest_refused',
};

/**
 * Where a document stands from its steps, oldest first: `pending` until an answer, then the last step that moves it;
 * the reason is its contest's, kept once the contest ends (the contractor's words, never the owner's).
 */
export function standingOf(steps: readonly RecordedStep[]): {
  readonly state: AcceptanceState;
  readonly reason: string | null;
} {
  let state: AcceptanceState = 'pending';
  let reason: string | null = null;
  for (const step of steps) {
    state = STATE_AFTER[step.kind] ?? state;
    if (step.kind === 'contested') reason = step.reason;
  }
  return { state, reason };
}

/**
 * What a step asks to write on a document, from its recorded steps: nothing when the very same step is recorded already
 * (an answer or a refusal sent again, its reason trimmed as the contract trims it), else the event and its reason. A
 * different answer than the one recorded, or a step the state or the delay no longer allows, is a conflict.
 */
export function acceptanceWrite(
  steps: readonly RecordedStep[],
  step: AcceptanceStep,
  open: boolean,
):
  | { readonly kind: 'replay' }
  | { readonly kind: 'write'; readonly event: InvoiceEventKind; readonly reason: string | null } {
  const event = EVENT_OF[step.kind];
  const reason = reasonOf(step);
  if (steps.some((recorded) => recorded.kind === event && recorded.reason === reason))
    return { kind: 'replay' };
  acceptanceStep(standingOf(steps).state, step, open);
  return { kind: 'write', event, reason };
}
