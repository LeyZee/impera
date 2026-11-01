import type { InvoiceAcceptanceState } from '@nirvana/contracts';

import { InvoiceAcceptanceConflict } from './errors';

/**
 * Where an invoice stands with its contractor (EQ-06, ADR 0023 § Factures; BOI-TVA-DECLA-30-20-10-30 § 150-160): each
 * invoice is accepted or contested with a reason before the mandate's deadline, and accepted tacitly after it. A
 * contest ends in a credit note or in a refusal with its reason. A credit note follows the same acceptance, from
 * `pending`. One the agency issues of its own accord (a credit a period owes, ADR 0036, or a reduction) leaves the
 * invoice it cites where it stands: only the credit note that answers a contest moves it, to `credited`. Each step is
 * dated in `audit_log` by the caller.
 */

export type AcceptanceState = InvoiceAcceptanceState;

export type AcceptanceStep =
  | { readonly kind: 'accept' }
  | { readonly kind: 'contest'; readonly reason: string }
  /** The dated job, once the deadline has passed without an answer. */
  | { readonly kind: 'lapse' }
  /** A credit note answers the contest. */
  | { readonly kind: 'credit' }
  | { readonly kind: 'refuse'; readonly reason: string };

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
  const open = at.now.getTime() < at.deadline.getTime();
  if ((step.kind === 'contest' || step.kind === 'refuse') && step.reason.trim() === '') {
    throw new RangeError('A contest and its refusal give a reason');
  }
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
    case 'credit':
      if (state === 'contested') return 'credited';
      break;
    case 'refuse':
      if (state === 'contested') return 'contest_refused';
      break;
  }
  throw new InvoiceAcceptanceConflict(state);
}

/**
 * The invoice's state once a credit note cites it: `credited` when the note answers the invoice's contest, unchanged
 * when the agency issued it of its own accord, whatever the state, the note following its own acceptance.
 */
export function stateAfterCreditNote(
  state: AcceptanceState,
  note: { readonly answersContest: boolean },
  at: { readonly now: Date; readonly deadline: Date },
): AcceptanceState {
  return note.answersContest ? nextAcceptance(state, { kind: 'credit' }, at) : state;
}
