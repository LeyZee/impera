import { describe, expect, it } from 'vitest';

import {
  acceptanceDeadline,
  acceptanceStep,
  acceptanceWrite,
  nextAcceptance,
  standingOf,
  stateAfterCreditNote,
  type AcceptanceState,
  type AcceptanceStep,
  type RecordedStep,
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

describe('a document answered through the API (EQ-06 lot 6, ADR 0039)', () => {
  const issued: RecordedStep = { kind: 'issued', reason: null };
  const contested: RecordedStep = { kind: 'contested', reason: 'Une vente du 3 manque' };

  it('stands where its last answer or contest end puts it, with its contest’s reason', () => {
    expect(standingOf([])).toEqual({ state: 'pending', reason: null });
    expect(standingOf([issued])).toEqual({ state: 'pending', reason: null });
    expect(standingOf([issued, { kind: 'accepted', reason: null }])).toEqual({
      state: 'accepted',
      reason: null,
    });
    expect(standingOf([issued, { kind: 'lapsed', reason: null }])).toEqual({
      state: 'tacitly_accepted',
      reason: null,
    });
    expect(standingOf([issued, contested])).toEqual({ state: 'contested', reason: 'Une vente du 3 manque' });
    // The refusal's reason is the owner's: the document keeps the contractor's words.
    expect(standingOf([issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }])).toEqual({
      state: 'contest_refused',
      reason: 'Une vente du 3 manque',
    });
    // A payment leaves the acceptance where it stands.
    expect(
      standingOf([issued, { kind: 'accepted', reason: null }, { kind: 'paid', reason: null }]).state,
    ).toBe('accepted');
  });

  it('writes the event of an allowed step, its reason trimmed', () => {
    expect(acceptanceWrite([issued], { kind: 'accept' }, true)).toEqual({
      kind: 'write',
      event: 'accepted',
      reason: null,
    });
    expect(acceptanceWrite([issued], { kind: 'contest', reason: '  Une vente du 3 manque ' }, true)).toEqual({
      kind: 'write',
      event: 'contested',
      reason: 'Une vente du 3 manque',
    });
    expect(acceptanceWrite([issued], { kind: 'lapse' }, false)).toEqual({
      kind: 'write',
      event: 'lapsed',
      reason: null,
    });
    expect(acceptanceWrite([issued, contested], { kind: 'refuse', reason: 'Vente du 18' }, false)).toEqual({
      kind: 'write',
      event: 'contest_refused',
      reason: 'Vente du 18',
    });
  });

  it('gives back what was recorded when the same step is sent again, even after the deadline', () => {
    const accepted: RecordedStep[] = [issued, { kind: 'accepted', reason: null }];
    expect(acceptanceWrite(accepted, { kind: 'accept' }, true)).toEqual({ kind: 'replay' });
    expect(acceptanceWrite(accepted, { kind: 'accept' }, false)).toEqual({ kind: 'replay' });
    expect(
      acceptanceWrite([issued, contested], { kind: 'contest', reason: 'Une vente du 3 manque ' }, false),
    ).toEqual({ kind: 'replay' });
    const refused: RecordedStep[] = [issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }];
    expect(acceptanceWrite(refused, { kind: 'refuse', reason: 'Vente du 18' }, false)).toEqual({
      kind: 'replay',
    });
  });

  it('refuses another answer than the one recorded, and a step the delay no longer allows', () => {
    const accepted: RecordedStep[] = [issued, { kind: 'accepted', reason: null }];
    refusedIn('accepted', () =>
      acceptanceWrite(accepted, { kind: 'contest', reason: 'Finalement non' }, true),
    );
    refusedIn('contested', () => acceptanceWrite([issued, contested], { kind: 'accept' }, true));
    refusedIn('contested', () =>
      acceptanceWrite([issued, contested], { kind: 'contest', reason: 'Un autre motif' }, true),
    );
    const refused: RecordedStep[] = [issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }];
    refusedIn('contest_refused', () =>
      acceptanceWrite(refused, { kind: 'refuse', reason: 'Autre motif' }, false),
    );
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'accept' }, false));
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'lapse' }, true));
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'refuse', reason: 'Rien à refuser' }, true));
    refusedIn('tacitly_accepted', () =>
      acceptanceWrite([issued, { kind: 'lapsed', reason: null }], { kind: 'accept' }, false),
    );
  });

  it('takes the delay as the database tells it', () => {
    expect(acceptanceStep('pending', { kind: 'accept' }, true)).toBe('accepted');
    refusedIn('pending', () => acceptanceStep('pending', { kind: 'accept' }, false));
    expect(acceptanceStep('pending', { kind: 'lapse' }, false)).toBe('tacitly_accepted');
    expect(() => acceptanceWrite([issued], { kind: 'contest', reason: '   ' }, true)).toThrow(RangeError);
  });
});
