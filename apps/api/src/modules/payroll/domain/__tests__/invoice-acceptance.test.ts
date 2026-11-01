import { describe, expect, it } from 'vitest';

import {
  acceptanceDeadline,
  nextAcceptance,
  stateAfterCreditNote,
  type AcceptanceState,
  type AcceptanceStep,
} from '../invoice-acceptance';

const issuedAt = new Date('2026-11-01T08:00:00.000Z');
const deadline = acceptanceDeadline(issuedAt, 15);
const before = { now: new Date('2026-11-16T07:59:59.999Z'), deadline };
const after = { now: deadline, deadline };

/** `run` is refused: the invoice, in `state`, no longer allows the step. */
function refusedIn(state: AcceptanceState, run: () => unknown): void {
  expect(run).toThrow(expect.objectContaining({ code: 'invoice_acceptance_conflict', details: { state } }));
}

describe('the acceptance of an invoice by its contractor (EQ-06)', () => {
  it('leaves whole days to contest from the issue', () => {
    expect(deadline).toEqual(new Date('2026-11-16T08:00:00.000Z'));
    for (const days of [0, -1, 1.5]) expect(() => acceptanceDeadline(issuedAt, days)).toThrow(RangeError);
  });

  it('is accepted or contested with a reason before the deadline, and accepted tacitly from it', () => {
    expect(nextAcceptance('pending', { kind: 'accept' }, before)).toBe('accepted');
    expect(nextAcceptance('pending', { kind: 'contest', reason: 'Une vente manque' }, before)).toBe(
      'contested',
    );
    expect(nextAcceptance('pending', { kind: 'lapse' }, after)).toBe('tacitly_accepted');
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'accept' }, after));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'contest', reason: 'Trop tard' }, after));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'lapse' }, before));
  });

  it('ends a contest in a credit note or in a refusal with its reason', () => {
    expect(nextAcceptance('contested', { kind: 'credit' }, after)).toBe('credited');
    expect(
      nextAcceptance(
        'contested',
        { kind: 'refuse', reason: 'La vente est sur la quinzaine suivante' },
        after,
      ),
    ).toBe('contest_refused');
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'credit' }, before));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'refuse', reason: 'Non' }, before));
  });

  it('never moves an answered invoice again', () => {
    const steps: AcceptanceStep[] = [
      { kind: 'accept' },
      { kind: 'contest', reason: 'Une vente manque' },
      { kind: 'lapse' },
      { kind: 'credit' },
      { kind: 'refuse', reason: 'Non' },
    ];
    const answered: AcceptanceState[] = ['accepted', 'tacitly_accepted', 'credited', 'contest_refused'];
    for (const state of answered) {
      for (const step of steps) {
        refusedIn(state, () => nextAcceptance(state, step, before));
        refusedIn(state, () => nextAcceptance(state, step, after));
      }
    }
    refusedIn('contested', () => nextAcceptance('contested', { kind: 'accept' }, before));
  });

  it('leaves the invoice where it stands under a credit note the agency issued of its own accord', () => {
    const states: AcceptanceState[] = [
      'pending',
      'accepted',
      'tacitly_accepted',
      'contested',
      'credited',
      'contest_refused',
    ];
    for (const state of states) {
      for (const at of [before, after]) {
        expect(stateAfterCreditNote(state, { answersContest: false }, at)).toBe(state);
      }
    }
    // Only the credit note that answers a contest moves the invoice, and only a contested one.
    expect(stateAfterCreditNote('contested', { answersContest: true }, after)).toBe('credited');
    refusedIn('accepted', () => stateAfterCreditNote('accepted', { answersContest: true }, before));
    refusedIn('pending', () => stateAfterCreditNote('pending', { answersContest: true }, before));
  });

  it('refuses a contest or a refusal without a reason', () => {
    expect(() => nextAcceptance('pending', { kind: 'contest', reason: ' ' }, before)).toThrow(RangeError);
    expect(() => nextAcceptance('contested', { kind: 'refuse', reason: '' }, after)).toThrow(RangeError);
  });
});
